"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CurrencyCode, LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { useEventStream } from "../../hooks/useEventStream";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendDailyHighlights,
  type DividendQuery,
  updateDividendReconciliation,
} from "../../features/dividends/services/dividendService";
import { mapDividendDailyHighlightItem, type DividendDailyHighlightRow } from "../../features/dividends/dailyHighlights";
import type {
  DividendCalendarRow,
  DividendCalendarSnapshot,
  DividendEventListItem,
  DividendLedgerEntryDetails,
} from "../../features/dividends/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Drawer } from "../ui/Drawer";
import { DividendPostingForm } from "./DividendPostingForm";
import { DIVIDENDS_LEDGER_ONLY_PARAMS } from "./dividendsTabsUtils";
import { useOptionalAppShellData } from "../layout/AppShellDataContext";

interface DividendCalendarClientProps {
  initialSnapshot: DividendCalendarSnapshot;
  initialMonth: string;
  dict: AppDictionary;
  locale: LocaleCode;
  onSnapshotChange?: (snapshot: DividendCalendarSnapshot, month: string) => void;
}

type CalendarBadge = "unposted" | "pendingReview" | "posted" | "postedVariance" | "resolved" | "matched" | "explained";
type CurrencyTotals = Partial<Record<CurrencyCode, number>>;

function formatTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), template);
}

function parseMonthKey(monthKey: string): Date {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (!/^\d{4}-\d{2}$/.test(monthKey) || month < 1 || month > 12) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(year, month - 1, 1));
}

function monthKey(anchor: Date): string {
  return `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(anchor: Date, delta: number): Date {
  return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + delta, 1));
}

function monthBounds(anchor: Date): { fromPaymentDate: string; toPaymentDate: string } {
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return {
    fromPaymentDate: start.toISOString().slice(0, 10),
    toPaymentDate: end.toISOString().slice(0, 10),
  };
}

function reviewHref(
  bounds: { fromPaymentDate: string; toPaymentDate: string },
  month: string,
  ticker?: string,
  marketCode?: string,
  status?: string,
): string {
  const params = new URLSearchParams({
    view: "ledger",
    month,
    fromPaymentDate: bounds.fromPaymentDate,
    toPaymentDate: bounds.toPaymentDate,
  });
  if (ticker) params.set("ticker", ticker);
  if (marketCode) params.set("marketCode", marketCode);
  if (status) params.set("status", status);
  return `/dividends?${params.toString()}`;
}

function rowKey(event: DividendEventListItem): string {
  return `${event.accountId}:${event.id}`;
}

function eventAccountLabel(event: Pick<DividendEventListItem, "accountId" | "accountName">): string {
  return event.accountName?.trim() || event.accountId;
}

function buildRows(snapshot: DividendCalendarSnapshot): DividendCalendarRow[] {
  const ledgerByKey = new Map<string, DividendLedgerEntryDetails>();
  for (const entry of snapshot.ledgerEntries) {
    ledgerByKey.set(`${entry.accountId}:${entry.dividendEventId}`, entry);
  }

  return snapshot.events.map((event) => ({
    key: rowKey(event),
    event,
    ledgerEntry: ledgerByKey.get(rowKey(event)) ?? null,
  }));
}

function calculateGrossAmount(ledgerEntry: DividendLedgerEntryDetails | null): number | null {
  if (!ledgerEntry) return null;
  return ledgerEntry.receivedCashAmount + ledgerEntry.deductions
    .filter((entry) => entry.withheldAtSource)
    .reduce((sum, entry) => sum + entry.amount, 0);
}

function hasVariance(row: DividendCalendarRow): boolean {
  if (!row.ledgerEntry) return false;
  const grossAmount = calculateGrossAmount(row.ledgerEntry) ?? 0;
  return grossAmount !== row.ledgerEntry.expectedCashAmount
    || row.ledgerEntry.receivedStockQuantity !== row.ledgerEntry.expectedStockQuantity;
}

function resolveBadge(row: DividendCalendarRow): CalendarBadge {
  if (!row.ledgerEntry) return "unposted";
  const status = row.ledgerEntry.reconciliationStatus;
  if (status === "resolved") return "resolved";
  if (status === "matched") return "matched";
  if (status === "explained") return "explained";
  if (status === "open") return "pendingReview";
  if (hasVariance(row)) return "postedVariance";
  return "posted";
}

function resolveBadgeLabel(dict: AppDictionary, badge: CalendarBadge): string {
  switch (badge) {
    case "pendingReview":
      return dict.dividends.badge.pendingReview;
    case "posted":
      return dict.dividends.badge.posted;
    case "postedVariance":
      return dict.dividends.badge.postedVariance;
    case "resolved":
      return dict.dividends.badge.resolved;
    case "matched":
      return dict.dividends.badge.matched;
    case "explained":
      return dict.dividends.badge.explained;
    default:
      return dict.dividends.badge.unposted;
  }
}

function badgeClassName(badge: CalendarBadge): string {
  switch (badge) {
    case "pendingReview":
      return "bg-rose-50 text-rose-700";
    case "posted":
    case "resolved":
    case "matched":
      return "bg-emerald-50 text-emerald-700";
    case "postedVariance":
      return "bg-amber-50 text-amber-700";
    case "explained":
      return "bg-indigo-50 text-indigo-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function addCurrencyTotal(totals: CurrencyTotals, currency: CurrencyCode, amount: number): CurrencyTotals {
  return { ...totals, [currency]: (totals[currency] ?? 0) + amount };
}

function formatCurrencyTotals(totals: CurrencyTotals, locale: LocaleCode): string {
  const entries = Object.entries(totals) as Array<[CurrencyCode, number]>;
  if (entries.length === 0) return "-";
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => formatCurrencyAmount(amount, currency, locale))
    .join(" · ");
}

function tickerLabel(event: Pick<DividendEventListItem, "ticker" | "tickerName">): string {
  const name = event.tickerName?.trim();
  return name ? `${event.ticker} ${name}` : event.ticker;
}

function actionPriority(row: DividendCalendarRow): number {
  if (row.ledgerEntry?.sourceCompositionStatus === "unknown_pending_disclosure") return 0;
  if (row.ledgerEntry?.reconciliationStatus === "open") return 1;
  return 2;
}

export function DividendCalendarClient({ initialSnapshot, initialMonth, dict, locale, onSnapshotChange }: DividendCalendarClientProps) {
  const shellData = useOptionalAppShellData();
  const canWriteDividends = !shellData?.isSharedContext || shellData.sharedContextPermissions.canWriteDividends;
  const contextRefreshSignal = shellData?.contextRefreshSignal ?? 0;
  const contextOwnerId = shellData?.contextOwnerId ?? shellData?.sessionUserId ?? null;
  const [visibleMonth, setVisibleMonth] = useState(() => parseMonthKey(initialMonth));
  const [snapshot, setSnapshot] = useState<DividendCalendarSnapshot>(initialSnapshot);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [drawerRow, setDrawerRow] = useState<DividendCalendarRow | null>(null);
  const [isDrawerDirty, setIsDrawerDirty] = useState(false);
  const [pendingRowKey, setPendingRowKey] = useState<string | null>(null);
  const [payingTodayRows, setPayingTodayRows] = useState<DividendDailyHighlightRow[]>([]);
  const [exDividendTodayRows, setExDividendTodayRows] = useState<DividendDailyHighlightRow[]>([]);
  const activeMonthKey = monthKey(visibleMonth);
  const bounds = useMemo(() => monthBounds(visibleMonth), [visibleMonth]);
  const query = useMemo<DividendQuery>(() => ({ ...bounds, limit: 500 }), [bounds]);
  const initialQueryKey = useRef(JSON.stringify(query));
  const didSkipInitialQueryRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const highlightsRequestSequenceRef = useRef(0);
  const highlightsRequestRef = useRef<AbortController | null>(null);
  const onSnapshotChangeRef = useRef(onSnapshotChange);
  const lastContextRefreshSignal = useRef(contextRefreshSignal);
  const lastContextOwnerId = useRef(contextOwnerId);

  useEffect(() => {
    onSnapshotChangeRef.current = onSnapshotChange;
  }, [onSnapshotChange]);

  const refreshSnapshot = useCallback(async (requestedQuery: DividendQuery, requestedMonthKey: string) => {
    activeRequestRef.current?.abort();
    const requestId = ++requestSequenceRef.current;
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setIsLoading(true);
    setErrorMessage("");
    try {
      const nextSnapshot = await fetchDividendCalendarSnapshot(requestedQuery, { signal: controller.signal });
      if (requestSequenceRef.current !== requestId) return;
      setSnapshot(nextSnapshot);
      onSnapshotChangeRef.current?.(nextSnapshot, requestedMonthKey);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
      if (requestSequenceRef.current !== requestId) return;
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestSequenceRef.current === requestId) {
        setIsLoading(false);
        activeRequestRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    setSnapshot(initialSnapshot);
  }, [initialSnapshot]);

  useEffect(() => {
    const nextMonth = parseMonthKey(initialMonth);
    setVisibleMonth((current) => monthKey(current) === monthKey(nextMonth) ? current : nextMonth);
  }, [initialMonth]);

  useEffect(() => {
    const queryKey = JSON.stringify(query);
    if (!didSkipInitialQueryRef.current && queryKey === initialQueryKey.current) {
      didSkipInitialQueryRef.current = true;
      return;
    }
    void refreshSnapshot(query, activeMonthKey);
  }, [activeMonthKey, query, refreshSnapshot]);

  useEffect(() => () => {
    requestSequenceRef.current += 1;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
  }, []);

  const refreshDailyHighlights = useCallback(async () => {
    highlightsRequestRef.current?.abort();
    const requestId = ++highlightsRequestSequenceRef.current;
    const controller = new AbortController();
    highlightsRequestRef.current = controller;

    try {
      const nextHighlights = await fetchDividendDailyHighlights({ signal: controller.signal });
      if (highlightsRequestSequenceRef.current !== requestId) return;

      setPayingTodayRows(nextHighlights.payingToday.map((item) => mapDividendDailyHighlightItem(item, locale)));
      setExDividendTodayRows(nextHighlights.exDividendToday.map((item) => mapDividendDailyHighlightItem(item, locale)));
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
    } finally {
      if (highlightsRequestSequenceRef.current === requestId) {
        highlightsRequestRef.current = null;
      }
    }
  }, [locale]);

  useEffect(() => {
    void refreshDailyHighlights();
  }, [refreshDailyHighlights]);

  useEffect(() => {
    if (lastContextRefreshSignal.current === contextRefreshSignal) return;
    lastContextRefreshSignal.current = contextRefreshSignal;
    if (lastContextOwnerId.current !== contextOwnerId) {
      lastContextOwnerId.current = contextOwnerId;
      setDrawerRow(null);
      setIsDrawerDirty(false);
    }
    void refreshSnapshot(query, activeMonthKey);
    void refreshDailyHighlights();
  }, [activeMonthKey, contextOwnerId, contextRefreshSignal, query, refreshDailyHighlights, refreshSnapshot]);

  useEffect(() => () => {
    highlightsRequestSequenceRef.current += 1;
    highlightsRequestRef.current?.abort();
    highlightsRequestRef.current = null;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of DIVIDENDS_LEDGER_ONLY_PARAMS) params.delete(key);
    params.set("month", activeMonthKey);
    params.delete("view");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `/dividends?${qs}` : "/dividends");
  }, [activeMonthKey]);

  useEventStream({
    enabled: true,
    eventTypes: ["dividend_posted", "dividend_updated", "dividend_reconciliation_changed"],
    onEvent: () => {
      void refreshSnapshot(query, activeMonthKey);
      void refreshDailyHighlights();
    },
  });

  const rows = useMemo(() => buildRows(snapshot), [snapshot]);
  const tbdRows = rows.filter((row) => row.event.paymentDate === null);
  const receiptRows = rows
    .filter((row) => row.ledgerEntry?.postingStatus === "posted" || row.ledgerEntry?.postingStatus === "adjusted")
    .sort((left, right) => {
      const leftDate = left.ledgerEntry?.paymentDate ?? left.ledgerEntry?.bookedAt ?? left.event.paymentDate ?? "";
      const rightDate = right.ledgerEntry?.paymentDate ?? right.ledgerEntry?.bookedAt ?? right.event.paymentDate ?? "";
      return rightDate.localeCompare(leftDate);
    });
  const actionRows = rows.filter((row) =>
    (!row.ledgerEntry && row.event.paymentDate !== null) ||
    row.ledgerEntry?.reconciliationStatus === "open" ||
    row.ledgerEntry?.sourceCompositionStatus === "unknown_pending_disclosure",
  );
  const prioritizedActionRows = [...actionRows].sort((left, right) => (
    actionPriority(left) - actionPriority(right)
    || (left.event.paymentDate ?? "").localeCompare(right.event.paymentDate ?? "")
    || left.event.ticker.localeCompare(right.event.ticker)
  ));
  const expectedTotals = rows.reduce<CurrencyTotals>(
    (totals, row) => addCurrencyTotal(totals, row.event.cashDividendCurrency, row.event.expectedCashAmount),
    {},
  );
  const receivedTotals = receiptRows.reduce<CurrencyTotals>(
    (totals, row) => row.ledgerEntry ? addCurrencyTotal(totals, row.ledgerEntry.cashCurrency, row.ledgerEntry.receivedCashAmount) : totals,
    {},
  );
  const resolvedTickerCount = rows.filter((row) => row.event.tickerName?.trim()).length;
  const tickerCoverage = rows.length > 0 ? Math.round((resolvedTickerCount / rows.length) * 100) : 100;

  async function handleMarkMatched(row: DividendCalendarRow) {
    if (!row.ledgerEntry) return;
    setPendingRowKey(row.key);
    setErrorMessage("");
    try {
      await updateDividendReconciliation(row.ledgerEntry.id, "matched");
      await refreshSnapshot(query, activeMonthKey);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingRowKey(null);
    }
  }

  function openDrawer(row: DividendCalendarRow) {
    setDrawerRow(row);
    setIsDrawerDirty(false);
  }

  return (
    <div className="grid gap-4" data-testid="dividends-calendar-page">
      <section className="min-w-0 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">{dict.dividends.overview.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{dict.dividends.pageTitle}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{dict.dividends.pageDescription}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
          <div className="flex min-h-10 items-center rounded-lg border border-border bg-card p-1 shadow-sm" data-testid="dividends-month-picker">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={dict.dividends.previousMonth}
              data-testid="dividends-previous-month"
              onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <input
              type="month"
              aria-label={dict.dividends.overview.monthInputLabel}
              className="min-h-8 min-w-0 flex-1 border-x border-border bg-transparent px-3 text-center text-sm font-semibold text-foreground outline-none sm:w-[132px]"
              value={activeMonthKey}
              onChange={(event) => {
                if (event.target.value) setVisibleMonth(parseMonthKey(event.target.value));
              }}
              data-testid="dividends-month-input"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={dict.dividends.nextMonth}
              data-testid="dividends-next-month"
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const now = new Date();
              setVisibleMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
            }}
          >
            {dict.dividends.currentMonth}
          </Button>
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted"
            href={reviewHref(bounds, activeMonthKey)}
          >
            {dict.dividends.viewAllLink}
          </Link>
        </div>
      </section>

      <section className="min-w-0 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={dict.dividends.pageTitle}>
        <OverviewMetric label={dict.dividends.overview.expected} value={formatCurrencyTotals(expectedTotals, locale)} detail={formatTemplate(dict.dividends.overview.eventsScheduled, { count: formatNumber(rows.length, locale) })} tone="neutral" />
        <OverviewMetric label={dict.dividends.overview.received} value={formatCurrencyTotals(receivedTotals, locale)} detail={formatTemplate(dict.dividends.overview.receiptsPosted, { count: formatNumber(receiptRows.length, locale) })} tone="positive" />
        <OverviewMetric label={dict.dividends.overview.needsAction} value={formatNumber(actionRows.length, locale)} detail={formatTemplate(dict.dividends.overview.actionItems, { count: formatNumber(actionRows.length, locale) })} tone={actionRows.length > 0 ? "warning" : "positive"} />
        <OverviewMetric label={dict.dividends.overview.coverage} value={`${formatNumber(tickerCoverage, locale)}%`} detail={formatTemplate(dict.dividends.overview.tickerNamesResolved, { count: formatNumber(tickerCoverage, locale) })} tone={tickerCoverage === 100 ? "positive" : "warning"} />
      </section>

      {errorMessage ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{errorMessage}</p> : null}

      <section className="min-w-0 grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden rounded-lg border-border bg-card p-0 shadow-sm" data-testid="dividends-paying-today">
          <PanelHeading title={dict.dividends.overview.payingToday} description={dict.dividends.overview.payingTodayDescription} />
          {payingTodayRows.length === 0 ? (
            <div className="border-t border-border px-4 py-8 text-sm text-muted-foreground">{dict.dividends.overview.noPayingToday}</div>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {payingTodayRows.slice(0, 4).map((event) => (
                <TodayHighlightRow
                  key={`paying-${event.id}`}
                  event={event}
                  dict={dict}
                  locale={locale}
                  primaryDate={event.paymentDate ?? event.exDividendDate}
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden rounded-lg border-border bg-card p-0 shadow-sm" data-testid="dividends-ex-dividend-today">
          <PanelHeading title={dict.dividends.overview.exDividendToday} description={dict.dividends.overview.exDividendTodayDescription} />
          {exDividendTodayRows.length === 0 ? (
            <div className="border-t border-border px-4 py-8 text-sm text-muted-foreground">{dict.dividends.overview.noExDividendToday}</div>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {exDividendTodayRows.slice(0, 4).map((event) => (
                <TodayHighlightRow
                  key={`ex-${event.id}`}
                  event={event}
                  dict={dict}
                  locale={locale}
                  primaryDate={event.exDividendDate}
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="overflow-hidden rounded-lg border-border bg-card p-0 shadow-sm" data-testid="dividends-action-queue">
          <div data-testid="dividends-needs-action">
            <PanelHeading
              title={dict.dividends.overview.needsAction}
              description={formatTemplate(dict.dividends.overview.openItemsSummary, { count: formatNumber(actionRows.length, locale) })}
              badge={formatNumber(actionRows.length, locale)}
              action={(
                <Link
                  className="text-sm font-semibold text-primary hover:underline"
                  href={reviewHref(bounds, activeMonthKey, undefined, undefined, "needsReconciliation")}
                  data-testid="dividends-needs-action-view-all"
                >
                  {dict.dividends.overview.viewAllNeedsAction}
                </Link>
              )}
            />
            {prioritizedActionRows.length === 0 ? (
              <div className="border-t border-border px-4 py-8 text-sm text-muted-foreground">{dict.dividends.overview.noActionItems}</div>
            ) : (
              <div className="divide-y divide-border border-t border-border px-4">
                {prioritizedActionRows.slice(0, 3).map((row) => (
                  <ActionRow key={row.key} row={row} dict={dict} locale={locale} activeMonthKey={activeMonthKey} pending={pendingRowKey === row.key} onOpen={() => openDrawer(row)} onMarkMatched={() => void handleMarkMatched(row)} />
                ))}
              </div>
            )}
          </div>
        </Card>
      </section>

      <section className="min-w-0">
        <Card className="overflow-hidden rounded-lg border-border bg-card p-0 shadow-sm" data-testid="dividends-this-month">
          <PanelHeading title={dict.dividends.overview.thisMonth} description={dict.dividends.overview.thisMonthDescription} action={<Link className="text-sm font-semibold text-primary hover:underline" href={reviewHref(bounds, activeMonthKey)}>{dict.dividends.overview.openReview}</Link>} />
          <div className="hidden border-t border-border bg-muted/30 px-4 py-3 text-[11px] font-semibold uppercase text-muted-foreground xl:grid xl:grid-cols-[minmax(190px,1.4fr)_110px_110px_120px_110px] xl:gap-3">
            <div>{dict.dividends.review.table.ticker}</div>
            <div>{dict.dividends.overview.exDateLabel}</div>
            <div>{dict.dividends.overview.payDateLabel}</div>
            <div className="text-right">{dict.dividends.overview.amountLabel}</div>
            <div>{dict.dividends.overview.statusLabel}</div>
          </div>
          {tbdRows.length > 0 ? (
            <div className="border-t border-border bg-amber-50/70 px-4 py-3 text-sm font-medium text-amber-800" data-testid="dividends-tbd-section">
              {dict.dividends.paymentDateTbdSection}: {formatNumber(tbdRows.length, locale)}
            </div>
          ) : null}
          {rows.length === 0 ? (
            <div className="border-t border-border px-4 py-10 text-center text-sm text-muted-foreground">{dict.dividends.emptyState}</div>
          ) : (
            <div className="divide-y divide-border border-t border-border xl:border-t-0">
              {rows.map((row) => (
                <EventRow key={row.key} row={row} dict={dict} locale={locale} pending={pendingRowKey === row.key} onOpen={() => openDrawer(row)} onMarkMatched={() => void handleMarkMatched(row)} />
              ))}
            </div>
          )}
        </Card>
      </section>

      <Card className="overflow-hidden rounded-lg border-border bg-card p-0 shadow-sm" data-testid="dividends-recent-receipts">
        <PanelHeading title={dict.dividends.overview.recentReceipts} description={dict.dividends.overview.recentReceiptsDescription} action={<Link className="text-sm font-semibold text-primary hover:underline" href={reviewHref(bounds, activeMonthKey)}>{dict.dividends.overview.viewLedger}</Link>} />
        <div className="hidden border-t border-border bg-muted/30 px-4 py-3 text-[11px] font-semibold uppercase text-muted-foreground xl:grid xl:grid-cols-[minmax(190px,1.4fr)_110px_130px_130px_110px] xl:gap-3">
          <div>{dict.dividends.review.table.ticker}</div>
          <div>{dict.dividends.overview.postedLabel}</div>
          <div>{dict.dividends.overview.accountLabel}</div>
          <div className="text-right">{dict.dividends.overview.netAmountLabel}</div>
          <div>{dict.dividends.overview.statusLabel}</div>
        </div>
        {receiptRows.length === 0 ? (
          <div className="border-t border-border px-4 py-10 text-center text-sm text-muted-foreground">{dict.dividends.overview.noReceipts}</div>
        ) : (
          <div className="divide-y divide-border border-t border-border xl:border-t-0">
            {receiptRows.slice(0, 6).map((row) => (
              <ReceiptRow key={row.key} row={row} dict={dict} locale={locale} onOpen={() => openDrawer(row)} />
            ))}
          </div>
        )}
      </Card>

      {isLoading ? <p className="text-center text-sm text-muted-foreground" role="status">{dict.feedback.loadingDashboard}</p> : null}

      <Drawer
        open={drawerRow !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDrawerRow(null);
            setIsDrawerDirty(false);
          }
        }}
        title={drawerRow ? `${tickerLabel(drawerRow.event)} · ${eventAccountLabel(drawerRow.event)}` : dict.dividends.pageTitle}
        dirty={isDrawerDirty}
        dirtyConfirmMessage={dict.dividends.form.unsavedChangesConfirm}
      >
        {drawerRow && canWriteDividends ? (
          <DividendPostingForm
            row={drawerRow}
            dict={dict}
            locale={locale}
            onDirtyChange={setIsDrawerDirty}
            onCancel={() => {
              if (isDrawerDirty && typeof window !== "undefined") {
                const confirmed = window.confirm(dict.dividends.form.unsavedChangesConfirm);
                if (!confirmed) return;
              }
              setDrawerRow(null);
              setIsDrawerDirty(false);
            }}
            onSaved={async () => {
              await refreshSnapshot(query, activeMonthKey);
              setDrawerRow(null);
              setIsDrawerDirty(false);
            }}
          />
        ) : drawerRow ? (
          <Card className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-none">
            <p className="text-sm text-slate-700">{dict.tickerHistory.noWritePermission}</p>
          </Card>
        ) : null}
      </Drawer>
    </div>
  );
}

function OverviewMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "neutral" | "positive" | "warning" }) {
  return (
    <Card className="min-w-0 rounded-lg border-border bg-card p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-3 break-words text-2xl font-semibold text-foreground">{value}</p>
      <p className={cn("mt-2 text-sm", tone === "positive" ? "text-emerald-700" : tone === "warning" ? "text-amber-700" : "text-muted-foreground")}>{detail}</p>
    </Card>
  );
}

function PanelHeading({ title, description, action, badge }: { title: string; description: string; action?: ReactNode; badge?: string }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        {action}
        {badge ? <span className="inline-flex w-max rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">{badge}</span> : null}
      </div>
    </div>
  );
}

function TodayHighlightRow({
  event,
  dict,
  locale,
  primaryDate,
}: {
  event: DividendDailyHighlightRow;
  dict: AppDictionary;
  locale: LocaleCode;
  primaryDate: string;
}) {
  return (
    <div className="grid gap-2 px-4 py-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <TickerCell event={event} />
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{event.marketCode}</span>
      </div>
      <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <span>{dict.dividends.overview.dateLabel}: {formatDateLabel(primaryDate, locale)}</span>
        <span>{dict.dividends.overview.marketLabel}: {event.marketDateLabel}</span>
      </div>
      <div className="text-sm font-medium text-foreground">
        {formatCurrencyAmount(event.expectedCashAmount, event.cashDividendCurrency, locale)}
      </div>
    </div>
  );
}

function EventRow({ row, dict, locale, pending, onOpen, onMarkMatched }: { row: DividendCalendarRow; dict: AppDictionary; locale: LocaleCode; pending: boolean; onOpen: () => void; onMarkMatched: () => void }) {
  const badge = resolveBadge(row);
  const grossAmount = calculateGrossAmount(row.ledgerEntry);
  return (
    <div className="grid min-w-0 gap-2 px-4 py-4 text-sm xl:grid-cols-[minmax(190px,1.4fr)_110px_110px_120px_110px] xl:items-center xl:gap-3" data-testid={`dividend-row-${row.event.id}`}>
      <TickerCell event={row.event} />
      <MobileField label={dict.dividends.overview.exDateLabel}>{formatDateLabel(row.event.exDividendDate, locale)}</MobileField>
      <MobileField label={dict.dividends.overview.payDateLabel}>{row.event.paymentDate ? formatDateLabel(row.event.paymentDate, locale) : dict.dividends.paymentDateTbdSection}</MobileField>
      <MobileField label={dict.dividends.overview.amountLabel} className="font-semibold md:text-right">
        <span className="block">{formatCurrencyAmount(row.event.expectedCashAmount, row.event.cashDividendCurrency, locale)}</span>
        {grossAmount !== null && grossAmount !== row.event.expectedCashAmount ? (
          <span className="block text-xs font-medium text-muted-foreground">
            {formatCurrencyAmount(grossAmount, row.ledgerEntry?.cashCurrency ?? row.event.cashDividendCurrency, locale)}
          </span>
        ) : null}
      </MobileField>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge label={resolveBadgeLabel(dict, badge)} className={badgeClassName(badge)} testId={`dividend-badge-${row.event.id}`} />
        {row.ledgerEntry?.reconciliationStatus === "open" ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={onMarkMatched} data-testid={`dividend-mark-matched-${row.event.id}`}>
            {dict.dividends.action.markMatched}
          </Button>
        ) : null}
        <Button size="sm" variant={row.ledgerEntry ? "secondary" : "default"} onClick={onOpen} data-testid={row.ledgerEntry ? `dividend-edit-${row.event.id}` : `dividend-post-${row.event.id}`}>
          {row.ledgerEntry ? dict.dividends.action.edit : dict.dividends.action.postDividend}
        </Button>
      </div>
    </div>
  );
}

function ActionRow({ row, dict, locale, activeMonthKey, pending, onOpen, onMarkMatched }: { row: DividendCalendarRow; dict: AppDictionary; locale: LocaleCode; activeMonthKey: string; pending: boolean; onOpen: () => void; onMarkMatched: () => void }) {
  const sourceGap = row.ledgerEntry?.sourceCompositionStatus === "unknown_pending_disclosure";
  const badge = sourceGap ? null : resolveBadge(row);
  return (
    <div className="grid gap-3 py-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold text-foreground">{tickerLabel(row.event)}</p>
          <p className="mt-1 text-muted-foreground">{eventAccountLabel(row.event)} · {row.event.paymentDate ? formatDateLabel(row.event.paymentDate, locale) : dict.dividends.paymentDateTbdSection}</p>
        </div>
        <StatusBadge
          label={sourceGap ? dict.dividends.overview.sourceGap : resolveBadgeLabel(dict, badge ?? "pendingReview")}
          className={sourceGap ? "bg-amber-50 text-amber-700" : badgeClassName(badge ?? "pendingReview")}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {row.ledgerEntry?.reconciliationStatus === "open" ? (
          <Button size="sm" disabled={pending} onClick={onMarkMatched}>{dict.dividends.action.markMatched}</Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={onOpen}>{row.ledgerEntry ? dict.dividends.action.edit : dict.dividends.action.postDividend}</Button>
        <Link className="inline-flex min-h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted" href={reviewHref(monthBounds(parseMonthKey(row.event.paymentDate?.slice(0, 7) ?? monthKey(new Date()))), activeMonthKey, row.event.ticker, row.event.marketCode)}>
          {dict.dividends.overview.openReview}
        </Link>
      </div>
    </div>
  );
}

function ReceiptRow({ row, dict, locale, onOpen }: { row: DividendCalendarRow; dict: AppDictionary; locale: LocaleCode; onOpen: () => void }) {
  const entry = row.ledgerEntry;
  if (!entry) return null;
  const badge = resolveBadge(row);
  return (
    <button type="button" className="grid w-full min-w-0 gap-2 px-4 py-4 text-left text-sm hover:bg-muted/50 xl:grid-cols-[minmax(190px,1.4fr)_110px_130px_130px_110px] xl:items-center xl:gap-3" onClick={onOpen} data-testid={`dividend-receipt-${entry.id}`}>
      <TickerCell event={row.event} subLabel={`Ledger ${entry.id}`} />
      <MobileField label={dict.dividends.overview.postedLabel}>{formatDateLabel(entry.paymentDate ?? entry.bookedAt ?? row.event.paymentDate ?? row.event.exDividendDate, locale)}</MobileField>
      <MobileField label={dict.dividends.overview.accountLabel}>{eventAccountLabel(row.event)}</MobileField>
      <MobileField label={dict.dividends.overview.netAmountLabel} className="font-semibold md:text-right">{formatCurrencyAmount(entry.receivedCashAmount, entry.cashCurrency, locale)}</MobileField>
      <div><StatusBadge label={resolveBadgeLabel(dict, badge)} className={badgeClassName(badge)} testId={`dividend-badge-${row.event.id}`} /></div>
    </button>
  );
}

function TickerCell({ event, subLabel }: { event: DividendEventListItem; subLabel?: string }) {
  return (
    <div className="min-w-0">
      <p className="break-words font-semibold text-foreground">{tickerLabel(event)}</p>
      <p className="mt-1 truncate text-sm text-muted-foreground">{subLabel ?? eventAccountLabel(event)}</p>
    </div>
  );
}

function MobileField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 md:block">
      <span className="text-[11px] font-semibold uppercase text-muted-foreground md:hidden">{label}</span>
      <span className={cn("text-foreground", className)}>{children}</span>
    </div>
  );
}

function StatusBadge({ label, className, testId }: { label: string; className: string; testId?: string }) {
  return <span className={cn("inline-flex w-max rounded-full px-2.5 py-1 text-xs font-semibold", className)} data-testid={testId}>{label}</span>;
}
