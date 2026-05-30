"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { AccountDto, DividendLedgerAggregates, LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel } from "../../lib/utils";
import { useEventStream } from "../../hooks/useEventStream";
import { useIsSmallScreen } from "../../lib/hooks/use-small-screen";
import {
  fetchDividendLedgerReview,
  updateDividendReconciliation,
  type DividendLedgerReviewResponse,
  type DividendReviewQuery,
} from "../../features/dividends/services/dividendService";
import type { DividendCalendarRow, DividendLedgerEntryDetails } from "../../features/dividends/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Drawer } from "../ui/Drawer";
import { DividendPostingForm } from "./DividendPostingForm";
import {
  resolvePresetDates,
  type DatePreset,
  type Granularity,
} from "./dividendReviewUtils";
import { NhiRollupSection } from "../../features/dividends/components/NhiRollupSection";

const DividendReviewCharts = dynamic(() => import("./DividendReviewCharts"), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/90">
      <span className="text-sm text-slate-400">Loading charts…</span>
    </div>
  ),
});

// ── Types ──────────────────────────────────────────────────────────────────

interface DividendReviewClientProps {
  initialData: DividendLedgerReviewResponse;
  dict: AppDictionary;
  locale: LocaleCode;
  accounts: AccountDto[];
  years: number[];
}

type StatusFilter = "all" | "needsReconciliation" | "open" | "matched" | "explained" | "resolved";

interface FilterState {
  preset: DatePreset;
  fromDate: string;
  toDate: string;
  ticker: string;
  accountId: string;
  status: StatusFilter;
  sortBy: string;
  sortOrder: "asc" | "desc";
  page: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

function statusToQueryParams(status: StatusFilter): Pick<DividendReviewQuery, "postingStatus" | "reconciliationStatus"> {
  switch (status) {
    case "needsReconciliation":
      return { postingStatus: "posted", reconciliationStatus: "open" };
    case "open":
      return { reconciliationStatus: "open" };
    case "matched":
      return { reconciliationStatus: "matched" };
    case "explained":
      return { reconciliationStatus: "explained" };
    case "resolved":
      return { reconciliationStatus: "resolved" };
    default:
      return {};
  }
}

function statusBadgeClassName(status: string): string {
  switch (status) {
    case "open":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "matched":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "explained":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "resolved":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function statusLabel(dict: AppDictionary, status: string): string {
  switch (status) {
    case "open":
      return dict.dividends.form.reconciliation.statusOpen;
    case "matched":
      return dict.dividends.form.reconciliation.statusMatched;
    case "explained":
      return dict.dividends.form.reconciliation.statusExplained;
    case "resolved":
      return dict.dividends.form.reconciliation.statusResolved;
    default:
      return status;
  }
}

function varianceAmount(entry: DividendLedgerEntryDetails): number {
  return entry.expectedCashAmount - entry.receivedCashAmount;
}

function parseInitialPreset(searchParams: URLSearchParams): DatePreset {
  const preset = searchParams.get("preset");
  if (preset) return preset as DatePreset;
  return "currentYear";
}

function parseInitialFilters(searchParams: URLSearchParams): FilterState {
  const preset = parseInitialPreset(searchParams);
  const today = new Date();
  const resolved = resolvePresetDates(preset, today);

  return {
    preset,
    fromDate: searchParams.get("fromPaymentDate") ?? resolved.from ?? "",
    toDate: searchParams.get("toPaymentDate") ?? resolved.to ?? "",
    ticker: searchParams.get("ticker") ?? "",
    accountId: searchParams.get("accountId") ?? "",
    status: (searchParams.get("status") as StatusFilter) ?? "all",
    sortBy: searchParams.get("sortBy") ?? "paymentDate",
    sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") ?? "desc",
    page: parseInt(searchParams.get("page") ?? "1", 10) || 1,
  };
}

// ── Sort Header ────────────────────────────────────────────────────────────

function SortHeader({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
  sticky = false,
}: {
  label: string;
  field: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (field: string) => void;
  /** Phase 4 — opt-in sticky-first-column styling for the leading ticker header. */
  sticky?: boolean;
}) {
  const isActive = sortBy === field;
  return (
    <th
      className={`cursor-pointer px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground ${sticky ? "sticky left-0 z-10 bg-muted/50 border-r border-border md:static md:bg-transparent md:border-r-0" : ""}`}
      onClick={() => onSort(field)}
    >
      <span className={isActive ? "text-foreground font-semibold" : ""}>
        {label}
        {isActive ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
      </span>
    </th>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function DividendReviewClient({
  initialData,
  dict,
  locale,
  accounts,
  years,
}: DividendReviewClientProps) {
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<FilterState>(() => parseInitialFilters(searchParams));
  const [data, setData] = useState<DividendLedgerReviewResponse>(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
  const [dateError, setDateError] = useState("");

  // Phase 4 — single-DOM responsive (card-stack at <sm).
  const isSmallScreen = useIsSmallScreen();

  // Drawer state
  const [drawerEntry, setDrawerEntry] = useState<DividendLedgerEntryDetails | null>(null);
  const [isDrawerDirty, setIsDrawerDirty] = useState(false);

  // Source composition pending filter (client-side, triggered by NHI rollup)
  const [sourceCompositionPendingFilter, setSourceCompositionPendingFilter] = useState(
    () => searchParams.get("sourceComposition") === "pending",
  );

  const lastValidQuery = useRef<DividendReviewQuery | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // ── Build query from filters ──────────────────────────────────────────

  const buildQueryFromFilters = useCallback((f: FilterState): DividendReviewQuery => {
    const statusParams = statusToQueryParams(f.status);
    return {
      fromPaymentDate: f.fromDate || undefined,
      toPaymentDate: f.toDate || undefined,
      ticker: f.ticker || undefined,
      accountId: f.accountId || undefined,
      ...statusParams,
      sortBy: f.sortBy,
      sortOrder: f.sortOrder,
      page: f.page,
      limit: PAGE_SIZE,
    };
  }, []);

  // ── Sync URL ──────────────────────────────────────────────────────────

  const syncUrl = useCallback((f: FilterState) => {
    const params = new URLSearchParams();
    params.set("view", "ledger");
    if (f.preset !== "currentYear") params.set("preset", f.preset);
    if (f.fromDate) params.set("fromPaymentDate", f.fromDate);
    if (f.toDate) params.set("toPaymentDate", f.toDate);
    if (f.ticker) params.set("ticker", f.ticker);
    if (f.accountId) params.set("accountId", f.accountId);
    if (f.status !== "all") params.set("status", f.status);
    if (f.sortBy !== "paymentDate") params.set("sortBy", f.sortBy);
    if (f.sortOrder !== "desc") params.set("sortOrder", f.sortOrder);
    if (f.page > 1) params.set("page", String(f.page));

    const url = `/dividends?${params.toString()}`;
    window.history.replaceState(null, "", url);
  }, []);

  // ── Fetch data ────────────────────────────────────────────────────────

  const fetchData = useCallback(async (f: FilterState) => {
    setIsLoading(true);
    setErrorMessage("");
    setDateError("");

    const query = buildQueryFromFilters(f);
    lastValidQuery.current = query;

    try {
      const result = await fetchDividendLedgerReview(query);
      setData(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [buildQueryFromFilters]);

  // ── Filter change handlers ────────────────────────────────────────────

  const applyFilters = useCallback((next: FilterState) => {
    setFilters(next);
    setSourceCompositionPendingFilter(false);
    syncUrl(next);
    void fetchData(next);
  }, [syncUrl, fetchData]);

  const handlePresetChange = useCallback((preset: DatePreset) => {
    const today = new Date();
    const resolved = resolvePresetDates(preset, today);
    const next: FilterState = {
      ...filters,
      preset,
      fromDate: resolved.from ?? "",
      toDate: resolved.to ?? "",
      page: 1,
    };
    if (preset === "custom") {
      // Only update UI + URL; defer fetch until user enters a valid date range
      setFilters(next);
      syncUrl(next);
    } else {
      applyFilters(next);
    }
  }, [filters, applyFilters, syncUrl]);

  const handleDateBlur = useCallback(() => {
    const f = filtersRef.current;
    if (f.preset !== "custom") return;
    if ((f.fromDate && !f.toDate) || (!f.fromDate && f.toDate)) {
      setDateError(dict.dividends.review.filter.partialDateError);
      return;
    }
    setDateError("");
    applyFilters({ ...f, page: 1 });
  }, [applyFilters, dict]);

  const handleTickerApply = useCallback((ticker: string) => {
    applyFilters({ ...filters, ticker, page: 1 });
  }, [filters, applyFilters]);

  const handleAccountChange = useCallback((accountId: string) => {
    applyFilters({ ...filters, accountId, page: 1 });
  }, [filters, applyFilters]);

  const handleStatusChange = useCallback((status: StatusFilter) => {
    applyFilters({ ...filters, status, page: 1 });
  }, [filters, applyFilters]);

  const handleSort = useCallback((field: string) => {
    const nextOrder = filters.sortBy === field && filters.sortOrder === "asc" ? "desc" : "asc";
    applyFilters({ ...filters, sortBy: field, sortOrder: nextOrder, page: 1 });
  }, [filters, applyFilters]);

  const handlePageChange = useCallback((page: number) => {
    applyFilters({ ...filters, page });
  }, [filters, applyFilters]);

  // ── NHI Rollup: filter pending disclosure ─────────────────────────────

  const handleFilterPending = useCallback(() => {
    setSourceCompositionPendingFilter(true);
    const params = new URLSearchParams(window.location.search);
    params.set("view", "ledger");
    params.set("sourceComposition", "pending");
    const url = `/dividends?${params.toString()}`;
    window.history.replaceState(null, "", url);
  }, []);

  // ── Mark Matched ──────────────────────────────────────────────────────

  const handleMarkMatched = useCallback(async (entry: DividendLedgerEntryDetails) => {
    if (entry.rowKind === "expected") return;
    setPendingEntryId(entry.id);
    setErrorMessage("");
    try {
      await updateDividendReconciliation(entry.id, "matched");
      // Re-fetch to get correct aggregates (openCount, totals) rather than patching locally.
      void fetchData(filtersRef.current);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingEntryId(null);
    }
  }, [fetchData]);

  // ── SSE ───────────────────────────────────────────────────────────────

  useEventStream({
    enabled: true,
    eventTypes: ["dividend_reconciliation_changed", "dividend_posted", "dividend_updated"],
    onEvent: (event: unknown) => {
      const evt = event as { type?: string; dividendLedgerEntryId?: string; reconciliationStatus?: string; version?: number };
      if (evt.type === "dividend_reconciliation_changed" && evt.dividendLedgerEntryId) {
        setData((prev) => {
          // Compute openCount delta so aggregates stay correct while keeping the row
          // visible in the list (per spec: rows don't disappear on SSE updates).
          const prevEntry = prev.ledgerEntries.find((e) => e.id === evt.dividendLedgerEntryId);
          const openCountDelta =
            (evt.reconciliationStatus === "open" ? 1 : 0) -
            (prevEntry?.reconciliationStatus === "open" ? 1 : 0);
          return {
            ...prev,
            aggregates: prev.aggregates
              ? {
                  ...prev.aggregates,
                  openCount: Math.max(0, (prev.aggregates.openCount ?? 0) + openCountDelta),
                }
              : prev.aggregates,
            ledgerEntries: prev.ledgerEntries.map((e) =>
              e.id === evt.dividendLedgerEntryId
                ? {
                    ...e,
                    reconciliationStatus: (evt.reconciliationStatus ?? e.reconciliationStatus) as DividendLedgerEntryDetails["reconciliationStatus"],
                    version: evt.version ?? e.version,
                  }
                : e,
            ),
          };
        });
      } else {
        // For other events, refresh the data
        void fetchData(filters);
      }
    },
  });

  // ── Computed values ───────────────────────────────────────────────────

  // Apply client-side source composition filter
  const displayEntries = useMemo(() => {
    if (!sourceCompositionPendingFilter) return data.ledgerEntries;
    return data.ledgerEntries.filter(
      (e) =>
        (e.instrumentType === "ETF" || e.instrumentType === "BOND_ETF") &&
        e.sourceCompositionStatus === "unknown_pending_disclosure",
    );
  }, [data.ledgerEntries, sourceCompositionPendingFilter]);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const aggregates = data.aggregates;
  const hasOpenItems = aggregates.openCount > 0;

  const accountNameById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name || a.id])),
    [accounts],
  );

  const presets = useMemo((): { key: DatePreset; label: string }[] => {
    const base: { key: DatePreset; label: string }[] = [
      { key: "yesterday", label: dict.dividends.review.preset.yesterday },
      { key: "thisWeek", label: dict.dividends.review.preset.thisWeek },
      { key: "last7Days", label: dict.dividends.review.preset.last7Days },
      { key: "last30Days", label: dict.dividends.review.preset.last30Days },
      { key: "thisMonth", label: dict.dividends.review.preset.thisMonth },
      { key: "lastMonth", label: dict.dividends.review.preset.lastMonth },
      { key: "currentQuarter", label: dict.dividends.review.preset.currentQuarter },
      { key: "lastQuarter", label: dict.dividends.review.preset.lastQuarter },
      { key: "currentYear", label: dict.dividends.review.preset.currentYear },
      { key: "lastYear", label: dict.dividends.review.preset.lastYear },
    ];

    for (const year of years) {
      base.push({ key: `year-${year}` as DatePreset, label: String(year) });
    }

    base.push(
      { key: "unspecified", label: dict.dividends.review.preset.unspecified },
      { key: "custom", label: dict.dividends.review.preset.custom },
    );

    return base;
  }, [years, dict]);

  const defaultChartGranularity: Granularity | undefined =
    filters.preset === "unspecified" ? "year" : undefined;

  // ── Drawer helpers ────────────────────────────────────────────────────

  // Memoized so the `row` prop reference is stable across parent re-renders
  // (e.g. when isDrawerDirty flips). Without this, every re-render of
  // DividendReviewClient produces a new row object → initialFormState recomputes
  // → the useEffect in DividendPostingForm fires → reconcileStatus is reset,
  // preventing the user from changing the reconciliation status dropdown.
  const drawerRow = useMemo(
    () => {
      if (!drawerEntry) return null;
      const isLedgerRow = drawerEntry.rowKind !== "expected";
      return {
        key: `${drawerEntry.accountId}:${drawerEntry.dividendEventId}`,
        event: {
          id: drawerEntry.dividendEventId,
          accountId: drawerEntry.accountId,
          ticker: drawerEntry.ticker,
          instrumentType: drawerEntry.instrumentType,
          eventType: drawerEntry.eventType,
          exDividendDate: drawerEntry.exDividendDate,
          paymentDate: drawerEntry.paymentDate,
          cashDividendCurrency: drawerEntry.cashCurrency,
          expectedCashAmount: drawerEntry.expectedCashAmount,
          expectedStockQuantity: drawerEntry.expectedStockQuantity,
          eligibleQuantity: drawerEntry.eligibleQuantity,
          hasPostedLedgerEntry: isLedgerRow,
          dividendLedgerEntryId: isLedgerRow ? drawerEntry.id : null,
        },
        ledgerEntry: isLedgerRow ? drawerEntry : null,
      } satisfies DividendCalendarRow;
    },
    [drawerEntry],
  );

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="grid gap-4" data-testid="dividend-review-page">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{dict.dividends.review.breadcrumb}</p>
        <h2 className="text-2xl font-semibold text-slate-950 sm:text-3xl">{dict.dividends.review.pageTitle}</h2>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">{dict.dividends.review.pageDescription}</p>
      </div>

      {hasOpenItems ? (
        <Card className="rounded-[20px] border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">{aggregates.openCount} {dict.dividends.review.stat.openItems.toLowerCase()}.</span>{" "}
            {dict.dividends.review.filter.needsReconciliation}
          </p>
        </Card>
      ) : null}

      {/* Stats tiles */}
      <StatTiles aggregates={aggregates} dict={dict} locale={locale} />

      {/* Filter bar */}
      <Card className="space-y-4 rounded-[20px] border border-slate-200 bg-white/92 p-4 shadow-[0_12px_28px_rgba(148,163,184,0.1)]">
        {/* Preset strip */}
        <div
          className="flex flex-wrap gap-2"
          data-testid="preset-strip"
        >
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                filters.preset === p.key
                  ? "border-sky-300 bg-sky-100 text-sky-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
              )}
              onClick={() => handlePresetChange(p.key)}
              data-testid={`preset-${p.key.replace(/([A-Z]|\d+)/g, "-$1").toLowerCase().replace(/--+/g, "-")}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Filters row: mobile = 2-col (dates | dates, ticker full, acct | status); desktop = 5-col */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {/* Date from */}
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {dict.dividends.review.filter.dateFrom}
            </span>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              value={filters.fromDate}
              readOnly={filters.preset !== "custom"}
              onChange={(e) => {
                const next = { ...filtersRef.current, fromDate: e.target.value, preset: "custom" as DatePreset };
                filtersRef.current = next;
                setFilters(next);
              }}
              onBlur={handleDateBlur}
              data-testid="filter-from-date"
            />
          </label>
          {/* Date to */}
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {dict.dividends.review.filter.dateTo}
            </span>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              value={filters.toDate}
              readOnly={filters.preset !== "custom"}
              onChange={(e) => {
                const next = { ...filtersRef.current, toDate: e.target.value, preset: "custom" as DatePreset };
                filtersRef.current = next;
                setFilters(next);
              }}
              onBlur={handleDateBlur}
              data-testid="filter-to-date"
            />
          </label>
          {/* Ticker — spans both columns on mobile so it's full-width */}
          <label className="col-span-2 space-y-1 lg:col-span-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {dict.dividends.review.filter.ticker}
            </span>
            <input
              type="text"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              placeholder={dict.dividends.review.filter.ticker}
              value={filters.ticker}
              onChange={(e) => setFilters({ ...filters, ticker: e.target.value })}
              onBlur={(e) => handleTickerApply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTickerApply((e.target as HTMLInputElement).value);
              }}
              data-testid="filter-ticker"
            />
          </label>
          {/* Account */}
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {dict.dividends.review.filter.account}
            </span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              value={filters.accountId}
              onChange={(e) => handleAccountChange(e.target.value)}
              data-testid="filter-account"
            >
              <option value="">{dict.dividends.review.filter.allAccounts}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name || a.id}</option>
              ))}
            </select>
          </label>
          {/* Status */}
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {dict.dividends.review.filter.status}
            </span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              value={filters.status}
              onChange={(e) => handleStatusChange(e.target.value as StatusFilter)}
              data-testid="filter-status"
            >
              <option value="all">{dict.dividends.review.filter.allStatuses}</option>
              <option value="needsReconciliation">{dict.dividends.review.filter.needsReconciliation}</option>
              <option value="open">{dict.dividends.form.reconciliation.statusOpen}</option>
              <option value="matched">{dict.dividends.form.reconciliation.statusMatched}</option>
              <option value="explained">{dict.dividends.form.reconciliation.statusExplained}</option>
              <option value="resolved">{dict.dividends.form.reconciliation.statusResolved}</option>
            </select>
          </label>
        </div>

        {dateError && (
          <p className="text-xs text-rose-600" data-testid="date-error">{dateError}</p>
        )}
      </Card>

      {/* Error */}
      {errorMessage && (
        <p className="rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" data-testid="review-error">
          {errorMessage}
        </p>
      )}

      {/* Phase 4 — single-DOM responsive (drops legacy `lg:hidden` mobile cards
          and `review-card-grid`). Card-stack at <sm via useIsSmallScreen;
          scroll + sticky-ticker at <md otherwise. Same `review-row-{id}` and
          `mark-matched-{id}` testids in both renderings. */}
      {isSmallScreen ? (
        <ul className="flex flex-col gap-3" data-testid="review-table">
          {displayEntries.length === 0 && !isLoading ? (
            <li>
              <Card className="rounded-xl border border-dashed border-border bg-muted/30 px-5 py-10 text-center text-sm text-muted-foreground">
                {dict.dividends.review.chart.noData}
              </Card>
            </li>
          ) : (
            displayEntries.map((entry) => {
              const variance = varianceAmount(entry);
              return (
                <li key={entry.id}>
                  <Card
                    className="cursor-pointer rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50"
                    onClick={() => setDrawerEntry(entry)}
                    data-testid={`review-row-${entry.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-base font-semibold text-foreground">{entry.ticker}</h4>
                        <p className="text-xs text-muted-foreground">{accountNameById.get(entry.accountId) ?? entry.accountId}</p>
                      </div>
                      <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em]", statusBadgeClassName(entry.reconciliationStatus))}>
                        {statusLabel(dict, entry.reconciliationStatus)}
                      </span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.paymentDate}</dt>
                        <dd className="font-medium text-foreground">{entry.paymentDate ? formatDateLabel(entry.paymentDate, locale) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.expected}</dt>
                        <dd className="font-medium text-foreground">{formatCurrencyAmount(entry.expectedCashAmount, entry.cashCurrency, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.received}</dt>
                        <dd className="font-medium text-foreground">{formatCurrencyAmount(entry.receivedCashAmount, entry.cashCurrency, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.variance}</dt>
                        <dd className={cn("font-medium", variance !== 0 ? "text-amber-600" : "text-muted-foreground")}>{variance !== 0 ? formatCurrencyAmount(variance, entry.cashCurrency, locale) : "—"}</dd>
                      </div>
                    </dl>
                    {entry.rowKind !== "expected" && entry.reconciliationStatus === "open" && (
                      <div className="mt-3 flex justify-end">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pendingEntryId === entry.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleMarkMatched(entry);
                          }}
                          data-testid={`mark-matched-${entry.id}`}
                        >
                          {dict.dividends.action.markMatched}
                        </Button>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })
          )}

          {totalPages > 1 && (
            <li className="flex items-center justify-between px-1 py-2" data-testid="pagination">
              <span className="text-sm text-muted-foreground">
                {dict.dividends.review.pagination.page} {filters.page} {dict.dividends.review.pagination.of} {totalPages}{dict.dividends.review.pagination.totalSuffix}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={filters.page <= 1}
                  onClick={() => handlePageChange(filters.page - 1)}
                  data-testid="pagination-prev"
                >
                  {dict.dividends.review.pagination.previous}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={filters.page >= totalPages}
                  onClick={() => handlePageChange(filters.page + 1)}
                  data-testid="pagination-next"
                >
                  {dict.dividends.review.pagination.next}
                </Button>
              </div>
            </li>
          )}
        </ul>
      ) : (
        <Card className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full" data-testid="review-table">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <SortHeader label={dict.dividends.review.table.paymentDate} field="paymentDate" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} sticky />
                  <SortHeader label={dict.dividends.review.table.ticker} field="ticker" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.account} field="account" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.expected} field="expectedCashAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.received} field="receivedCashAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.variance}</th>
                  <SortHeader label={dict.dividends.review.table.status} field="reconciliationStatus" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.actions}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && displayEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">…</td>
                  </tr>
                ) : displayEntries.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {dict.dividends.review.chart.noData}
                    </td>
                  </tr>
                ) : (
                  displayEntries.map((entry) => {
                    const variance = varianceAmount(entry);
                    return (
                      <tr
                        key={entry.id}
                        className="cursor-pointer border-b border-border transition-colors hover:bg-muted/50"
                        onClick={() => setDrawerEntry(entry)}
                        data-testid={`review-row-${entry.id}`}
                      >
                        <td className="sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0 px-4 py-3 text-sm text-foreground">
                          {entry.paymentDate ? formatDateLabel(entry.paymentDate, locale) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-foreground">
                          {entry.ticker}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{accountNameById.get(entry.accountId) ?? entry.accountId}</td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatCurrencyAmount(entry.expectedCashAmount, entry.cashCurrency, locale)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatCurrencyAmount(entry.receivedCashAmount, entry.cashCurrency, locale)}
                        </td>
                        <td className={cn("px-4 py-3 text-sm", variance !== 0 ? "text-amber-600 font-medium" : "text-muted-foreground")}>
                          {variance !== 0 ? formatCurrencyAmount(variance, entry.cashCurrency, locale) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em]", statusBadgeClassName(entry.reconciliationStatus))}>
                            {statusLabel(dict, entry.reconciliationStatus)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {entry.rowKind !== "expected" && entry.reconciliationStatus === "open" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pendingEntryId === entry.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleMarkMatched(entry);
                              }}
                              data-testid={`mark-matched-${entry.id}`}
                            >
                              {dict.dividends.action.markMatched}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3" data-testid="pagination">
              <span className="text-sm text-muted-foreground">
                {dict.dividends.review.pagination.page} {filters.page} {dict.dividends.review.pagination.of} {totalPages}{dict.dividends.review.pagination.totalSuffix}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={filters.page <= 1}
                  onClick={() => handlePageChange(filters.page - 1)}
                  data-testid="pagination-prev"
                >
                  {dict.dividends.review.pagination.previous}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={filters.page >= totalPages}
                  onClick={() => handlePageChange(filters.page + 1)}
                  data-testid="pagination-next"
                >
                  {dict.dividends.review.pagination.next}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* NHI Rollup */}
      <NhiRollupSection
        ledgerEntries={data.ledgerEntries}
        dict={dict}
        locale={locale}
        onFilterPending={handleFilterPending}
      />

      {/* Charts */}
      <Card className="rounded-[20px] border border-slate-200 bg-white/92 p-4 shadow-[0_12px_28px_rgba(148,163,184,0.1)]">
        <DividendReviewCharts
          byMonth={aggregates.byMonth}
          byTicker={aggregates.byTicker}
          dict={dict}
          defaultGranularity={defaultChartGranularity}
        />
      </Card>

      {/* Drawer */}
      <Drawer
        open={drawerEntry !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDrawerEntry(null);
            setIsDrawerDirty(false);
          }
        }}
        title={drawerEntry ? `${drawerEntry.ticker} · ${accountNameById.get(drawerEntry.accountId) ?? drawerEntry.accountId}` : dict.dividends.review.pageTitle}
        dirty={isDrawerDirty}
        dirtyConfirmMessage={dict.dividends.form.unsavedChangesConfirm}
      >
        {drawerEntry && drawerRow ? (
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
              setDrawerEntry(null);
              setIsDrawerDirty(false);
            }}
            onSaved={async () => {
              await fetchData(filters);
              setDrawerEntry(null);
              setIsDrawerDirty(false);
            }}
          />
        ) : null}
      </Drawer>
    </div>
  );
}

// ── Stats Tiles ────────────────────────────────────────────────────────────

function StatTiles({
  aggregates,
  dict,
  locale,
}: {
  aggregates: DividendLedgerAggregates;
  dict: AppDictionary;
  locale: LocaleCode;
}) {
  const varianceEntries = useMemo(() => {
    const all = new Set([
      ...Object.keys(aggregates.totalExpectedCashAmount),
      ...Object.keys(aggregates.totalReceivedCashAmount),
    ]);
    return Array.from(all).map((currency) => ({
      currency,
      amount:
        (aggregates.totalExpectedCashAmount[currency] ?? 0) -
        (aggregates.totalReceivedCashAmount[currency] ?? 0),
    }));
  }, [aggregates]);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="stat-tiles">
      <StatTile
        label={dict.dividends.review.stat.totalExpected}
        entries={Object.entries(aggregates.totalExpectedCashAmount)}
        locale={locale}
      />
      <StatTile
        label={dict.dividends.review.stat.totalReceived}
        entries={Object.entries(aggregates.totalReceivedCashAmount)}
        locale={locale}
      />
      <StatTile
        label={dict.dividends.review.stat.variance}
        entries={varianceEntries.map((v) => [v.currency, v.amount] as [string, number])}
        locale={locale}
        highlightNonZero
      />
      <Card className="rounded-[20px] border border-slate-200 bg-white/92 p-4 shadow-[0_12px_28px_rgba(148,163,184,0.1)]" data-testid="stat-open-items">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.dividends.review.stat.openItems}</p>
        <p className="mt-2 text-2xl font-semibold text-slate-950">{aggregates.openCount}</p>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  entries,
  locale,
  highlightNonZero = false,
}: {
  label: string;
  entries: [string, number][];
  locale: LocaleCode;
  highlightNonZero?: boolean;
}) {
  return (
    <Card className="rounded-[20px] border border-slate-200 bg-white/92 p-4 shadow-[0_12px_28px_rgba(148,163,184,0.1)]">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-2 space-y-1">
        {entries.length === 0 ? (
          <p className="text-2xl font-semibold text-slate-950">—</p>
        ) : (
          entries.map(([currency, amount]) => (
            <p
              key={currency}
              className={cn(
                "text-lg font-semibold",
                highlightNonZero && amount !== 0 ? "text-amber-600" : "text-slate-950",
              )}
            >
              {formatCurrencyAmount(amount, currency, locale)}
            </p>
          ))
        )}
      </div>
    </Card>
  );
}
