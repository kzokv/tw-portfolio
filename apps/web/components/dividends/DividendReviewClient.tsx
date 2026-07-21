"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import type {
  DividendLedgerAggregates,
  DividendCashReconciliationStatus,
  DividendReviewAccountOptionDto,
  DividendReviewPrimaryDto,
  DividendReviewPrimaryQueryDto,
  DividendReviewHeroAggregatesDto,
  DividendReviewRowSummaryDto,
  DividendReviewSortColumn,
  DividendStockReconciliationStatus,
  LocaleCode,
  MarketCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel } from "../../lib/utils";
import { useEventStream } from "../../hooks/useEventStream";
import { useIsSmallScreen } from "../../lib/hooks/use-small-screen";
import { updateDividendReconciliation } from "../../features/dividends/services/dividendService";
import { useDividendReviewData } from "../../features/dividends/hooks/useDividendReviewData";
import { getRouteDtoContextScope } from "../../lib/routeDtoCache";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { clearDividendReviewDrawerDetailCache, DividendReviewDrawer } from "./DividendReviewDrawer";
import {
  dividendEventTypeLabel,
  formatDividendRatio,
  formatDividendShares,
  isStockDividendEvent,
  stockRatioStateLabel,
} from "../../features/dividends/presentation";
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
  initialData: DividendReviewPrimaryDto | null;
  initialQuery?: DividendReviewPrimaryQueryDto;
  dict: AppDictionary;
  locale: LocaleCode;
  accounts: DividendReviewAccountOptionDto[];
  years: number[];
}

type CashStatusFilter = "all" | DividendCashReconciliationStatus;
type StockStatusFilter = "all" | DividendStockReconciliationStatus;

interface FilterState {
  preset: DatePreset;
  fromDate: string;
  toDate: string;
  tickers: string[];
  marketCode: MarketCode | "";
  accountId: string;
  cashStatus: CashStatusFilter;
  stockStatus: StockStatusFilter;
  sourceComposition?: "pending";
  sortBy: DividendReviewSortColumn;
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

function normalizeCashStatusFilter(value: string | null): CashStatusFilter {
  if (value === "needs-review" || value === "needsReview" || value === "needsReconciliation") {
    return "open";
  }
  if (value === "open" || value === "matched" || value === "explained" || value === "resolved") {
    return value;
  }
  return "all";
}

function normalizeStockStatusFilter(value: string | null): StockStatusFilter {
  if (value === "needs_calculation" || value === "pending_receipt" || value === "matched" || value === "variance" || value === "explained") {
    return value;
  }
  return "all";
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
    case "needs_calculation":
    case "pending_receipt":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "variance":
      return "border-rose-200 bg-rose-50 text-rose-700";
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

function stockStatusLabel(dict: AppDictionary, status: DividendStockReconciliationStatus): string {
  switch (status) {
    case "needs_calculation":
      return dict.dividends.review.filter.stockNeedsCalculation;
    case "pending_receipt":
      return dict.dividends.review.filter.stockPendingReceipt;
    case "variance":
      return dict.dividends.review.filter.stockVariance;
    case "matched":
      return dict.dividends.form.reconciliation.statusMatched;
    case "explained":
      return dict.dividends.form.reconciliation.statusExplained;
  }
}

function ReconciliationStatuses({ entry, dict }: { entry: DividendReviewRowSummaryDto; dict: AppDictionary }) {
  const cashStatus = entry.cashReconciliationStatus ?? entry.reconciliationStatus;
  return (
    <div className="flex flex-col items-end gap-1" data-testid={`dividend-review-status-${entry.id}`}>
      {entry.eventType !== "STOCK" ? (
        <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em]", statusBadgeClassName(cashStatus))}>
          {dict.dividends.eventType.cash} · {statusLabel(dict, cashStatus)}
        </span>
      ) : null}
      {entry.eventType !== "CASH" && entry.stockReconciliationStatus ? (
        <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em]", statusBadgeClassName(entry.stockReconciliationStatus))}>
          {dict.dividends.eventType.stock} · {stockStatusLabel(dict, entry.stockReconciliationStatus)}
        </span>
      ) : null}
      {entry.stockReconciliationNote ? <span className="max-w-48 text-right text-[10px] normal-case leading-4 text-slate-500">{entry.stockReconciliationNote}</span> : null}
    </div>
  );
}

function varianceAmount(entry: DividendReviewRowSummaryDto): number {
  if (entry.varianceAmount != null) return entry.varianceAmount;
  return actualNetAmount(entry) - expectedNetAmount(entry);
}

function cashInLieuAmount(entry: DividendReviewRowSummaryDto): number {
  return entry.cashInLieuAmount ?? 0;
}

function nhiAmount(entry: DividendReviewRowSummaryDto): number {
  return entry.nhiAmount ?? 0;
}

function bankFeeAmount(entry: DividendReviewRowSummaryDto): number {
  return entry.bankFeeAmount ?? 0;
}

function otherDeductionAmount(entry: DividendReviewRowSummaryDto): number {
  return entry.otherDeductionAmount ?? 0;
}

function expectedGrossAmount(entry: DividendReviewRowSummaryDto): number {
  return entry.expectedGrossAmount ?? entry.expectedCashAmount;
}

function expectedNetAmount(entry: DividendReviewRowSummaryDto): number {
  if (entry.expectedNetAmount != null) return entry.expectedNetAmount;
  return expectedGrossAmount(entry) - nhiAmount(entry) - bankFeeAmount(entry) - otherDeductionAmount(entry);
}

function actualNetAmount(entry: DividendReviewRowSummaryDto): number {
  if (entry.actualNetAmount != null) return entry.actualNetAmount;
  return entry.receivedCashAmount - nhiAmount(entry) - bankFeeAmount(entry) - otherDeductionAmount(entry);
}

function eventTypeBadgeClassName(eventType: DividendReviewRowSummaryDto["eventType"]): string {
  switch (eventType) {
    case "STOCK":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "CASH_AND_STOCK":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function isPendingStockPosting(entry: DividendReviewRowSummaryDto): boolean {
  return isStockDividendEvent(entry.eventType) && (entry.rowKind === "expected" || entry.postingStatus === "expected");
}

function stockVarianceAmount(entry: DividendReviewRowSummaryDto): number | null {
  if (!isStockDividendEvent(entry.eventType) || isPendingStockPosting(entry)) return null;
  if (entry.expectedStockCalcState === "needs_action" || entry.stockDistributionRatioState === "unresolved") return null;
  if (entry.expectedStockQuantity == null) return null;
  return entry.receivedStockQuantity - entry.expectedStockQuantity;
}

function ratioToneClassName(entry: DividendReviewRowSummaryDto): string {
  if (entry.expectedStockCalcState === "needs_action" || entry.stockDistributionRatioState === "unresolved") {
    return "text-amber-700";
  }
  if (entry.stockDistributionRatioState === "derived_non_authoritative") {
    return "text-muted-foreground";
  }
  return "text-foreground";
}

function stockRatioDisplay(entry: DividendReviewRowSummaryDto, dict: AppDictionary, locale: LocaleCode): string {
  if (!isStockDividendEvent(entry.eventType)) return dict.dividends.unavailable;
  if (entry.stockDistributionRatio == null) {
    return stockRatioStateLabel(dict, entry.stockDistributionRatioState, entry.expectedStockCalcState);
  }
  return `${formatDividendRatio(entry.stockDistributionRatio, locale)} · ${stockRatioStateLabel(dict, entry.stockDistributionRatioState, entry.expectedStockCalcState)}`;
}

function stockExpectedDisplay(entry: DividendReviewRowSummaryDto, dict: AppDictionary, locale: LocaleCode): string {
  if (!isStockDividendEvent(entry.eventType)) return dict.dividends.unavailable;
  if (entry.expectedStockCalcState === "needs_action" || entry.stockDistributionRatioState === "unresolved") {
    return dict.dividends.unavailable;
  }
  if (entry.expectedStockQuantity == null) return dict.dividends.unavailable;
  return formatDividendShares(entry.expectedStockQuantity, locale, dict);
}

function stockReceivedDisplay(entry: DividendReviewRowSummaryDto, dict: AppDictionary, locale: LocaleCode): string {
  if (!isStockDividendEvent(entry.eventType)) return dict.dividends.unavailable;
  if (isPendingStockPosting(entry)) return dict.dividends.pending;
  return formatDividendShares(entry.receivedStockQuantity, locale, dict);
}

function stockVarianceDisplay(entry: DividendReviewRowSummaryDto, dict: AppDictionary, locale: LocaleCode): string {
  const variance = stockVarianceAmount(entry);
  if (variance == null) return dict.dividends.unavailable;
  const prefix = variance > 0 ? "+" : "";
  return `${prefix}${formatDividendShares(variance, locale, dict)}`;
}

function stockVarianceClassName(entry: DividendReviewRowSummaryDto): string {
  const variance = stockVarianceAmount(entry);
  if (variance == null) return "text-muted-foreground";
  if (variance > 0) return "text-emerald-700";
  if (variance < 0) return "text-destructive";
  return "text-emerald-700";
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
    tickers: Array.from(new Set(searchParams.getAll("ticker").map((ticker) => ticker.trim()).filter(Boolean))),
    marketCode: (searchParams.get("marketCode") as MarketCode | null) ?? "",
    accountId: searchParams.get("accountId") ?? "",
    cashStatus: normalizeCashStatusFilter(searchParams.get("cashStatus") ?? searchParams.get("status")),
    stockStatus: normalizeStockStatusFilter(searchParams.get("stockStatus")),
    sourceComposition: searchParams.get("sourceComposition") === "pending" ? "pending" : undefined,
    sortBy: (searchParams.get("sortBy") ?? "paymentDate") as DividendReviewSortColumn,
    sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") ?? "desc",
    page: Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1),
    limit: normalizeReviewLimit(searchParams.get("limit")),
  };
}

function primaryQueryIdentity(query: DividendReviewPrimaryQueryDto): string {
  const tickers = query.tickers ?? (query.ticker ? [query.ticker] : []);
  return JSON.stringify([
    query.fromPaymentDate ?? "",
    query.toPaymentDate ?? "",
    query.accountId ?? "",
    query.cashStatus ?? query.reconciliationStatus ?? "",
    query.stockStatus ?? "",
    query.postingStatus ?? "",
    query.excludeExpected ?? false,
    tickers,
    query.marketCode ?? "",
    query.sourceComposition ?? "",
    query.sortBy,
    query.sortOrder,
    query.page,
    query.limit,
  ]);
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
  field: DividendReviewSortColumn;
  sortBy: DividendReviewSortColumn;
  sortOrder: "asc" | "desc";
  onSort: (field: DividendReviewSortColumn) => void;
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

const TickerFilter = memo(function TickerFilter({
  tickers,
  options,
  dict,
  locale,
  onSelectionChange,
  onInteractionStart,
  onInteractionEnd,
}: {
  tickers: string[];
  options: DividendReviewPrimaryDto["eligibleTickers"];
  dict: AppDictionary;
  locale: LocaleCode;
  onSelectionChange: (tickers: string[]) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedTickers, setSelectedTickers] = useState(tickers);
  const selectedTickersRef = useRef(tickers);
  useEffect(() => {
    if (
      tickers.length === selectedTickersRef.current.length
      && tickers.every((ticker, index) => ticker === selectedTickersRef.current[index])
    ) return;
    selectedTickersRef.current = tickers;
    setSelectedTickers(tickers);
  }, [tickers]);
  const toggleTicker = useCallback((ticker: string) => {
    const current = selectedTickersRef.current;
    const next = current.includes(ticker)
      ? current.filter((candidate) => candidate !== ticker)
      : [...current, ticker];
    selectedTickersRef.current = next;
    setSelectedTickers(next);
    onSelectionChange(next);
  }, [onSelectionChange]);
  const clearTickers = useCallback(() => {
    selectedTickersRef.current = [];
    setSelectedTickers([]);
    onSelectionChange([]);
  }, [onSelectionChange]);
  const filteredOptions = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase(locale);
    if (!normalized) return options;
    return options.filter((option) => selectedTickers.includes(option.ticker)
      || option.ticker.toLocaleLowerCase(locale).includes(normalized)
      || option.name?.toLocaleLowerCase(locale).includes(normalized));
  }, [locale, options, search, selectedTickers]);
  const summary = selectedTickers.length === 0
    ? dict.dividends.review.filter.allTickers
    : selectedTickers.length === 1
      ? (() => {
        const ticker = selectedTickers[0]!;
        const name = options.find((option) => option.ticker === ticker)?.name?.trim();
        return name ? `${ticker} ${name}` : ticker;
      })()
      : dict.dividends.review.filter.tickersSelected.replace("{count}", String(selectedTickers.length));

  return (
    <div className="col-span-2 space-y-1 lg:col-span-1">
      <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.dividends.review.filter.ticker}</span>
      <details
        className="group relative"
        data-testid="filter-ticker-dropdown"
        onPointerDownCapture={onInteractionStart}
        onPointerUpCapture={onInteractionEnd}
        onPointerCancelCapture={onInteractionEnd}
        onKeyDownCapture={(event) => {
          if (event.key === " " || event.key === "Enter") onInteractionStart?.();
        }}
        onKeyUpCapture={(event) => {
          if (event.key === " " || event.key === "Enter") onInteractionEnd?.();
        }}
      >
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 marker:hidden" data-testid="filter-ticker-summary">
          <span className="truncate">{summary}</span>
          <span aria-hidden="true" className="text-slate-500 group-open:rotate-180">⌄</span>
        </summary>
        <div className="absolute left-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <input type="search" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={dict.dividends.review.filter.searchTickers} aria-label={dict.dividends.review.filter.searchTickers} data-testid="filter-ticker-search" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">{dict.dividends.review.filter.tickersSelected.replace("{count}", String(selectedTickers.length))}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={selectedTickers.length === 0}
              onClick={clearTickers}
              data-testid="filter-ticker-clear"
            >
              {dict.dividends.review.filter.clearTickers}
            </Button>
          </div>
          <div className="mt-1 max-h-56 overflow-y-auto" role="group" aria-label={dict.dividends.review.filter.ticker}>
            {filteredOptions.length === 0 ? (
              <p className="px-2 py-3 text-sm text-slate-500">{dict.dividends.review.filter.noTickerMatches}</p>
            ) : filteredOptions.map((option) => (
              <div key={option.ticker} className="flex items-start gap-2 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50" data-testid={`filter-ticker-option-${option.ticker}`}>
                <input
                  type="checkbox"
                  id={`filter-ticker-checkbox-${option.ticker}`}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-emerald-600"
                  checked={selectedTickers.includes(option.ticker)}
                  onChange={() => toggleTicker(option.ticker)}
                  aria-labelledby={`filter-ticker-label-${option.ticker}`}
                  data-testid={`filter-ticker-checkbox-${option.ticker}`}
                />
                <label id={`filter-ticker-label-${option.ticker}`} htmlFor={`filter-ticker-checkbox-${option.ticker}`} className="cursor-pointer">
                  <span className="font-medium text-slate-900">{option.ticker}</span>
                  {option.name ? <span className="ml-2 text-slate-500">{option.name}</span> : null}
                </label>
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
});

// ── Main Component ─────────────────────────────────────────────────────────

export function DividendReviewClient({
  initialData,
  initialQuery,
  dict,
  locale,
  accounts,
  years,
}: DividendReviewClientProps) {
  const searchParams = useSearchParams();
  const shellData = useOptionalAppShellData();
  const canWriteDividends = !shellData?.isSharedContext || shellData.sharedContextPermissions.canWriteDividends;
  const contextRefreshSignal = shellData?.contextRefreshSignal ?? 0;
  const cacheScope = getRouteDtoContextScope(shellData?.sessionUserId);
  const lastContextRefreshSignal = useRef(contextRefreshSignal);

  const [filters, setFilters] = useState<FilterState>(() => parseInitialFilters(searchParams));
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState("");
  const [mutationRetryEntry, setMutationRetryEntry] = useState<DividendReviewRowSummaryDto | null>(null);
  const [dateError, setDateError] = useState("");
  const [eligibleTickerOptions, setEligibleTickerOptions] = useState(initialData?.eligibleTickers ?? []);

  // Phase 4 — single-DOM responsive (card-stack at <sm).
  const isSmallScreen = useIsSmallScreen();

  // Drawer state
  const [drawerEntry, setDrawerEntry] = useState<DividendReviewRowSummaryDto | null>(null);
  const drawerOpenerRef = useRef<HTMLElement | null>(null);
  const focusRestoreTimeoutRef = useRef<number | null>(null);
  const focusRestoreGenerationRef = useRef(0);
  const filtersRef = useRef(filters);
  const tickerInteractionActiveRef = useRef(false);
  const tickerInteractionReleaseRef = useRef<number | null>(null);
  const pendingEligibilityRef = useRef<{
    contextRefreshSignal: number;
    queryIdentity: string;
    options: DividendReviewPrimaryDto["eligibleTickers"];
  } | null>(null);
  const didNormalizeInitialUrlRef = useRef(false);

  // ── Build query from filters ──────────────────────────────────────────

  const buildQueryFromFilters = useCallback((f: FilterState): DividendReviewPrimaryQueryDto => {
    return {
      fromPaymentDate: f.fromDate || undefined,
      toPaymentDate: f.toDate || undefined,
      tickers: f.tickers.length > 0 ? f.tickers : undefined,
      marketCode: f.marketCode || undefined,
      accountId: f.accountId || undefined,
      cashStatus: f.cashStatus === "all" ? undefined : f.cashStatus,
      stockStatus: f.stockStatus === "all" ? undefined : f.stockStatus,
      sourceComposition: f.sourceComposition,
      sortBy: f.sortBy,
      sortOrder: f.sortOrder,
      page: f.page,
      limit: f.limit,
    };
  }, []);
  const canonicalInitialQuery = initialQuery ?? buildQueryFromFilters(filters);

  // ── Sync URL ──────────────────────────────────────────────────────────

  const syncUrl = useCallback((f: FilterState) => {
    const params = new URLSearchParams();
    params.set("view", "ledger");
    if (f.marketCode) params.set("marketCode", f.marketCode);
    if (f.preset !== "currentYear") params.set("preset", f.preset);
    if (f.fromDate) params.set("fromPaymentDate", f.fromDate);
    if (f.toDate) params.set("toPaymentDate", f.toDate);
    for (const ticker of f.tickers) params.append("ticker", ticker);
    if (f.accountId) params.set("accountId", f.accountId);
    if (f.cashStatus !== "all") params.set("cashStatus", f.cashStatus);
    if (f.stockStatus !== "all") params.set("stockStatus", f.stockStatus);
    if (f.sourceComposition) params.set("sourceComposition", f.sourceComposition);
    if (f.sortBy !== "paymentDate") params.set("sortBy", f.sortBy);
    if (f.sortOrder !== "desc") params.set("sortOrder", f.sortOrder);
    params.set("page", String(f.page));
    if (f.limit !== DEFAULT_REVIEW_PAGE_SIZE) params.set("limit", String(f.limit));

    const url = `/dividends?${params.toString()}`;
    window.history.replaceState(null, "", url);
  }, []);

  const restoreQueryState = useCallback((query: DividendReviewPrimaryQueryDto) => {
    const restored: FilterState = {
      ...filtersRef.current,
      fromDate: query.fromPaymentDate ?? "",
      toDate: query.toPaymentDate ?? "",
      accountId: query.accountId ?? "",
      tickers: query.tickers ?? [],
      marketCode: query.marketCode ?? "",
      cashStatus: query.cashStatus ?? query.reconciliationStatus ?? "all",
      stockStatus: query.stockStatus ?? "all",
      sourceComposition: query.sourceComposition,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page: query.page,
      limit: query.limit,
    };
    filtersRef.current = restored;
    setFilters(restored);
    syncUrl(restored);
  }, [syncUrl]);

  const review = useDividendReviewData({
    cachePolicy: shellData?.routeCachePolicy,
    cacheScope,
    initialPrimary: initialData,
    initialQuery: canonicalInitialQuery,
    onQueryRollback: restoreQueryState,
    onQueryRetry: restoreQueryState,
  });
  const contextIsTransitioning = lastContextRefreshSignal.current !== contextRefreshSignal;
  const data = contextIsTransitioning ? null : review.primary;
  const enrichment = contextIsTransitioning ? null : review.enrichment;
  const isLoading = contextIsTransitioning || review.isPrimaryPending;
  const errorMessage = review.primaryError;

  useEffect(() => {
    if (didNormalizeInitialUrlRef.current) return;
    didNormalizeInitialUrlRef.current = true;
    syncUrl(filtersRef.current);
  }, [syncUrl]);

  useEffect(() => {
    return () => {
      if (focusRestoreTimeoutRef.current !== null) {
        window.clearTimeout(focusRestoreTimeoutRef.current);
      }
      if (tickerInteractionReleaseRef.current !== null) {
        window.clearTimeout(tickerInteractionReleaseRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (lastContextRefreshSignal.current === contextRefreshSignal) return;
    lastContextRefreshSignal.current = contextRefreshSignal;
    tickerInteractionActiveRef.current = false;
    pendingEligibilityRef.current = null;
    if (tickerInteractionReleaseRef.current !== null) {
      window.clearTimeout(tickerInteractionReleaseRef.current);
      tickerInteractionReleaseRef.current = null;
    }
    setEligibleTickerOptions([]);
    drawerOpenerRef.current = null;
    focusRestoreGenerationRef.current += 1;
    setDrawerEntry(null);
    clearDividendReviewDrawerDetailCache();
    const next = { ...filtersRef.current, page: 1 };
    filtersRef.current = next;
    setFilters(next);
    syncUrl(next);
    void review.invalidateAndRefresh({ resetPage: true, discardCommitted: true });
  }, [contextRefreshSignal, review.invalidateAndRefresh, syncUrl]);

  // ── Filter change handlers ────────────────────────────────────────────

  const applyFilters = useCallback((next: FilterState) => {
    filtersRef.current = next;
    setFilters(next);
    setDateError("");
    syncUrl(next);
    void review.request(buildQueryFromFilters(next));
  }, [buildQueryFromFilters, review.request, syncUrl]);

  const applyAuthoritativeEligibility = useCallback((options: DividendReviewPrimaryDto["eligibleTickers"]) => {
    setEligibleTickerOptions(options);
    const eligible = new Set(options.map((option) => option.ticker));
    const retained = filtersRef.current.tickers.filter((ticker) => eligible.has(ticker));
    if (retained.length === filtersRef.current.tickers.length) return;
    applyFilters({ ...filtersRef.current, tickers: retained, marketCode: "", page: 1 });
  }, [applyFilters]);

  const handleTickerInteractionStart = useCallback(() => {
    if (tickerInteractionReleaseRef.current !== null) {
      window.clearTimeout(tickerInteractionReleaseRef.current);
      tickerInteractionReleaseRef.current = null;
    }
    tickerInteractionActiveRef.current = true;
  }, []);

  const handleTickerInteractionEnd = useCallback(() => {
    if (tickerInteractionReleaseRef.current !== null) {
      window.clearTimeout(tickerInteractionReleaseRef.current);
    }
    tickerInteractionReleaseRef.current = window.setTimeout(() => {
      tickerInteractionReleaseRef.current = null;
      tickerInteractionActiveRef.current = false;
      const pending = pendingEligibilityRef.current;
      pendingEligibilityRef.current = null;
      if (
        pending === null
        || pending.contextRefreshSignal !== contextRefreshSignal
        || pending.queryIdentity !== primaryQueryIdentity(buildQueryFromFilters(filtersRef.current))
      ) return;
      applyAuthoritativeEligibility(pending.options);
    }, 0);
  }, [applyAuthoritativeEligibility, buildQueryFromFilters, contextRefreshSignal]);

  const handlePresetChange = useCallback((preset: DatePreset) => {
    const today = new Date();
    const resolved = resolvePresetDates(preset, today);
    const current = filtersRef.current;
    const next: FilterState = {
      ...current,
      preset,
      fromDate: resolved.from ?? "",
      toDate: resolved.to ?? "",
      page: 1,
    };
    if (preset === "custom") {
      // Only update UI + URL; defer fetch until user enters a valid date range
      filtersRef.current = next;
      setFilters(next);
      syncUrl(next);
    } else {
      applyFilters(next);
    }
  }, [applyFilters, syncUrl]);

  const handleYearToggle = useCallback((year: number) => {
    const active = filtersRef.current;
    const selectedYears = new Set(selectedYearsFromFilters(active));
    if (selectedYears.has(year)) {
      selectedYears.delete(year);
    } else {
      selectedYears.add(year);
    }
    const selected = Array.from(selectedYears).sort((a, b) => a - b);
    if (selected.length === 0) {
      handlePresetChange("currentYear");
      return;
    }
    const fromYear = selected[0]!;
    const toYear = selected[selected.length - 1]!;
    applyFilters({
      ...active,
      preset: "yearRange",
      fromDate: `${fromYear}-01-01`,
      toDate: `${toYear}-12-31`,
      page: 1,
    });
  }, [applyFilters, handlePresetChange]);

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

  const handleTickerSelectionChange = useCallback((selected: string[]) => {
    const current = filtersRef.current;
    applyFilters({
      ...current,
      tickers: selected,
      marketCode: "",
      page: 1,
    });
  }, [applyFilters]);

  const handleAccountChange = useCallback((accountId: string) => {
    applyFilters({ ...filtersRef.current, accountId, page: 1 });
  }, [applyFilters]);

  const handleCashStatusChange = useCallback((cashStatus: CashStatusFilter) => {
    applyFilters({ ...filtersRef.current, cashStatus, page: 1 });
  }, [applyFilters]);

  const handleStockStatusChange = useCallback((stockStatus: StockStatusFilter) => {
    applyFilters({ ...filtersRef.current, stockStatus, page: 1 });
  }, [applyFilters]);

  const handleSort = useCallback((field: DividendReviewSortColumn) => {
    const current = filtersRef.current;
    const nextOrder = current.sortBy === field && current.sortOrder === "asc" ? "desc" : "asc";
    applyFilters({ ...current, sortBy: field, sortOrder: nextOrder, page: 1 });
  }, [applyFilters]);

  const openDrawer = useCallback((entry: DividendReviewRowSummaryDto, opener: HTMLElement) => {
    focusRestoreGenerationRef.current += 1;
    if (focusRestoreTimeoutRef.current !== null) {
      window.clearTimeout(focusRestoreTimeoutRef.current);
      focusRestoreTimeoutRef.current = null;
    }
    drawerOpenerRef.current = opener;
    setDrawerEntry(entry);
  }, []);

  const closeDrawer = useCallback(() => {
    const opener = drawerOpenerRef.current;
    if (opener) {
      focusRestoreGenerationRef.current += 1;
      const generation = focusRestoreGenerationRef.current;
      drawerOpenerRef.current = null;
      focusRestoreTimeoutRef.current = window.setTimeout(() => {
        focusRestoreTimeoutRef.current = null;
        if (
          generation === focusRestoreGenerationRef.current
          && drawerOpenerRef.current === null
          && opener.isConnected
        ) {
          opener.focus();
        }
      }, 100);
    }
    setDrawerEntry(null);
  }, []);

  const handleRowClick = useCallback((event: ReactMouseEvent<HTMLElement>, entry: DividendReviewRowSummaryDto) => {
    openDrawer(entry, event.currentTarget);
  }, [openDrawer]);

  const handlePageChange = useCallback((page: number) => {
    applyFilters({ ...filtersRef.current, page });
  }, [applyFilters]);

  const handleLimitChange = useCallback((limit: 10 | 25 | 50) => {
    applyFilters({ ...filtersRef.current, limit, page: 1 });
  }, [applyFilters]);

  // ── NHI Rollup: filter pending disclosure ─────────────────────────────

  const handleFilterPending = useCallback(() => {
    applyFilters({ ...filtersRef.current, sourceComposition: "pending", page: 1 });
  }, [applyFilters]);

  // ── Mark Matched ──────────────────────────────────────────────────────

  const handleMarkMatched = useCallback(async (entry: DividendReviewRowSummaryDto) => {
    if (entry.rowKind === "expected") return;
    setPendingEntryId(entry.id);
    setMutationError("");
    try {
      await updateDividendReconciliation(entry.id, "matched");
      clearDividendReviewDrawerDetailCache();
      await review.invalidateAndRefresh();
      setMutationRetryEntry(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : String(error));
      setMutationRetryEntry(entry);
    } finally {
      setPendingEntryId(null);
    }
  }, [review.invalidateAndRefresh]);

  // ── SSE ───────────────────────────────────────────────────────────────

  useEventStream({
    enabled: true,
    eventTypes: ["dividend_reconciliation_changed", "dividend_stock_reconciliation_changed", "dividend_posted", "dividend_updated"],
    onEvent: (event: unknown) => {
      void event;
      clearDividendReviewDrawerDetailCache();
      void review.invalidateAndRefresh();
    },
  });

  // ── Computed values ───────────────────────────────────────────────────

  // Apply client-side source composition filter
  const displayEntries = data?.reviewRows ?? [];
  const committedAccounts = contextIsTransitioning
    ? []
    : review.committedPrimary?.accounts ?? (contextRefreshSignal === 0 ? accounts : []);
  const committedYears = contextIsTransitioning
    ? []
    : review.committedPrimary?.years ?? (contextRefreshSignal === 0 ? years : []);
  const committedEligibleTickers = useMemo(
    () => contextIsTransitioning
      ? []
      : [...eligibleTickerOptions].sort((left, right) => left.ticker.localeCompare(right.ticker)),
    [contextIsTransitioning, eligibleTickerOptions],
  );
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / filters.limit));
  const aggregates: DividendLedgerAggregates = enrichment?.aggregates ?? {
    totalExpectedCashAmount: {}, totalReceivedCashAmount: {}, openCount: 0, byMonth: {}, byTicker: {},
  };
  const hero = enrichment?.hero ?? aggregates.hero;
  const hasOpenItems = hero
    ? hero.needsAttentionCount > 0
    : aggregates.openCount > 0;

  const accountNameById = useMemo(
    () => new Map(committedAccounts.map((a) => [a.id, a.name || a.id])),
    [committedAccounts],
  );

  useEffect(() => {
    const nextOptions = review.committedPrimary?.eligibleTickers;
    if (contextIsTransitioning || nextOptions === undefined || review.isPrimaryPending) return;
    const queryIdentity = primaryQueryIdentity(review.committedQuery);
    if (queryIdentity !== primaryQueryIdentity(buildQueryFromFilters(filtersRef.current))) return;
    if (tickerInteractionActiveRef.current) {
      pendingEligibilityRef.current = { contextRefreshSignal, queryIdentity, options: nextOptions };
      return;
    }
    pendingEligibilityRef.current = null;
    applyAuthoritativeEligibility(nextOptions);
  }, [applyAuthoritativeEligibility, buildQueryFromFilters, contextIsTransitioning, contextRefreshSignal, review.committedPrimary, review.committedQuery, review.isPrimaryPending]);

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

      {/* Filter bar */}
      <Card
        className="space-y-4 rounded-[20px] border border-slate-200 bg-white/92 p-4 shadow-[0_12px_28px_rgba(148,163,184,0.1)] hover:translate-y-0"
        data-testid="review-filter-bar"
      >
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
          {committedYears.length > 0 ? (
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
                {[...committedYears].sort((a, b) => a - b).map((year) => {
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
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
          <TickerFilter
            tickers={filters.tickers}
            options={committedEligibleTickers}
            dict={dict}
            locale={locale}
            onSelectionChange={handleTickerSelectionChange}
            onInteractionStart={handleTickerInteractionStart}
            onInteractionEnd={handleTickerInteractionEnd}
          />
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
              {committedAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name || a.id}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {dict.dividends.review.filter.cashStatus}
            </span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              value={filters.cashStatus}
              onChange={(e) => handleCashStatusChange(e.target.value as CashStatusFilter)}
              data-testid="filter-cash-status"
            >
              <option value="all">{dict.dividends.review.filter.allStatuses}</option>
              <option value="open">{dict.dividends.form.reconciliation.statusOpen}</option>
              <option value="matched">{dict.dividends.form.reconciliation.statusMatched}</option>
              <option value="explained">{dict.dividends.form.reconciliation.statusExplained}</option>
              <option value="resolved">{dict.dividends.form.reconciliation.statusResolved}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {dict.dividends.review.filter.stockStatus}
            </span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              value={filters.stockStatus}
              onChange={(e) => handleStockStatusChange(e.target.value as StockStatusFilter)}
              data-testid="filter-stock-status"
            >
              <option value="all">{dict.dividends.review.filter.allStatuses}</option>
              <option value="needs_calculation">{dict.dividends.review.filter.stockNeedsCalculation}</option>
              <option value="pending_receipt">{dict.dividends.review.filter.stockPendingReceipt}</option>
              <option value="matched">{dict.dividends.form.reconciliation.statusMatched}</option>
              <option value="variance">{dict.dividends.review.filter.stockVariance}</option>
              <option value="explained">{dict.dividends.form.reconciliation.statusExplained}</option>
            </select>
          </label>
        </div>

        {dateError && (
          <p className="text-xs text-rose-600" data-testid="date-error">{dateError}</p>
        )}
      </Card>

      {enrichment && hasOpenItems ? (
        <Card className="rounded-[20px] border-amber-200 bg-amber-50/70 px-4 py-3">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">{hero ? hero.needsAttentionCount : aggregates.openCount} {dict.dividends.review.stat.needsAttention.toLowerCase()}.</span>{" "}
            {dict.dividends.review.filter.needsReconciliation}
          </p>
        </Card>
      ) : null}

      {/* Stats tiles */}
      {enrichment ? (
        <StatTiles aggregates={aggregates} hero={hero} dict={dict} locale={locale} />
      ) : review.isEnrichmentPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true" data-testid="review-stats-loading">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-[20px] bg-muted/50" />)}
        </div>
      ) : null}

      {enrichment && review.isEnrichmentPending ? (
        <p className="text-xs text-muted-foreground" role="status" data-testid="review-enrichment-refreshing">
          {dict.dividends.review.loading.refreshing}
        </p>
      ) : null}

      {review.enrichmentError ? (
        <Card
          className="flex flex-col items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center"
          data-testid="review-enrichment-error"
          role="alert"
        >
          <p className="text-sm text-amber-800">
            {dict.dividends.review.loading.enrichmentError}: {review.enrichmentError}
            {enrichment ? ` ${dict.dividends.review.loading.enrichmentStale}` : ""}
          </p>
          <Button size="sm" variant="secondary" onClick={() => void review.retryEnrichment()} data-testid="review-enrichment-retry">
            {dict.dividends.review.loading.retry}
          </Button>
        </Card>
      ) : null}

      {/* Error */}
      {errorMessage && (
        <div className="flex items-center justify-between gap-3 rounded-[22px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" data-testid="review-error" role="alert">
          <span>{dict.dividends.review.loading.primaryError}: {errorMessage}</span>
          <Button size="sm" variant="secondary" onClick={() => void review.retryPrimary()} data-testid="review-primary-retry">
            {dict.dividends.review.loading.retry}
          </Button>
        </div>
      )}

      {mutationError ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert" data-testid="review-mutation-error">
          <span>{mutationError}</span>
          {mutationRetryEntry ? (
            <Button size="sm" variant="secondary" onClick={() => void handleMarkMatched(mutationRetryEntry)} data-testid="review-mutation-retry">
              {dict.dividends.review.loading.retry}
            </Button>
          ) : null}
        </div>
      ) : null}

      {review.isPrimaryRefreshing ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-700" role="status" data-testid="review-refreshing">
          {dict.dividends.review.loading.refreshing}
        </div>
      ) : null}

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
                onChange={(event) => {
                  const sortBy = event.target.value as DividendReviewSortColumn;
                  applyFilters({
                    ...filters,
                    sortBy,
                    sortOrder: sortBy === filters.sortBy ? filters.sortOrder : "asc",
                    page: 1,
                  });
                }}
                data-testid="review-mobile-sort-field"
              >
                <option value="paymentDate">{dict.dividends.review.table.paymentDate}</option>
                <option value="ticker">{dict.dividends.review.table.ticker}</option>
                <option value="account">{dict.dividends.review.table.account}</option>
                <option value="expectedGrossAmount">{dict.dividends.review.table.expected}</option>
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
          <ul className="flex flex-col gap-3" data-testid="review-table" aria-busy={isLoading}>
          {isLoading ? (
            Array.from({ length: Math.min(filters.limit, 5) }, (_, index) => (
              <li key={`skeleton-${index}`} className="h-44 animate-pulse rounded-xl border border-border bg-muted/50" data-testid="review-row-skeleton" />
            ))
          ) : displayEntries.length === 0 ? (
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
                    onClick={(event) => handleRowClick(event, entry)}
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
                        <div className="mt-2">
                          <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold", eventTypeBadgeClassName(entry.eventType))}>
                            {dividendEventTypeLabel(dict, entry.eventType)}
                          </span>
                        </div>
                      </div>
                      <ReconciliationStatuses entry={entry} dict={dict} />
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.paymentDate}</dt>
                        <dd className="font-medium text-foreground">{entry.paymentDate ? formatDateLabel(entry.paymentDate, locale) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.eventType}</dt>
                        <dd className="font-medium text-foreground">{dividendEventTypeLabel(dict, entry.eventType)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.expected}</dt>
                        <dd className="font-medium text-foreground">{formatCurrencyAmount(expectedGrossAmount(entry), entry.cashCurrency, locale)}</dd>
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
                        <dt className="text-muted-foreground">{dict.dividends.review.table.expectedStock}</dt>
                        <dd className="font-medium text-foreground">{stockExpectedDisplay(entry, dict, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.ratioState}</dt>
                        <dd className={cn("font-medium", ratioToneClassName(entry))}>{stockRatioDisplay(entry, dict, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.stockReceived}</dt>
                        <dd className={cn("font-medium", isPendingStockPosting(entry) ? "text-amber-700" : "text-foreground")}>{stockReceivedDisplay(entry, dict, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.stockVariance}</dt>
                        <dd className={cn("font-medium", stockVarianceClassName(entry))}>{stockVarianceDisplay(entry, dict, locale)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{dict.dividends.review.table.cashInLieu}</dt>
                        <dd className="font-medium text-foreground">{cashInLieuAmount(entry) > 0 ? formatCurrencyAmount(cashInLieuAmount(entry), entry.cashCurrency, locale) : dict.dividends.unavailable}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          openDrawer(entry, event.currentTarget);
                        }}
                        data-testid={`review-row-${entry.id}-open`}
                      >
                        {dict.dividends.action.viewDetails}
                      </Button>
                      {canWriteDividends && entry.rowKind !== "expected" && (entry.cashReconciliationStatus ?? entry.reconciliationStatus) === "open" ? (
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
                    </div>
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
                disabled={filters.page <= 1 || review.isPrimaryPending || review.isPrimaryRefreshing}
                onClick={() => handlePageChange(filters.page - 1)}
                data-testid="pagination-prev"
              >
                {dict.dividends.review.pagination.previous}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={filters.page >= totalPages || review.isPrimaryPending || review.isPrimaryRefreshing}
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
            <table className="w-full" data-testid="review-table" aria-busy={isLoading}>
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <SortHeader label={dict.dividends.review.table.paymentDate} field="paymentDate" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} sticky />
                  <SortHeader label={dict.dividends.review.table.ticker} field="ticker" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.account} field="account" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.eventType}</th>
                  <SortHeader label={dict.dividends.review.table.expected} field="expectedGrossAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.received} field="receivedCashAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.nhi} field="nhiAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.bankFee} field="bankFeeAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.otherDeduction} field="otherDeductionAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.expectedNet} field="expectedNetAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.actualNet} field="actualNetAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.expectedStock}</th>
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.ratioState}</th>
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.stockReceived}</th>
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.stockVariance}</th>
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.cashInLieu}</th>
                  <SortHeader label={dict.dividends.review.table.variance} field="varianceAmount" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <SortHeader label={dict.dividends.review.table.status} field="reconciliationStatus" sortBy={filters.sortBy} sortOrder={filters.sortOrder} onSort={handleSort} />
                  <th className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.dividends.review.table.actions}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: Math.min(filters.limit, 5) }, (_, index) => (
                    <tr key={`skeleton-${index}`} className="h-14 animate-pulse border-b border-border" data-testid="review-row-skeleton">
                      <td colSpan={19} className="bg-muted/40" />
                    </tr>
                  ))
                ) : displayEntries.length === 0 ? (
                  <tr>
                    <td colSpan={19} className="px-4 py-10 text-center text-sm text-muted-foreground">
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
                        onClick={(event) => handleRowClick(event, entry)}
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
                        <td className="px-4 py-3 text-sm">
                          <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-semibold", eventTypeBadgeClassName(entry.eventType))}>
                            {dividendEventTypeLabel(dict, entry.eventType)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {formatCurrencyAmount(expectedGrossAmount(entry), entry.cashCurrency, locale)}
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
                          {stockExpectedDisplay(entry, dict, locale)}
                        </td>
                        <td className={cn("px-4 py-3 text-sm", ratioToneClassName(entry))}>
                          {stockRatioDisplay(entry, dict, locale)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          <span className={cn(isPendingStockPosting(entry) ? "text-amber-700" : "text-foreground")}>
                            {stockReceivedDisplay(entry, dict, locale)}
                          </span>
                        </td>
                        <td className={cn("px-4 py-3 text-sm font-medium", stockVarianceClassName(entry))}>
                          {stockVarianceDisplay(entry, dict, locale)}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {cashInLieuAmount(entry) > 0 ? formatCurrencyAmount(cashInLieuAmount(entry), entry.cashCurrency, locale) : dict.dividends.unavailable}
                        </td>
                        <td className={cn("px-4 py-3 text-sm", variance !== 0 ? "text-amber-600 font-medium" : "text-muted-foreground")}>
                          {variance !== 0 ? formatCurrencyAmount(variance, entry.cashCurrency, locale) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <ReconciliationStatuses entry={entry} dict={dict} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                openDrawer(entry, event.currentTarget);
                              }}
                              data-testid={`review-row-${entry.id}-open`}
                            >
                              {dict.dividends.action.viewDetails}
                            </Button>
                          {canWriteDividends && entry.rowKind !== "expected" && (entry.cashReconciliationStatus ?? entry.reconciliationStatus) === "open" ? (
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
                          </div>
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
                  disabled={filters.page <= 1 || review.isPrimaryPending || review.isPrimaryRefreshing}
                  onClick={() => handlePageChange(filters.page - 1)}
                  data-testid="pagination-prev"
                >
                  {dict.dividends.review.pagination.previous}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={filters.page >= totalPages || review.isPrimaryPending || review.isPrimaryRefreshing}
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
      {enrichment ? (
        <NhiRollupSection
          rollup={enrichment.nhiRollup}
          dict={dict}
          locale={locale}
          onFilterPending={handleFilterPending}
        />
      ) : review.isEnrichmentPending ? (
        <Card className="h-40 animate-pulse rounded-xl border border-border bg-muted/40" aria-busy="true" data-testid="review-enrichment-loading" />
      ) : null}

      {/* Charts */}
      {enrichment ? (
        <Card className="rounded-[20px] border border-slate-200 bg-white/92 p-4 shadow-[0_12px_28px_rgba(148,163,184,0.1)]" aria-busy={review.isEnrichmentPending}>
          <DividendReviewCharts
            byMonth={aggregates.byMonth}
            byTicker={aggregates.byTicker}
            dict={dict}
            defaultGranularity={defaultChartGranularity}
          />
        </Card>
      ) : review.isEnrichmentPending ? (
        <Card className="h-64 animate-pulse rounded-[20px] border border-border bg-muted/40" aria-busy="true" data-testid="review-charts-loading" />
      ) : null}

      <DividendReviewDrawer
        dict={dict}
        locale={locale}
        entry={drawerEntry}
        cacheScope={cacheScope}
        resolveAccountName={(accountId) => accountNameById.get(accountId) ?? accountId}
        onClose={closeDrawer}
        onSaved={async () => {
          clearDividendReviewDrawerDetailCache();
          await review.invalidateAndRefresh();
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
  hero,
  dict,
  locale,
}: {
  aggregates: DividendLedgerAggregates;
  hero?: DividendReviewHeroAggregatesDto;
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
      <StockStatTile
        label={dict.dividends.review.stat.totalExpected}
        cashEntries={Object.entries(aggregates.totalExpectedCashAmount)}
        rows={hero?.expectedStockTopTickers ?? []}
        fullRows={hero?.expectedStockTickers ?? hero?.expectedStockTopTickers ?? []}
        remainingCount={hero?.expectedStockRemainingTickerCount ?? 0}
        value="expected"
        dict={dict}
        locale={locale}
        testId="stat-expected-stock"
      />
      <StockStatTile
        label={dict.dividends.review.stat.totalReceived}
        cashEntries={Object.entries(aggregates.totalReceivedCashAmount)}
        rows={hero?.receivedStockTopTickers ?? []}
        fullRows={hero?.receivedStockTickers ?? hero?.receivedStockTopTickers ?? []}
        remainingCount={hero?.receivedStockRemainingTickerCount ?? 0}
        value="received"
        dict={dict}
        locale={locale}
        testId="stat-received-stock"
      />
      <StatTile
        label={dict.dividends.review.stat.cashVariance}
        entries={varianceEntries.map((v) => [v.currency, v.amount] as [string, number])}
        locale={locale}
        highlightNonZero
        testId="stat-cash-variance"
      />
      <Card className="rounded-[20px] border border-slate-200 bg-white/92 p-4 shadow-[0_12px_28px_rgba(148,163,184,0.1)]" data-testid="stat-needs-attention">
        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.dividends.review.stat.needsAttention}</p>
        <p className="mt-2 text-2xl font-semibold text-slate-950">{hero ? hero.needsAttentionCount : aggregates.openCount}</p>
        {hero ? (
          <dl className="mt-2 space-y-1 text-xs text-slate-600">
            <div className="flex justify-between gap-3"><dt>{dict.dividends.review.stat.cashAttention}</dt><dd>{hero.cashAttentionCount}</dd></div>
            <div className="flex justify-between gap-3"><dt>{dict.dividends.review.stat.stockAttention}</dt><dd>{hero.stockAttentionCount}</dd></div>
            <div className="flex justify-between gap-3"><dt>{dict.dividends.review.stat.needsCalculation}</dt><dd>{hero.needsCalculationCount}</dd></div>
          </dl>
        ) : null}
      </Card>
    </div>
  );
}

function StatTile({
  label,
  entries,
  locale,
  highlightNonZero = false,
  testId,
}: {
  label: string;
  entries: [string, number][];
  locale: LocaleCode;
  highlightNonZero?: boolean;
  testId?: string;
}) {
  return (
    <Card className="rounded-[20px] border border-slate-200 bg-white/92 p-4 shadow-[0_12px_28px_rgba(148,163,184,0.1)]" data-testid={testId}>
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

function StockStatTile({
  label,
  cashEntries,
  rows,
  fullRows,
  remainingCount,
  value,
  dict,
  locale,
  testId,
}: {
  label: string;
  cashEntries: [string, number][];
  rows: DividendReviewHeroAggregatesDto["expectedStockTopTickers"];
  fullRows: DividendReviewHeroAggregatesDto["expectedStockTickers"];
  remainingCount: number;
  value: "expected" | "received";
  dict: AppDictionary;
  locale: LocaleCode;
  testId: string;
}) {
  const visibleRows = rows.slice(0, 3);
  return (
    <Card className="rounded-[20px] border border-slate-200 bg-white/92 p-4 shadow-[0_12px_28px_rgba(148,163,184,0.1)]" data-testid={testId}>
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{dict.dividends.review.stat.cashAttention}</p>
          <div className="mt-1 space-y-1">
            {cashEntries.length === 0 ? <p className="text-xl font-semibold text-slate-950">—</p> : cashEntries.map(([currency, amount]) => (
              <p key={currency} className="text-lg font-semibold text-slate-950">{formatCurrencyAmount(amount, currency, locale)}</p>
            ))}
          </div>
        </div>
        <div className="border-t border-slate-200 pt-3 sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0 lg:border-l-0 lg:border-t lg:pl-0 lg:pt-3 xl:border-l xl:border-t-0 xl:pl-3 xl:pt-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{dict.dividends.review.stat.stockAttention}</p>
          <ul className="mt-1 space-y-2">
            {visibleRows.length === 0 ? <li className="text-xl font-semibold text-slate-950">—</li> : visibleRows.map((row) => {
              const shares = value === "expected" ? row.expectedWholeShares : row.receivedShares;
              return (
                <li key={`${row.marketCode}:${row.ticker}`} className="flex items-start justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-600">{row.marketCode} · {row.ticker}</span>
                  <span className="text-right font-semibold text-slate-950">
                    {shares == null ? dict.dividends.unavailable : `${new Intl.NumberFormat(locale).format(shares)} ${dict.dividends.sharesUnit}`}
                    {value === "expected" && row.unresolvedEventCount > 0 ? <span className="block font-normal text-amber-700">{row.unresolvedEventCount} {row.unresolvedEventCount === 1 ? dict.dividends.review.stat.eventNeedsCalculation : dict.dividends.review.stat.eventsNeedCalculation}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {remainingCount > 0 ? (
            <details className="mt-2 text-xs text-slate-600">
              <summary className="cursor-pointer rounded-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" data-testid={`${testId}-overflow`}>
                +{remainingCount} {dict.dividends.review.stat.more}
              </summary>
              <p className="mt-1 leading-5">{dict.dividends.review.stat.additionalTickers}</p>
              <ul className="mt-2 space-y-2 border-t border-slate-200 pt-2" data-testid={`${testId}-breakdown`}>
                {fullRows.map((row) => {
                  const shares = value === "expected" ? row.expectedWholeShares : row.receivedShares;
                  return (
                    <li key={`${row.marketCode}:${row.ticker}`} className="flex items-start justify-between gap-2">
                      <span className="font-medium text-slate-600">{row.marketCode} · {row.ticker}</span>
                      <span className="text-right font-semibold text-slate-950">
                        {shares == null ? dict.dividends.unavailable : `${new Intl.NumberFormat(locale).format(shares)} ${dict.dividends.sharesUnit}`}
                        {value === "expected" && row.unresolvedEventCount > 0 ? <span className="block font-normal text-amber-700">{row.unresolvedEventCount} {row.unresolvedEventCount === 1 ? dict.dividends.review.stat.eventNeedsCalculation : dict.dividends.review.stat.eventsNeedCalculation}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
