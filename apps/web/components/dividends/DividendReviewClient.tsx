"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { AccountDto, DividendLedgerAggregates, LocaleCode, MarketCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { useEventStream } from "../../hooks/useEventStream";
import { useIsSmallScreen } from "../../lib/hooks/use-small-screen";
import {
  fetchDividendLedgerReview,
  updateDividendReconciliation,
  type DividendLedgerReviewResponse,
  type DividendReviewQuery,
} from "../../features/dividends/services/dividendService";
import type { DividendLedgerEntryDetails } from "../../features/dividends/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DividendReviewDrawer } from "./DividendReviewDrawer";
import {
  resolvePresetDates,
  type DatePreset,
  type Granularity,
} from "./dividendReviewUtils";
import { NhiRollupSection } from "../../features/dividends/components/NhiRollupSection";
import { useOptionalAppShellData } from "../layout/AppShellDataContext";

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
  marketCode: MarketCode | "";
  accountId: string;
  status: StatusFilter;
  sortBy: string;
  sortOrder: "asc" | "desc";
  page: number;
  limit: 10 | 25 | 50;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const REVIEW_PAGE_SIZE_VALUES = [10, 25, 50] as const;
const DEFAULT_REVIEW_PAGE_SIZE = 10;

function normalizeReviewLimit(value: string | null): 10 | 25 | 50 {
  const parsed = Number.parseInt(value ?? "", 10);
  return REVIEW_PAGE_SIZE_VALUES.includes(parsed as 10 | 25 | 50)
    ? (parsed as 10 | 25 | 50)
    : DEFAULT_REVIEW_PAGE_SIZE;
}

function normalizeStatusFilter(value: string | null): StatusFilter {
  if (value === "needs-review" || value === "needsReview" || value === "needsReconciliation") {
    return "needsReconciliation";
  }
  if (value === "open" || value === "matched" || value === "explained" || value === "resolved") {
    return value;
  }
  return "all";
}

function statusToQueryParams(status: StatusFilter): Pick<DividendReviewQuery, "postingStatus" | "reconciliationStatus" | "excludeExpected"> {
  switch (status) {
    case "needsReconciliation":
      return { reconciliationStatus: "open", excludeExpected: true };
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
  if (entry.varianceAmount != null) return entry.varianceAmount;
  return actualNetAmount(entry) - expectedNetAmount(entry);
}

function cashInLieuAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.cashInLieuAmount != null) return entry.cashInLieuAmount;
  return entry.deductions
    .filter((deduction) => deduction.deductionType === "CASH_IN_LIEU_ADJUSTMENT")
    .reduce((sum, deduction) => sum + deduction.amount, 0);
}

function sumDeductions(
  entry: DividendLedgerEntryDetails,
  predicate: (deduction: DividendLedgerEntryDetails["deductions"][number]) => boolean,
): number {
  return entry.deductions
    .filter(predicate)
    .reduce((sum, deduction) => sum + deduction.amount, 0);
}

function nhiAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.nhiAmount != null) return entry.nhiAmount;
  return sumDeductions(entry, (deduction) => deduction.deductionType === "NHI_SUPPLEMENTAL_PREMIUM");
}

function bankFeeAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.bankFeeAmount != null) return entry.bankFeeAmount;
  return sumDeductions(entry, (deduction) => deduction.deductionType === "BANK_FEE");
}

function otherDeductionAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.otherDeductionAmount != null) return entry.otherDeductionAmount;
  return sumDeductions(entry, (deduction) => (
    deduction.deductionType !== "NHI_SUPPLEMENTAL_PREMIUM"
    && deduction.deductionType !== "BANK_FEE"
  ));
}

function expectedGrossAmount(entry: DividendLedgerEntryDetails): number {
  return entry.expectedGrossAmount ?? entry.expectedCashAmount;
}

function expectedNetAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.expectedNetAmount != null) return entry.expectedNetAmount;
  return expectedGrossAmount(entry) - nhiAmount(entry) - bankFeeAmount(entry) - otherDeductionAmount(entry);
}

function actualNetAmount(entry: DividendLedgerEntryDetails): number {
  if (entry.actualNetAmount != null) return entry.actualNetAmount;
  return entry.receivedCashAmount - nhiAmount(entry) - bankFeeAmount(entry) - otherDeductionAmount(entry);
}

function parseInitialPreset(searchParams: URLSearchParams): DatePreset {
  const preset = searchParams.get("preset");
  if (preset) return preset as DatePreset;
  return "currentYear";
}

function legacyYearPreset(searchParams: URLSearchParams): number | null {
  const preset = searchParams.get("preset");
  const match = preset?.match(/^year-(\d{4})$/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : null;
}

function yearFromDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function selectedYearRangeFromFilters(filters: Pick<FilterState, "preset" | "fromDate" | "toDate">): { start: number; end: number } | null {
  if (filters.preset !== "yearRange") return null;
  const fromYear = yearFromDate(filters.fromDate);
  const toYear = yearFromDate(filters.toDate);
  if (fromYear === null || toYear === null) return null;
  return {
    start: Math.min(fromYear, toYear),
    end: Math.max(fromYear, toYear),
  };
}

function selectedYearsFromFilters(filters: Pick<FilterState, "preset" | "fromDate" | "toDate">): number[] {
  const range = selectedYearRangeFromFilters(filters);
  if (!range) return [];
  const { start, end } = range;
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function parseInitialFilters(searchParams: URLSearchParams): FilterState {
  const legacyYear = legacyYearPreset(searchParams);
  const preset = legacyYear === null ? parseInitialPreset(searchParams) : "yearRange";
  const today = new Date();
  const resolved = resolvePresetDates(preset, today);

  return {
    preset,
    fromDate: searchParams.get("fromPaymentDate") ?? (legacyYear === null ? resolved.from : `${legacyYear}-01-01`) ?? "",
    toDate: searchParams.get("toPaymentDate") ?? (legacyYear === null ? resolved.to : `${legacyYear}-12-31`) ?? "",
    ticker: searchParams.get("ticker") ?? "",
    marketCode: (searchParams.get("marketCode") as MarketCode | null) ?? "",
    accountId: searchParams.get("accountId") ?? "",
    status: normalizeStatusFilter(searchParams.get("status")),
    sortBy: searchParams.get("sortBy") ?? "paymentDate",
    sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") ?? "desc",
    page: Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1),
    limit: normalizeReviewLimit(searchParams.get("limit")),
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
  const sortTestId = field === "varianceAmount"
    ? "review-sort-variance"
    : `review-sort-${field.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
  return (
    <th
      className={sticky ? "sticky left-0 z-10 bg-muted/50 border-r border-border md:static md:bg-transparent md:border-r-0" : ""}
      aria-sort={isActive ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="w-full cursor-pointer px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        onClick={() => onSort(field)}
        data-testid={sortTestId}
      >
        <span className={isActive ? "text-foreground font-semibold" : ""}>
          {label}
          {isActive ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
        </span>
      </button>
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
  const shellData = useOptionalAppShellData();
  const canWriteDividends = !shellData?.isSharedContext || shellData.sharedContextPermissions.canWriteDividends;
  const contextRefreshSignal = shellData?.contextRefreshSignal ?? 0;
  const lastContextRefreshSignal = useRef(contextRefreshSignal);

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

  // Source composition pending filter (client-side, triggered by NHI rollup)
  const [sourceCompositionPendingFilter, setSourceCompositionPendingFilter] = useState(
    () => searchParams.get("sourceComposition") === "pending",
  );

  const lastValidQuery = useRef<DividendReviewQuery | null>(null);
  const lastAppliedTicker = useRef(filters.ticker);
  const fetchSequence = useRef(0);
  const filtersRef = useRef(filters);
  const didNormalizeInitialUrlRef = useRef(false);
  filtersRef.current = filters;

  // ── Build query from filters ──────────────────────────────────────────

  const buildQueryFromFilters = useCallback((f: FilterState): DividendReviewQuery => {
    const statusParams = statusToQueryParams(f.status);
    return {
      fromPaymentDate: f.fromDate || undefined,
      toPaymentDate: f.toDate || undefined,
      ticker: f.ticker || undefined,
      marketCode: f.marketCode || undefined,
      accountId: f.accountId || undefined,
      ...statusParams,
      sortBy: f.sortBy,
      sortOrder: f.sortOrder,
      page: f.page,
      limit: f.limit,
    };
  }, []);

  // ── Sync URL ──────────────────────────────────────────────────────────

  const syncUrl = useCallback((f: FilterState) => {
    const params = new URLSearchParams();
    params.set("view", "ledger");
    if (f.marketCode) params.set("marketCode", f.marketCode);
    if (f.preset !== "currentYear") params.set("preset", f.preset);
    if (f.fromDate) params.set("fromPaymentDate", f.fromDate);
    if (f.toDate) params.set("toPaymentDate", f.toDate);
    if (f.ticker) params.set("ticker", f.ticker);
    if (f.accountId) params.set("accountId", f.accountId);
    if (f.status !== "all") params.set("status", f.status);
    if (f.sortBy !== "paymentDate") params.set("sortBy", f.sortBy);
    if (f.sortOrder !== "desc") params.set("sortOrder", f.sortOrder);
    params.set("page", String(f.page));
    if (f.limit !== DEFAULT_REVIEW_PAGE_SIZE) params.set("limit", String(f.limit));

    const url = `/dividends?${params.toString()}`;
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    if (didNormalizeInitialUrlRef.current) return;
    didNormalizeInitialUrlRef.current = true;
    syncUrl(filtersRef.current);
  }, [syncUrl]);

  // ── Fetch data ────────────────────────────────────────────────────────

  const fetchData = useCallback(async (f: FilterState) => {
    const requestId = fetchSequence.current + 1;
    fetchSequence.current = requestId;
    setIsLoading(true);
    setErrorMessage("");
    setDateError("");

    const query = buildQueryFromFilters(f);
    lastValidQuery.current = query;

    try {
      const result = await fetchDividendLedgerReview(query);
      if (fetchSequence.current === requestId) {
        setData(result);
      }
    } catch (error) {
      if (fetchSequence.current === requestId) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (fetchSequence.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [buildQueryFromFilters]);

  useEffect(() => {
    if (lastContextRefreshSignal.current === contextRefreshSignal) return;
    lastContextRefreshSignal.current = contextRefreshSignal;
    setDrawerEntry(null);
    void fetchData({ ...filtersRef.current, page: 1 });
  }, [contextRefreshSignal, fetchData]);

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

  const handleYearToggle = useCallback((year: number) => {
    const current = new Set(selectedYearsFromFilters(filters));
    if (current.has(year)) {
      current.delete(year);
    } else {
      current.add(year);
    }
    const selected = Array.from(current).sort((a, b) => a - b);
    if (selected.length === 0) {
      handlePresetChange("currentYear");
      return;
    }
    const fromYear = selected[0]!;
    const toYear = selected[selected.length - 1]!;
    applyFilters({
      ...filters,
      preset: "yearRange",
      fromDate: `${fromYear}-01-01`,
      toDate: `${toYear}-12-31`,
      page: 1,
    });
  }, [filters, applyFilters, handlePresetChange]);

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
    const nextTicker = ticker.trim();
    const tickerChanged = nextTicker !== lastAppliedTicker.current;
    lastAppliedTicker.current = nextTicker;
    applyFilters({
      ...filters,
      ticker: nextTicker,
      marketCode: tickerChanged ? "" : filters.marketCode,
      page: 1,
    });
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

  const handleRowKeyDown = useCallback((event: KeyboardEvent<HTMLElement>, entry: DividendLedgerEntryDetails) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setDrawerEntry(entry);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    applyFilters({ ...filters, page });
  }, [filters, applyFilters]);

  const handleLimitChange = useCallback((limit: 10 | 25 | 50) => {
    applyFilters({ ...filters, limit, page: 1 });
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

  const totalPages = Math.max(1, Math.ceil(data.total / filters.limit));
  const aggregates = data.aggregates;
  const hasOpenItems = aggregates.openCount > 0;

  const accountNameById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a.name || a.id])),
    [accounts],
  );

  const presets = useMemo((): { key: DatePreset; label: string }[] => [
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
      { key: "unspecified", label: dict.dividends.review.preset.unspecified },
      { key: "custom", label: dict.dividends.review.preset.custom },
  ], [dict]);
  const selectedYears = useMemo(() => selectedYearsFromFilters(filters), [filters]);
  const selectedYearSet = useMemo(() => new Set(selectedYears), [selectedYears]);
  const selectedYearRange = useMemo(() => selectedYearRangeFromFilters(filters), [filters]);
  const yearDropdownLabel = selectedYears.length === 0
    ? dict.dividends.review.preset.years
    : selectedYears.length === 1
      ? String(selectedYears[0])
      : `${selectedYears[0]}-${selectedYears[selectedYears.length - 1]}`;

  const defaultChartGranularity: Granularity | undefined =
    filters.preset === "unspecified" ? "year" : undefined;

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
          className="flex flex-wrap items-center gap-2"
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
          {years.length > 0 ? (
            <details className="relative" data-testid="preset-years-dropdown">
              <summary
                className={cn(
                  "list-none rounded-full border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap marker:hidden",
                  filters.preset === "yearRange"
                    ? "border-sky-300 bg-sky-100 text-sky-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                )}
                data-testid="preset-year-range"
              >
                {yearDropdownLabel}
              </summary>
              <div className="absolute left-0 z-30 mt-2 max-h-64 min-w-36 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                {[...years].sort((a, b) => a - b).map((year) => {
                  const isRangeInterior = selectedYearRange !== null
                    && selectedYearRange.start < year
                    && year < selectedYearRange.end;
                  return (
                    <label
                      key={year}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                        isRangeInterior
                          ? "cursor-not-allowed text-slate-400"
                          : "cursor-pointer text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 disabled:bg-slate-100"
                        checked={selectedYearSet.has(year)}
                        disabled={isRangeInterior}
                        onChange={() => handleYearToggle(year)}
                        data-testid={`preset-year-${year}`}
                      />
                      <span>{year}</span>
                    </label>
                  );
                })}
              </div>
            </details>
          ) : null}
        </div>

        {/* Filters row: mobile = 2-col dates with full-width long fields; desktop = 5-col */}
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
              onChange={(e) => {
                const ticker = e.target.value;
                setFilters({
                  ...filters,
                  ticker,
                  marketCode: ticker.trim() === lastAppliedTicker.current ? filters.marketCode : "",
                });
              }}
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
          <label className="col-span-2 space-y-1 lg:col-span-1">
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
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2" data-testid="review-mobile-sort-controls">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{dict.dividends.review.pagination.sortBy}</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={filters.sortBy}
                onChange={(event) => applyFilters({ ...filters, sortBy: event.target.value, page: 1 })}
                data-testid="review-mobile-sort-field"
              >
                <option value="paymentDate">{dict.dividends.review.table.paymentDate}</option>
                <option value="ticker">{dict.dividends.review.table.ticker}</option>
                <option value="account">{dict.dividends.review.table.account}</option>
                <option value="expectedCashAmount">{dict.dividends.review.table.expected}</option>
                <option value="receivedCashAmount">{dict.dividends.review.table.received}</option>
                <option value="nhiAmount">{dict.dividends.review.table.nhi}</option>
                <option value="bankFeeAmount">{dict.dividends.review.table.bankFee}</option>
                <option value="otherDeductionAmount">{dict.dividends.review.table.otherDeduction}</option>
                <option value="expectedNetAmount">{dict.dividends.review.table.expectedNet}</option>
                <option value="actualNetAmount">{dict.dividends.review.table.actualNet}</option>
                <option value="varianceAmount">{dict.dividends.review.table.variance}</option>
                <option value="reconciliationStatus">{dict.dividends.review.table.status}</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>{dict.dividends.review.pagination.direction}</span>
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
                value={filters.sortOrder}
                onChange={(event) => applyFilters({ ...filters, sortOrder: event.target.value as "asc" | "desc", page: 1 })}
                data-testid="review-mobile-sort-direction"
              >
                <option value="asc">{dict.dividends.review.pagination.ascending}</option>
                <option value="desc">{dict.dividends.review.pagination.descending}</option>
              </select>
            </label>
          </div>
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
                    onKeyDown={(event) => handleRowKeyDown(event, entry)}
                    role="button"
                    tabIndex={0}
                    data-testid={`review-row-${entry.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="text-base font-semibold text-foreground">
                          <Link
                            href={`/tickers/${encodeURIComponent(entry.ticker)}?marketCode=${encodeURIComponent(entry.marketCode)}`}
                            className="hover:text-primary"
                            onClick={(event) => event.stopPropagation()}
                            data-testid={`review-ticker-link-${entry.id}`}
                          >
                            {entry.ticker}
                          </Link>
                        </h4>
                        {entry.tickerName ? (
                          <p className="truncate text-xs text-muted-foreground">{entry.tickerName}</p>
                        ) : null}
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
                        <dt className="text-muted-foreground">{dict.dividends.review.table.expectedNet}</dt>
                        <dd className="font-medium text-foreground">{formatCurrencyAmount(expectedNetAmount(entry), entry.cashCurrency, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.actualNet}</dt>
                        <dd className="font-medium text-foreground">{formatCurrencyAmount(actualNetAmount(entry), entry.cashCurrency, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.nhi}</dt>
                        <dd className="font-medium text-foreground">{nhiAmount(entry) > 0 ? formatCurrencyAmount(nhiAmount(entry), entry.cashCurrency, locale) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.bankFee}</dt>
                        <dd className="font-medium text-foreground">{bankFeeAmount(entry) > 0 ? formatCurrencyAmount(bankFeeAmount(entry), entry.cashCurrency, locale) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.otherDeduction}</dt>
                        <dd className="font-medium text-foreground">{otherDeductionAmount(entry) > 0 ? formatCurrencyAmount(otherDeductionAmount(entry), entry.cashCurrency, locale) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.variance}</dt>
                        <dd className={cn("font-medium", variance !== 0 ? "text-amber-600" : "text-muted-foreground")}>{variance !== 0 ? formatCurrencyAmount(variance, entry.cashCurrency, locale) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.stockReceived}</dt>
                        <dd className="font-medium text-foreground">{entry.receivedStockQuantity > 0 ? formatNumber(entry.receivedStockQuantity, locale) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.cashInLieu}</dt>
                        <dd className="font-medium text-foreground">{cashInLieuAmount(entry) > 0 ? formatCurrencyAmount(cashInLieuAmount(entry), entry.cashCurrency, locale) : "—"}</dd>
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

          <li className="flex items-center justify-between px-1 py-2" data-testid="pagination">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{dict.dividends.review.pagination.pageSize}</span>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                  value={String(filters.limit)}
                  onChange={(event) => handleLimitChange(Number.parseInt(event.target.value, 10) as 10 | 25 | 50)}
                  data-testid="review-page-size"
                >
                  {REVIEW_PAGE_SIZE_VALUES.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <span className="text-sm text-muted-foreground">
                {dict.dividends.review.pagination.page} {filters.page} {dict.dividends.review.pagination.of} {totalPages}{dict.dividends.review.pagination.totalSuffix}
              </span>
            </div>
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
          </ul>
        </div>
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
                  <SortHeader label={dict.dividends.review.table.nhi} field="nhiAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.bankFee} field="bankFeeAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.otherDeduction} field="otherDeductionAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.expectedNet} field="expectedNetAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.actualNet} field="actualNetAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.stockReceived}</th>
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.cashInLieu}</th>
                  <SortHeader label={dict.dividends.review.table.variance} field="varianceAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.status} field="reconciliationStatus" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.actions}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && displayEntries.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="px-4 py-10 text-center text-sm text-muted-foreground">…</td>
                  </tr>
                ) : displayEntries.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="px-4 py-10 text-center text-sm text-muted-foreground">
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
                        onKeyDown={(event) => handleRowKeyDown(event, entry)}
                        role="button"
                        tabIndex={0}
                        aria-label={`${entry.ticker} ${entry.tickerName ?? ""}`.trim()}
                        data-testid={`review-row-${entry.id}`}
                      >
                        <td className="sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0 px-4 py-3 text-sm text-foreground">
                          {entry.paymentDate ? formatDateLabel(entry.paymentDate, locale) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <Link
                            href={`/tickers/${encodeURIComponent(entry.ticker)}?marketCode=${encodeURIComponent(entry.marketCode)}`}
                            className="font-medium text-foreground hover:text-primary"
                            onClick={(event) => event.stopPropagation()}
                            data-testid={`review-ticker-link-${entry.id}`}
                          >
                            {entry.ticker}
                          </Link>
                          {entry.tickerName ? (
                            <div className="max-w-48 truncate text-xs text-muted-foreground">{entry.tickerName}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{accountNameById.get(entry.accountId) ?? entry.accountId}</td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatCurrencyAmount(entry.expectedCashAmount, entry.cashCurrency, locale)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatCurrencyAmount(entry.receivedCashAmount, entry.cashCurrency, locale)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {nhiAmount(entry) > 0 ? formatCurrencyAmount(nhiAmount(entry), entry.cashCurrency, locale) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {bankFeeAmount(entry) > 0 ? formatCurrencyAmount(bankFeeAmount(entry), entry.cashCurrency, locale) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {otherDeductionAmount(entry) > 0 ? formatCurrencyAmount(otherDeductionAmount(entry), entry.cashCurrency, locale) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatCurrencyAmount(expectedNetAmount(entry), entry.cashCurrency, locale)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatCurrencyAmount(actualNetAmount(entry), entry.cashCurrency, locale)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {entry.receivedStockQuantity > 0 ? formatNumber(entry.receivedStockQuantity, locale) : "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {cashInLieuAmount(entry) > 0 ? formatCurrencyAmount(cashInLieuAmount(entry), entry.cashCurrency, locale) : "—"}
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

          <div className="flex items-center justify-between border-t border-border px-4 py-3" data-testid="pagination">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{dict.dividends.review.pagination.pageSize}</span>
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                    value={String(filters.limit)}
                    onChange={(event) => handleLimitChange(Number.parseInt(event.target.value, 10) as 10 | 25 | 50)}
                    data-testid="review-page-size"
                  >
                    {REVIEW_PAGE_SIZE_VALUES.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <span className="text-sm text-muted-foreground">
                  {dict.dividends.review.pagination.page} {filters.page} {dict.dividends.review.pagination.of} {totalPages}{dict.dividends.review.pagination.totalSuffix}
                </span>
              </div>
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

      <DividendReviewDrawer
        dict={dict}
        locale={locale}
        entry={drawerEntry}
        resolveAccountName={(accountId) => accountNameById.get(accountId) ?? accountId}
        onClose={() => {
          setDrawerEntry(null);
        }}
        onSaved={async () => {
          await fetchData(filters);
        }}
        allowMutations={canWriteDividends}
        readOnlyMessage={dict.tickerHistory.noWritePermission}
      />
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
