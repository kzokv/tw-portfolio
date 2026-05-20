"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { useEventStream } from "../../hooks/useEventStream";
import {
  fetchDividendCalendarSnapshot,
  type DividendQuery,
  updateDividendReconciliation,
} from "../../features/dividends/services/dividendService";
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

interface DividendCalendarClientProps {
  initialSnapshot: DividendCalendarSnapshot;
  dict: AppDictionary;
  locale: LocaleCode;
}

type CalendarBadge =
  | "unposted"
  | "pendingReview"
  | "posted"
  | "postedVariance"
  | "resolved"
  | "matched"
  | "explained";

function monthBounds(anchor: Date): { fromPaymentDate: string; toPaymentDate: string } {
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return {
    fromPaymentDate: start.toISOString().slice(0, 10),
    toPaymentDate: end.toISOString().slice(0, 10),
  };
}

function monthLabel(anchor: Date, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
    year: "numeric",
    month: "long",
  }).format(anchor);
}

function rowKey(event: DividendEventListItem): string {
  return `${event.accountId}:${event.id}`;
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
  if (!ledgerEntry) {
    return null;
  }
  return ledgerEntry.receivedCashAmount + ledgerEntry.deductions
    .filter((entry) => entry.withheldAtSource)
    .reduce((sum, entry) => sum + entry.amount, 0);
}

function hasVariance(row: DividendCalendarRow): boolean {
  if (!row.ledgerEntry) {
    return false;
  }
  const grossAmount = calculateGrossAmount(row.ledgerEntry) ?? 0;
  return (
    grossAmount !== row.ledgerEntry.expectedCashAmount ||
    row.ledgerEntry.receivedStockQuantity !== row.ledgerEntry.expectedStockQuantity
  );
}

function resolveBadge(row: DividendCalendarRow): CalendarBadge {
  if (!row.ledgerEntry) {
    return "unposted";
  }
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
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "posted":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "postedVariance":
      return "border-teal-200 bg-teal-50 text-teal-700";
    case "resolved":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "matched":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "explained":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export function DividendCalendarClient({
  initialSnapshot,
  dict,
  locale,
}: DividendCalendarClientProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const [snapshot, setSnapshot] = useState<DividendCalendarSnapshot>(initialSnapshot);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [drawerRow, setDrawerRow] = useState<DividendCalendarRow | null>(null);
  const [isDrawerDirty, setIsDrawerDirty] = useState(false);
  const [pendingRowKey, setPendingRowKey] = useState<string | null>(null);

  const query = useMemo<DividendQuery>(() => ({
    ...monthBounds(visibleMonth),
    limit: 500,
  }), [visibleMonth]);
  const initialQueryKey = useRef(JSON.stringify(query));

  const refreshSnapshot = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const nextSnapshot = await fetchDividendCalendarSnapshot(query);
      setSnapshot(nextSnapshot);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [query]);

  useEffect(() => {
    setSnapshot(initialSnapshot);
  }, [initialSnapshot]);

  useEffect(() => {
    const queryKey = JSON.stringify(query);
    if (queryKey === initialQueryKey.current) {
      return;
    }
    void refreshSnapshot();
  }, [query, refreshSnapshot]);

  useEventStream({
    enabled: true,
    eventTypes: ["dividend_posted", "dividend_updated", "dividend_reconciliation_changed"],
    onEvent: () => {
      void refreshSnapshot();
    },
  });

  const rows = useMemo(() => buildRows(snapshot), [snapshot]);
  const tbdRows = rows.filter((row) => row.event.paymentDate === null);
  const scheduledRows = rows.filter((row) => row.event.paymentDate !== null);

  async function handleMarkMatched(row: DividendCalendarRow) {
    if (!row.ledgerEntry) {
      return;
    }
    setPendingRowKey(row.key);
    setErrorMessage("");
    try {
      await updateDividendReconciliation(row.ledgerEntry.id, "matched");
      await refreshSnapshot();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingRowKey(null);
    }
  }

  return (
    <div className="grid gap-6" data-testid="dividends-calendar-page">
      <Card className="overflow-hidden rounded-[30px] border border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(239,246,255,0.94))] p-6 shadow-[0_24px_60px_rgba(14,165,233,0.08)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-sky-600/80">{dict.dividends.pageTitle}</p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-950">{dict.dividends.pageTitle}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{dict.dividends.pageDescription}</p>
          </div>
          <div className="flex w-full max-w-full flex-wrap items-center justify-center gap-2 rounded-3xl border border-slate-200 bg-white/90 p-2 shadow-[0_12px_24px_rgba(148,163,184,0.08)] sm:rounded-full sm:p-1 lg:w-auto">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setVisibleMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)))}
            >
              {dict.dividends.previousMonth}
            </Button>
            <span className="px-3 text-sm font-medium text-slate-700" aria-label={dict.dividends.monthPickerLabel}>
              {monthLabel(visibleMonth, locale)}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setVisibleMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)))}
            >
              {dict.dividends.nextMonth}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const now = new Date();
                setVisibleMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
              }}
            >
              {dict.dividends.currentMonth}
            </Button>
          </div>
        </div>
      </Card>

      {errorMessage ? (
        <p className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p>
      ) : null}

      {tbdRows.length > 0 ? (
        <section className="space-y-3" data-testid="dividends-tbd-section">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">{dict.dividends.paymentDateTbdSection}</h3>
            <span className="text-sm text-slate-500">{formatNumber(tbdRows.length, locale)}</span>
          </div>
          <div className="grid gap-3">
            {tbdRows.map((row) => (
              <DividendRowCard
                key={row.key}
                row={row}
                dict={dict}
                locale={locale}
                pending={pendingRowKey === row.key}
                onEdit={() => {
                  setDrawerRow(row);
                  setIsDrawerDirty(false);
                }}
                onMarkMatched={() => void handleMarkMatched(row)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">{monthLabel(visibleMonth, locale)}</h3>
          <span className="text-sm text-slate-500">{isLoading ? "…" : formatNumber(scheduledRows.length, locale)}</span>
        </div>
        {scheduledRows.length === 0 ? (
          <Card className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-10 text-center text-sm text-slate-600">
            {dict.dividends.emptyState}
          </Card>
        ) : (
          <div className="grid gap-3">
            {scheduledRows.map((row) => (
              <DividendRowCard
                key={row.key}
                row={row}
                dict={dict}
                locale={locale}
                pending={pendingRowKey === row.key}
                onEdit={() => {
                  setDrawerRow(row);
                  setIsDrawerDirty(false);
                }}
                onMarkMatched={() => void handleMarkMatched(row)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="flex justify-center">
        <Link
          href="/dividends?view=ledger"
          className="text-sm font-medium text-sky-600 hover:text-sky-700 hover:underline"
          data-testid="dividends-view-all-link"
        >
          {dict.dividends.viewAllLink}
        </Link>
      </div>

      <Drawer
        open={drawerRow !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDrawerRow(null);
            setIsDrawerDirty(false);
          }
        }}
        title={drawerRow ? `${drawerRow.event.ticker} · ${drawerRow.event.accountId}` : dict.dividends.pageTitle}
        dirty={isDrawerDirty}
        dirtyConfirmMessage={dict.dividends.form.unsavedChangesConfirm}
      >
        {drawerRow ? (
          <DividendPostingForm
            row={drawerRow}
            dict={dict}
            locale={locale}
            onDirtyChange={setIsDrawerDirty}
            onCancel={() => {
              // Cancel must pass through the same dirty-check guard as the
              // drawer's Escape / backdrop / X button paths. The Drawer
              // primitive's requestClose is not exposed imperatively, so we
              // reuse its unsavedChangesConfirm message here.
              if (isDrawerDirty && typeof window !== "undefined") {
                const confirmed = window.confirm(dict.dividends.form.unsavedChangesConfirm);
                if (!confirmed) return;
              }
              setDrawerRow(null);
              setIsDrawerDirty(false);
            }}
            onSaved={async () => {
              await refreshSnapshot();
              setDrawerRow(null);
              setIsDrawerDirty(false);
            }}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

function DividendRowCard({
  row,
  dict,
  locale,
  pending,
  onEdit,
  onMarkMatched,
}: {
  row: DividendCalendarRow;
  dict: AppDictionary;
  locale: LocaleCode;
  pending: boolean;
  onEdit: () => void;
  onMarkMatched: () => void;
}) {
  const badge = resolveBadge(row);
  const grossAmount = row.ledgerEntry ? calculateGrossAmount(row.ledgerEntry) : row.event.expectedCashAmount;
  const canEdit = row.ledgerEntry !== null;

  return (
    <Card
      className="rounded-[24px] border border-slate-200 bg-white/92 p-5 shadow-[0_16px_36px_rgba(148,163,184,0.12)]"
      data-testid={`dividend-row-${row.event.id}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h4 className="text-lg font-semibold text-slate-950">{row.event.ticker}</h4>
            <span
              data-testid={`dividend-badge-${row.event.id}`}
              className={cn(
                "inline-flex rounded-full border px-3 py-1 text-xs uppercase tracking-[0.14em]",
                badgeClassName(badge),
              )}
            >
              {resolveBadgeLabel(dict, badge)}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-500">{row.event.accountId}</p>
        </div>

        <div className="flex flex-wrap gap-2 lg:shrink-0 lg:justify-end">
          {row.ledgerEntry?.reconciliationStatus === "open" ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onMarkMatched}
              disabled={pending}
              data-testid={`dividend-mark-matched-${row.event.id}`}
            >
              {dict.dividends.action.markMatched}
            </Button>
          ) : null}
          {row.ledgerEntry === null ? (
            <Button size="sm" onClick={onEdit} data-testid={`dividend-post-${row.event.id}`}>
              {dict.dividends.action.postDividend}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={onEdit}
              disabled={!canEdit}
              data-testid={`dividend-edit-${row.event.id}`}
            >
              {dict.dividends.action.edit}
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Detail label={dict.dashboardHome.exDividendDateLabel} value={formatDateLabel(row.event.exDividendDate, locale)} />
        <Detail
          label={dict.dashboardHome.paymentDateLabel}
          value={row.event.paymentDate ? formatDateLabel(row.event.paymentDate, locale) : dict.dividends.paymentDateTbdSection}
        />
        <Detail
          label={dict.dividends.eligibleSharesLabel}
          value={formatNumber(row.event.eligibleQuantity, locale)}
          testId={`dividend-eligible-${row.event.id}`}
        />
        <Detail
          label={dict.dashboardHome.expectedAmountLabel}
          value={formatCurrencyAmount(row.event.expectedCashAmount, row.event.cashDividendCurrency, locale)}
        />
        <Detail
          label={dict.dashboardHome.grossAmountLabel}
          value={grossAmount !== null ? formatCurrencyAmount(grossAmount, row.event.cashDividendCurrency, locale) : "-"}
        />
        <Detail
          label={dict.dashboardHome.deductionAmountLabel}
          value={row.ledgerEntry
            ? formatCurrencyAmount(
              row.ledgerEntry.deductions.reduce((sum, entry) => sum + entry.amount, 0),
              row.event.cashDividendCurrency,
              locale,
            )
            : "-"}
        />
      </dl>
    </Card>
  );
}

function Detail({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div data-testid={testId}>
      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}
