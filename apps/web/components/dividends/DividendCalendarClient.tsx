"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CurrencyCode, DividendDailyHighlightsDto, LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { useEventStream } from "../../hooks/useEventStream";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendDailyHighlights,
  fetchDividendLedgerEntry,
  type DividendQuery,
  updateDividendReconciliation,
} from "../../features/dividends/services/dividendService";
import { mapDividendDailyHighlightItem, type DividendDailyHighlightRow } from "../../features/dividends/dailyHighlights";
import {
  buildTickerShareSummaries,
  dividendEventTypeLabel,
  formatDividendRatio,
  formatDividendShares,
  isCashDividendEvent,
  isStockDividendEvent,
  stockRatioStateLabel,
} from "../../features/dividends/presentation";
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
import { DividendCalculationPanel } from "../../features/dividends/components/DividendCalculationPanel";
import { DIVIDENDS_LEDGER_ONLY_PARAMS } from "./dividendsTabsUtils";
import { useOptionalAppShellData } from "../layout/AppShellDataContext";
import { clearDividendReviewCaches } from "../../features/dividends/dividendReviewCache";

interface DividendCalendarClientProps {
  initialSnapshot: DividendCalendarSnapshot;
  initialMonth: string;
  initialDailyHighlights?: DividendDailyHighlightsState;
  dict: AppDictionary;
  locale: LocaleCode;
  onSnapshotChange?: (snapshot: DividendCalendarSnapshot, month: string) => void;
}

export interface DividendDailyHighlightCardState {
  status: "success" | "error";
  data: DividendDailyHighlightsDto["payingToday"];
  error: string;
}

export interface DividendDailyHighlightsState {
  payingToday: DividendDailyHighlightCardState;
  exDividendToday: DividendDailyHighlightCardState;
}

type DailyHighlightCardKey = keyof DividendDailyHighlightsState;
interface DailyHighlightCardViewState {
  status: "success" | "refreshing" | "error";
  data: DividendDailyHighlightRow[];
  error: string;
}

type CalendarBadge = "unposted" | "pendingReview" | "posted" | "postedVariance" | "resolved" | "matched" | "explained";
type CurrencyTotals = Partial<Record<CurrencyCode, number>>;
type StockSummaryLike = Pick<DividendEventListItem, "marketCode" | "ticker" | "tickerName"> & { quantity: number };

const THIS_MONTH_DESKTOP_GRID = "xl:grid-cols-[minmax(220px,1.5fr)_120px_120px_minmax(240px,1.4fr)_minmax(180px,1fr)]";

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
    if (entry.postingStatus === "expected") continue;
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
  const stockExpectedUnavailable = row.ledgerEntry.expectedStockCalcState === "needs_action"
    || row.ledgerEntry.stockDistributionRatioState === "unresolved";
  return grossAmount !== row.ledgerEntry.expectedCashAmount
    || (!stockExpectedUnavailable
      && row.ledgerEntry.receivedStockQuantity !== row.ledgerEntry.expectedStockQuantity);
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
  if (row.event.eventType !== "CASH" && row.event.stockDistributionRatioState === "unresolved") return 1;
  if (row.ledgerEntry?.reconciliationStatus === "open") return 1;
  return 2;
}

function eventTypeBadgeClassName(eventType: DividendEventListItem["eventType"]): string {
  switch (eventType) {
    case "STOCK":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "CASH_AND_STOCK":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function ratioToneClassName(
  state: DividendEventListItem["stockDistributionRatioState"] | DividendLedgerEntryDetails["stockDistributionRatioState"],
  calcState?: DividendLedgerEntryDetails["expectedStockCalcState"] | null,
): string {
  if (calcState === "needs_action" || state === "unresolved") {
    return "text-amber-700";
  }
  if (state === "derived_non_authoritative") {
    return "text-slate-500";
  }
  return "text-muted-foreground";
}

function stockMetricSupplementary(
  dict: AppDictionary,
  locale: LocaleCode,
  detailTemplate: string,
  rows: readonly StockSummaryLike[],
): string[] {
  if (rows.length === 0) return [];
  const summary = buildTickerShareSummaries(rows, locale, dict);
  const lines = [
    formatTemplate(detailTemplate, { count: formatNumber(rows.length, locale) }),
    ...summary.items,
  ];
  if (summary.overflowCount > 0) {
    lines.push(formatTemplate(dict.dividends.overview.moreTickerQuantities, { count: formatNumber(summary.overflowCount, locale) }));
  }
  return lines;
}

function stockIssueLabel(dict: AppDictionary, row: DividendCalendarRow): string | null {
  if (!isStockDividendEvent(row.event.eventType)) return null;
  const expectedStockCalcState = row.ledgerEntry?.expectedStockCalcState
    ?? (row.event.stockDistributionRatioState === "unresolved" ? "needs_action" : "resolved");
  if (expectedStockCalcState === "needs_action" || row.event.stockDistributionRatioState === "unresolved") {
    return `${dict.dividends.overview.stockNeedsAction}: ${dict.dividends.stockRatioState.unresolved}`;
  }
  return null;
}

export function DividendCalendarClient({ initialSnapshot, initialMonth, initialDailyHighlights, dict, locale, onSnapshotChange }: DividendCalendarClientProps) {
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
  const [payingTodayState, setPayingTodayState] = useState<DailyHighlightCardViewState>(() => ({
    status: initialDailyHighlights?.payingToday.status ?? "refreshing",
    data: (initialDailyHighlights?.payingToday.data ?? []).map((item) => mapDividendDailyHighlightItem(item, locale)),
    error: initialDailyHighlights?.payingToday.error ?? "",
  }));
  const [exDividendTodayState, setExDividendTodayState] = useState<DailyHighlightCardViewState>(() => ({
    status: initialDailyHighlights?.exDividendToday.status ?? "refreshing",
    data: (initialDailyHighlights?.exDividendToday.data ?? []).map((item) => mapDividendDailyHighlightItem(item, locale)),
    error: initialDailyHighlights?.exDividendToday.error ?? "",
  }));
  const activeMonthKey = monthKey(visibleMonth);
  const bounds = useMemo(() => monthBounds(visibleMonth), [visibleMonth]);
  const query = useMemo<DividendQuery>(() => ({ ...bounds, limit: 500 }), [bounds]);
  const initialQueryKey = useRef(JSON.stringify(query));
  const didSkipInitialQueryRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const activeRequestRef = useRef<AbortController | null>(null);
  const highlightsRequestSequenceRef = useRef<Record<DailyHighlightCardKey, number>>({ payingToday: 0, exDividendToday: 0 });
  const highlightsRequestControllersRef = useRef(new Set<AbortController>());
  const shouldFetchInitialHighlightsRef = useRef(initialDailyHighlights === undefined);
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

  const refreshDailyHighlights = useCallback(async (
    cards: readonly DailyHighlightCardKey[] = ["payingToday", "exDividendToday"],
  ) => {
    const requestIds = new Map(cards.map((card) => {
      const requestId = highlightsRequestSequenceRef.current[card] + 1;
      highlightsRequestSequenceRef.current[card] = requestId;
      return [card, requestId] as const;
    }));
    const controller = new AbortController();
    highlightsRequestControllersRef.current.add(controller);
    if (cards.includes("payingToday")) {
      setPayingTodayState((current) => ({ ...current, status: "refreshing", error: "" }));
    }
    if (cards.includes("exDividendToday")) {
      setExDividendTodayState((current) => ({ ...current, status: "refreshing", error: "" }));
    }

    try {
      const nextHighlights = await fetchDividendDailyHighlights({ signal: controller.signal });
      if (requestIds.get("payingToday") === highlightsRequestSequenceRef.current.payingToday) {
        setPayingTodayState({
          status: "success",
          data: nextHighlights.payingToday.map((item) => mapDividendDailyHighlightItem(item, locale)),
          error: "",
        });
      }
      if (requestIds.get("exDividendToday") === highlightsRequestSequenceRef.current.exDividendToday) {
        setExDividendTodayState({
          status: "success",
          data: nextHighlights.exDividendToday.map((item) => mapDividendDailyHighlightItem(item, locale)),
          error: "",
        });
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (requestIds.get("payingToday") === highlightsRequestSequenceRef.current.payingToday) {
        setPayingTodayState((current) => ({ ...current, status: "error", error: message }));
      }
      if (requestIds.get("exDividendToday") === highlightsRequestSequenceRef.current.exDividendToday) {
        setExDividendTodayState((current) => ({ ...current, status: "error", error: message }));
      }
    } finally {
      highlightsRequestControllersRef.current.delete(controller);
    }
  }, [locale]);

  useEffect(() => {
    if (!shouldFetchInitialHighlightsRef.current) return;
    shouldFetchInitialHighlightsRef.current = false;
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
    highlightsRequestSequenceRef.current.payingToday += 1;
    highlightsRequestSequenceRef.current.exDividendToday += 1;
    for (const controller of highlightsRequestControllersRef.current) controller.abort();
    highlightsRequestControllersRef.current.clear();
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
      clearDividendReviewCaches();
      void refreshSnapshot(query, activeMonthKey);
      void refreshDailyHighlights();
    },
  });

  const rows = useMemo(() => buildRows(snapshot), [snapshot]);
  const eventById = useMemo(() => new Map(rows.map((row) => [row.event.id, row.event])), [rows]);
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
  const expectedStockRows = rows
    .filter((row) => {
      if (!isStockDividendEvent(row.event.eventType)) return false;
      const calcState = row.ledgerEntry?.expectedStockCalcState
        ?? (row.event.stockDistributionRatioState === "unresolved" ? "needs_action" : "resolved");
      return calcState !== "needs_action"
        && row.event.stockDistributionRatioState !== "unresolved"
        && row.event.expectedStockQuantity != null;
    })
    .map((row) => ({
      marketCode: row.event.marketCode,
      ticker: row.event.ticker,
      tickerName: row.event.tickerName,
      quantity: row.event.expectedStockQuantity as number,
    }));
  const receivedStockRows = receiptRows
    .filter((row) => row.ledgerEntry && isStockDividendEvent(row.ledgerEntry.eventType))
    .map((row) => ({
      marketCode: row.event.marketCode,
      ticker: row.event.ticker,
      tickerName: row.event.tickerName,
      quantity: row.ledgerEntry?.receivedStockQuantity ?? 0,
    }));
  const expectedMetricSupplementary = stockMetricSupplementary(
    dict,
    locale,
    dict.dividends.overview.stockEventsDetail,
    expectedStockRows,
  );
  const receivedMetricSupplementary = stockMetricSupplementary(
    dict,
    locale,
    dict.dividends.overview.stockPostingsDetail,
    receivedStockRows,
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
    if (row.ledgerEntry) {
      void fetchDividendLedgerEntry(row.ledgerEntry.id)
        .then((next) => {
          setDrawerRow((current) => current?.key === row.key ? { ...current, ledgerEntry: next } : current);
        })
        .catch(() => undefined);
    }
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
        <OverviewMetric
          label={dict.dividends.overview.expected}
          value={formatCurrencyTotals(expectedTotals, locale)}
          detail={formatTemplate(dict.dividends.overview.eventsScheduled, { count: formatNumber(rows.length, locale) })}
          supplementary={expectedMetricSupplementary}
          tone="neutral"
        />
        <OverviewMetric
          label={dict.dividends.overview.received}
          value={formatCurrencyTotals(receivedTotals, locale)}
          detail={formatTemplate(dict.dividends.overview.receiptsPosted, { count: formatNumber(receiptRows.length, locale) })}
          supplementary={receivedMetricSupplementary}
          tone="positive"
        />
        <OverviewMetric label={dict.dividends.overview.needsAction} value={formatNumber(actionRows.length, locale)} detail={formatTemplate(dict.dividends.overview.actionItems, { count: formatNumber(actionRows.length, locale) })} tone={actionRows.length > 0 ? "warning" : "positive"} />
        <OverviewMetric label={dict.dividends.overview.coverage} value={`${formatNumber(tickerCoverage, locale)}%`} detail={formatTemplate(dict.dividends.overview.tickerNamesResolved, { count: formatNumber(tickerCoverage, locale) })} tone={tickerCoverage === 100 ? "positive" : "warning"} />
      </section>

      {errorMessage ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{errorMessage}</p> : null}

      <section className="min-w-0 grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden rounded-lg border-border bg-card p-0 shadow-sm" data-testid="dividends-paying-today">
          <PanelHeading
            title={dict.dividends.overview.payingToday}
            description={dict.dividends.overview.payingTodayDescription}
            action={payingTodayState.status === "refreshing"
              ? <DailyHighlightsRefreshing dict={dict} testId="paying-today-refreshing" />
              : undefined}
          />
          {payingTodayState.status === "error" && payingTodayState.data.length === 0 ? (
            <DailyHighlightsError dict={dict} testIdPrefix="paying-today" onRetry={() => void refreshDailyHighlights(["payingToday"])} />
          ) : payingTodayState.data.length === 0 ? (
            <div className="border-t border-border px-4 py-8 text-sm text-muted-foreground">{dict.dividends.overview.noPayingToday}</div>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {payingTodayState.data.slice(0, 4).map((event) => (
                <TodayHighlightRow
                  key={`paying-${event.id}`}
                  event={event}
                  snapshotEvent={eventById.get(event.id) ?? null}
                  dict={dict}
                  locale={locale}
                  primaryLabel={dict.dividends.overview.payDateLabel}
                  primaryDate={event.paymentDate ?? event.exDividendDate}
                  showTbdWhenMissing
                />
              ))}
            </div>
          )}
          {payingTodayState.status === "error" && payingTodayState.data.length > 0 ? (
            <DailyHighlightsError dict={dict} testIdPrefix="paying-today" onRetry={() => void refreshDailyHighlights(["payingToday"])} />
          ) : null}
        </Card>

        <Card className="overflow-hidden rounded-lg border-border bg-card p-0 shadow-sm" data-testid="dividends-ex-dividend-today">
          <PanelHeading
            title={dict.dividends.overview.exDividendToday}
            description={dict.dividends.overview.exDividendTodayDescription}
            action={exDividendTodayState.status === "refreshing"
              ? <DailyHighlightsRefreshing dict={dict} testId="ex-dividend-today-refreshing" />
              : undefined}
          />
          {exDividendTodayState.status === "error" && exDividendTodayState.data.length === 0 ? (
            <DailyHighlightsError dict={dict} testIdPrefix="ex-dividend-today" onRetry={() => void refreshDailyHighlights(["exDividendToday"])} />
          ) : exDividendTodayState.data.length === 0 ? (
            <div className="border-t border-border px-4 py-8 text-sm text-muted-foreground">{dict.dividends.overview.noExDividendToday}</div>
          ) : (
            <div className="divide-y divide-border border-t border-border">
              {exDividendTodayState.data.slice(0, 4).map((event) => (
                <TodayHighlightRow
                  key={`ex-${event.id}`}
                  event={event}
                  snapshotEvent={eventById.get(event.id) ?? null}
                  dict={dict}
                  locale={locale}
                  primaryLabel={dict.dividends.overview.exDateLabel}
                  primaryDate={event.exDividendDate}
                  showTbdWhenMissing={false}
                />
              ))}
            </div>
          )}
          {exDividendTodayState.status === "error" && exDividendTodayState.data.length > 0 ? (
            <DailyHighlightsError dict={dict} testIdPrefix="ex-dividend-today" onRetry={() => void refreshDailyHighlights(["exDividendToday"])} />
          ) : null}
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
                  <ActionRow
                    key={row.key}
                    row={row}
                    dict={dict}
                    locale={locale}
                    activeMonthKey={activeMonthKey}
                    pending={pendingRowKey === row.key}
                    canWrite={canWriteDividends}
                    onOpen={canWriteDividends || isStockDividendEvent(row.event.eventType) ? () => openDrawer(row) : undefined}
                    onMarkMatched={canWriteDividends ? () => void handleMarkMatched(row) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      </section>

      <section className="min-w-0">
        <Card className="overflow-hidden rounded-lg border-border bg-card p-0 shadow-sm" data-testid="dividends-this-month">
          <PanelHeading title={dict.dividends.overview.thisMonth} description={dict.dividends.overview.thisMonthDescription} action={<Link className="text-sm font-semibold text-primary hover:underline" href={reviewHref(bounds, activeMonthKey)}>{dict.dividends.overview.openReview}</Link>} />
          <div
            className={cn("hidden border-t border-border bg-muted/30 px-4 py-3 text-[11px] font-semibold uppercase text-muted-foreground xl:grid xl:gap-3", THIS_MONTH_DESKTOP_GRID)}
            data-testid="dividends-this-month-grid-header"
          >
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
                <EventRow
                  key={row.key}
                  row={row}
                  dict={dict}
                  locale={locale}
                  pending={pendingRowKey === row.key}
                  canWrite={canWriteDividends}
                  onOpen={canWriteDividends || isStockDividendEvent(row.event.eventType) ? () => openDrawer(row) : undefined}
                  onMarkMatched={canWriteDividends ? () => void handleMarkMatched(row) : undefined}
                />
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
              <ReceiptRow
                key={row.key}
                row={row}
                dict={dict}
                locale={locale}
                onOpen={canWriteDividends || isStockDividendEvent(row.event.eventType) ? () => openDrawer(row) : undefined}
              />
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
            onCalculationChanged={async () => {
              if (drawerRow.ledgerEntry) {
                const next = await fetchDividendLedgerEntry(drawerRow.ledgerEntry.id);
                setDrawerRow((current) => current?.key === drawerRow.key ? { ...current, ledgerEntry: next } : current);
              }
              await refreshSnapshot(query, activeMonthKey);
            }}
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
          <div className="grid gap-4">
            {drawerRow.event.eventType !== "CASH" ? (
              <DividendCalculationPanel
                accountId={drawerRow.event.accountId}
                dividendEventId={drawerRow.event.id}
                marketCode={drawerRow.event.marketCode}
                initialMethod={(drawerRow.ledgerEntry?.stockDistributionRatioState ?? drawerRow.event.stockDistributionRatioState) === "authoritative"
                  ? "provider_ratio"
                  : drawerRow.event.marketCode === "TW" ? "derived_from_par_value" : "custom_ratio"}
                canManageAccountDefaults={false}
                canWriteCalculations={false}
                dividendLedgerEntryId={drawerRow.ledgerEntry?.id ?? null}
                initialProvider={drawerRow.ledgerEntry?.provider}
                activeCalculation={drawerRow.ledgerEntry?.activeCalculation}
                calculationHistory={drawerRow.ledgerEntry?.calculationHistory}
                dict={dict}
                locale={locale}
              />
            ) : null}
            <Card className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-none">
              <p className="text-sm text-slate-700">{dict.tickerHistory.noWritePermission}</p>
            </Card>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  detail,
  supplementary,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  supplementary?: string[];
  tone: "neutral" | "positive" | "warning";
}) {
  return (
    <Card className="min-w-0 rounded-lg border-border bg-card p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-3 break-words text-2xl font-semibold text-foreground">{value}</p>
      <p className={cn("mt-2 text-sm", tone === "positive" ? "text-emerald-700" : tone === "warning" ? "text-amber-700" : "text-muted-foreground")}>{detail}</p>
      {supplementary && supplementary.length > 0 ? (
        <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {supplementary.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
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

function DailyHighlightsRefreshing({ dict, testId }: { dict: AppDictionary; testId: string }) {
  return (
    <span className="text-xs font-medium text-muted-foreground" role="status" data-testid={testId}>
      {dict.dividends.overview.dailyHighlightsRefreshing}
    </span>
  );
}

function DailyHighlightsError({ dict, testIdPrefix, onRetry }: { dict: AppDictionary; testIdPrefix: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-destructive/20 bg-destructive/5 px-4 py-3" role="alert" data-testid={`${testIdPrefix}-error`}>
      <div>
        <p className="text-sm font-semibold text-destructive">{dict.dividends.overview.dailyHighlightsUnavailable}</p>
        <p className="mt-1 text-xs text-muted-foreground">{dict.dividends.overview.dailyHighlightsUnavailableDescription}</p>
      </div>
      <Button size="sm" variant="secondary" onClick={onRetry} data-testid={`${testIdPrefix}-retry`}>
        {dict.dividends.overview.retryDailyHighlights}
      </Button>
    </div>
  );
}

function TodayHighlightRow({
  event,
  snapshotEvent,
  dict,
  locale,
  primaryLabel,
  primaryDate,
  showTbdWhenMissing,
}: {
  event: DividendDailyHighlightRow;
  snapshotEvent: DividendEventListItem | null;
  dict: AppDictionary;
  locale: LocaleCode;
  primaryLabel: string;
  primaryDate: string;
  showTbdWhenMissing?: boolean;
}) {
  const stockDistributionRatio = snapshotEvent?.stockDistributionRatio ?? null;
  const stockDistributionRatioState = snapshotEvent?.stockDistributionRatioState ?? "unresolved";
  return (
    <div className="grid gap-2 px-4 py-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <TickerCell event={event} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <EventTypeBadge dict={dict} eventType={event.eventType} />
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{event.marketCode}</span>
        </div>
      </div>
      <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <span>{primaryLabel}: {showTbdWhenMissing && !event.paymentDate ? dict.dividends.paymentDateTbdSection : formatDateLabel(primaryDate, locale)}</span>
        <span>{dict.dividends.overview.marketLabel}: {event.marketDateLabel}</span>
      </div>
      <div className="grid gap-1.5">
        {isCashDividendEvent(event.eventType) ? (
          <HighlightValueLine
            label={dict.dividends.overview.expectedCashLabel}
            value={formatCurrencyAmount(event.expectedCashAmount, event.cashDividendCurrency, locale)}
          />
        ) : null}
        {isStockDividendEvent(event.eventType) ? (
          <>
            <HighlightValueLine
              label={dict.dividends.overview.expectedStockLabel}
              value={stockDistributionRatioState === "unresolved" || event.expectedStockQuantity == null
                ? dict.dividends.unavailable
                : formatDividendShares(event.expectedStockQuantity, locale, dict)}
            />
            <HighlightValueLine
              label={dict.dividends.overview.ratioLabel}
              value={stockDistributionRatio == null
                ? stockRatioStateLabel(dict, stockDistributionRatioState, "needs_action")
                : `${formatDividendRatio(stockDistributionRatio, locale)} · ${stockRatioStateLabel(dict, stockDistributionRatioState)}`}
              tone={stockDistributionRatio == null ? "warning" : "muted"}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function EventRow({ row, dict, locale, pending, canWrite, onOpen, onMarkMatched }: { row: DividendCalendarRow; dict: AppDictionary; locale: LocaleCode; pending: boolean; canWrite: boolean; onOpen?: () => void; onMarkMatched?: () => void }) {
  const badge = resolveBadge(row);
  const grossAmount = calculateGrossAmount(row.ledgerEntry);
  const ratio = row.ledgerEntry?.stockDistributionRatio ?? row.event.stockDistributionRatio;
  const ratioState = row.ledgerEntry?.stockDistributionRatioState ?? row.event.stockDistributionRatioState;
  const stockCalcState = row.ledgerEntry?.expectedStockCalcState
    ?? (row.event.stockDistributionRatioState === "unresolved" ? "needs_action" : "resolved");
  const stockIssue = stockIssueLabel(dict, row);
  return (
    <div className={cn("grid min-w-0 gap-2 px-4 py-4 text-sm xl:items-center xl:gap-3", THIS_MONTH_DESKTOP_GRID)} data-testid={`dividend-row-${row.event.id}`}>
      <div className="grid gap-2">
        <TickerCell event={row.event} />
        <div className="flex flex-wrap items-center gap-2">
          <EventTypeBadge dict={dict} eventType={row.event.eventType} />
        </div>
      </div>
      <MobileField label={dict.dividends.overview.exDateLabel}>{formatDateLabel(row.event.exDividendDate, locale)}</MobileField>
      <MobileField label={dict.dividends.overview.payDateLabel}>{row.event.paymentDate ? formatDateLabel(row.event.paymentDate, locale) : dict.dividends.paymentDateTbdSection}</MobileField>
      <MobileField label={dict.dividends.overview.amountLabel} className="xl:text-right">
        <div className="grid gap-1 text-left xl:text-right">
          {isCashDividendEvent(row.event.eventType) ? (
            <StackedValueLine
              label={dict.dividends.overview.expectedCashLabel}
              value={formatCurrencyAmount(row.event.expectedCashAmount, row.event.cashDividendCurrency, locale)}
            />
          ) : null}
          {isStockDividendEvent(row.event.eventType) ? (
            <>
              <StackedValueLine
                label={dict.dividends.overview.expectedStockLabel}
                value={stockCalcState === "needs_action" || ratioState === "unresolved" || row.event.expectedStockQuantity == null
                  ? dict.dividends.unavailable
                  : formatDividendShares(row.event.expectedStockQuantity, locale, dict)}
              />
              <StackedValueLine
                label={dict.dividends.overview.ratioLabel}
                value={ratio == null
                  ? stockRatioStateLabel(dict, ratioState, stockCalcState)
                  : `${formatDividendRatio(ratio, locale)} · ${stockRatioStateLabel(dict, ratioState, stockCalcState)}`}
                toneClassName={ratioToneClassName(ratioState, stockCalcState)}
              />
            </>
          ) : null}
          {grossAmount !== null && grossAmount !== row.event.expectedCashAmount ? (
            <StackedValueLine
              label={dict.dividends.overview.receivedCashLabel}
              value={formatCurrencyAmount(grossAmount, row.ledgerEntry?.cashCurrency ?? row.event.cashDividendCurrency, locale)}
              toneClassName="text-muted-foreground"
            />
          ) : null}
        </div>
      </MobileField>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={resolveBadgeLabel(dict, badge)} className={badgeClassName(badge)} testId={`dividend-badge-${row.event.id}`} />
          {stockIssue ? <span className="text-xs font-medium text-amber-700">{stockIssue}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {row.ledgerEntry?.reconciliationStatus === "open" && onMarkMatched ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={onMarkMatched} data-testid={`dividend-mark-matched-${row.event.id}`}>
              {dict.dividends.action.markMatched}
            </Button>
          ) : null}
          {onOpen ? (
            <Button
              size="sm"
              variant={canWrite && !row.ledgerEntry ? "default" : "secondary"}
              onClick={onOpen}
              data-testid={canWrite
                ? row.ledgerEntry ? `dividend-edit-${row.event.id}` : `dividend-post-${row.event.id}`
                : `dividend-view-details-${row.event.id}`}
            >
              {canWrite
                ? row.ledgerEntry ? dict.dividends.action.edit : dict.dividends.action.postDividend
                : dict.dividends.action.viewDetails}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ActionRow({ row, dict, locale, activeMonthKey, pending, canWrite, onOpen, onMarkMatched }: { row: DividendCalendarRow; dict: AppDictionary; locale: LocaleCode; activeMonthKey: string; pending: boolean; canWrite: boolean; onOpen?: () => void; onMarkMatched?: () => void }) {
  const sourceGap = row.ledgerEntry?.sourceCompositionStatus === "unknown_pending_disclosure";
  const badge = sourceGap ? null : resolveBadge(row);
  const stockIssue = stockIssueLabel(dict, row);
  const ratio = row.ledgerEntry?.stockDistributionRatio ?? row.event.stockDistributionRatio;
  const ratioState = row.ledgerEntry?.stockDistributionRatioState ?? row.event.stockDistributionRatioState;
  const stockCalcState = row.ledgerEntry?.expectedStockCalcState
    ?? (row.event.stockDistributionRatioState === "unresolved" ? "needs_action" : "resolved");
  return (
    <div className="grid gap-3 py-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold text-foreground">{tickerLabel(row.event)}</p>
          <p className="mt-1 text-muted-foreground">{eventAccountLabel(row.event)} · {row.event.paymentDate ? formatDateLabel(row.event.paymentDate, locale) : dict.dividends.paymentDateTbdSection}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <EventTypeBadge dict={dict} eventType={row.event.eventType} />
          </div>
        </div>
        <StatusBadge
          label={sourceGap ? dict.dividends.overview.sourceGap : resolveBadgeLabel(dict, badge ?? "pendingReview")}
          className={sourceGap ? "bg-amber-50 text-amber-700" : badgeClassName(badge ?? "pendingReview")}
        />
      </div>
      <div className="grid gap-1 text-xs text-muted-foreground">
        {isCashDividendEvent(row.event.eventType) ? (
          <span>{dict.dividends.overview.expectedCashLabel}: {formatCurrencyAmount(row.event.expectedCashAmount, row.event.cashDividendCurrency, locale)}</span>
        ) : null}
        {isStockDividendEvent(row.event.eventType) ? (
          <span>
            {dict.dividends.overview.expectedStockLabel}: {stockCalcState === "needs_action" || ratioState === "unresolved"
              || row.event.expectedStockQuantity == null
              ? dict.dividends.unavailable
              : formatDividendShares(row.event.expectedStockQuantity, locale, dict)}
          </span>
        ) : null}
        {isStockDividendEvent(row.event.eventType) ? (
          <span className={ratioToneClassName(ratioState, stockCalcState)}>
            {dict.dividends.overview.ratioLabel}: {ratio == null
              ? stockRatioStateLabel(dict, ratioState, stockCalcState)
              : `${formatDividendRatio(ratio, locale)} · ${stockRatioStateLabel(dict, ratioState, stockCalcState)}`}
          </span>
        ) : null}
        {stockIssue ? <span className="font-medium text-amber-700">{stockIssue}</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {row.ledgerEntry?.reconciliationStatus === "open" && onMarkMatched ? (
          <Button size="sm" disabled={pending} onClick={onMarkMatched}>{dict.dividends.action.markMatched}</Button>
        ) : null}
        {onOpen ? (
          <Button size="sm" variant="secondary" onClick={onOpen}>
            {canWrite
              ? row.ledgerEntry ? dict.dividends.action.edit : dict.dividends.action.postDividend
              : dict.dividends.action.viewDetails}
          </Button>
        ) : null}
        <Link className="inline-flex min-h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted" href={reviewHref(monthBounds(parseMonthKey(row.event.paymentDate?.slice(0, 7) ?? monthKey(new Date()))), activeMonthKey, row.event.ticker, row.event.marketCode)}>
          {dict.dividends.overview.openReview}
        </Link>
      </div>
    </div>
  );
}

function ReceiptRow({ row, dict, locale, onOpen }: { row: DividendCalendarRow; dict: AppDictionary; locale: LocaleCode; onOpen?: () => void }) {
  const entry = row.ledgerEntry;
  if (!entry) return null;
  const badge = resolveBadge(row);
  return (
    <button type="button" className="grid w-full min-w-0 gap-2 px-4 py-4 text-left text-sm enabled:hover:bg-muted/50 disabled:cursor-default xl:grid-cols-[minmax(220px,1.4fr)_120px_130px_minmax(240px,1.2fr)_110px] xl:items-center xl:gap-3" onClick={onOpen} disabled={!onOpen} data-testid={`dividend-receipt-${entry.id}`}>
      <div className="grid gap-2">
        <TickerCell event={row.event} subLabel={`Ledger ${entry.id}`} />
        <div className="flex flex-wrap items-center gap-2">
          <EventTypeBadge dict={dict} eventType={entry.eventType} />
        </div>
      </div>
      <MobileField label={dict.dividends.overview.postedLabel}>{formatDateLabel(entry.paymentDate ?? entry.bookedAt ?? row.event.paymentDate ?? row.event.exDividendDate, locale)}</MobileField>
      <MobileField label={dict.dividends.overview.accountLabel}>{eventAccountLabel(row.event)}</MobileField>
      <MobileField label={dict.dividends.overview.netAmountLabel} className="xl:text-right">
        <div className="grid gap-1 text-left xl:text-right">
          {isCashDividendEvent(entry.eventType) ? (
            <StackedValueLine
              label={dict.dividends.overview.receivedCashLabel}
              value={formatCurrencyAmount(entry.receivedCashAmount, entry.cashCurrency, locale)}
            />
          ) : null}
          {isStockDividendEvent(entry.eventType) ? (
            <StackedValueLine
              label={dict.dividends.overview.receivedStockLabel}
              value={formatDividendShares(entry.receivedStockQuantity, locale, dict)}
            />
          ) : null}
          {entry.cashInLieuAmount != null && entry.cashInLieuAmount > 0 ? (
            <StackedValueLine
              label={dict.dividends.overview.cashInLieuLabel}
              value={formatCurrencyAmount(entry.cashInLieuAmount, entry.cashCurrency, locale)}
              toneClassName="text-muted-foreground"
            />
          ) : null}
        </div>
      </MobileField>
      <div><StatusBadge label={resolveBadgeLabel(dict, badge)} className={badgeClassName(badge)} testId={`dividend-badge-${row.event.id}`} /></div>
    </button>
  );
}

function TickerCell({ event, subLabel }: {
  event: Pick<DividendEventListItem, "accountId" | "accountName" | "ticker" | "tickerName">;
  subLabel?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="break-words font-semibold text-foreground">{tickerLabel(event)}</p>
      <p className="mt-1 truncate text-sm text-muted-foreground">{subLabel ?? eventAccountLabel(event)}</p>
    </div>
  );
}

function MobileField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 xl:block">
      <span className="text-[11px] font-semibold uppercase text-muted-foreground xl:hidden">{label}</span>
      <span className={cn("text-foreground", className)}>{children}</span>
    </div>
  );
}

function StatusBadge({ label, className, testId }: { label: string; className: string; testId?: string }) {
  return <span className={cn("inline-flex w-max rounded-full px-2.5 py-1 text-xs font-semibold", className)} data-testid={testId}>{label}</span>;
}

function EventTypeBadge({ dict, eventType }: { dict: AppDictionary; eventType: DividendEventListItem["eventType"] }) {
  return (
    <span className={cn("inline-flex w-max rounded-full border px-2.5 py-1 text-xs font-semibold", eventTypeBadgeClassName(eventType))}>
      {dividendEventTypeLabel(dict, eventType)}
    </span>
  );
}

function HighlightValueLine({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "muted" | "warning" }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("text-right font-medium", tone === "muted" ? "text-muted-foreground" : tone === "warning" ? "text-amber-700" : "text-foreground")}>{value}</span>
    </div>
  );
}

function StackedValueLine({ label, value, toneClassName }: { label: string; value: string; toneClassName?: string }) {
  return (
    <span className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}: </span>
      <span className={cn("font-semibold text-foreground", toneClassName)}>{value}</span>
    </span>
  );
}
