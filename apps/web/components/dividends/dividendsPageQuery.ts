import { resolvePresetDates, type DatePreset } from "./dividendReviewUtils";
import type {
  DividendReviewPageLimit,
  DividendCashReconciliationStatus,
  DividendReviewPostingStatus,
  DividendReviewPrimaryQueryDto,
  DividendReviewReconciliationStatus,
  DividendReviewSortColumn,
  DividendStockReconciliationStatus,
  MarketCode,
} from "@vakwen/shared-types";
import type { DividendQuery } from "../../features/dividends/services/dividendService";

const REVIEW_PAGE_SIZE_VALUES = [10, 25, 50] as const;
const DEFAULT_REVIEW_PAGE_SIZE = 10;
const CASH_STATUSES: DividendCashReconciliationStatus[] = ["open", "matched", "explained", "resolved"];
const STOCK_STATUSES: DividendStockReconciliationStatus[] = ["needs_calculation", "pending_receipt", "matched", "variance", "explained"];
const SUPPORTED_REVIEW_SORTS = new Set<DividendReviewSortColumn>([
  "paymentDate",
  "ticker",
  "account",
  "expectedNetAmount",
  "nhiAmount",
  "bankFeeAmount",
  "otherDeductionAmount",
  "actualNetAmount",
  "varianceAmount",
  "reconciliationStatus",
]);
const RETIRED_REVIEW_SORTS = new Set<
  DividendReviewSortColumn
  | "exDate"
  | "expectedCashAmount"
  | "expectedGrossAmount"
  | "receivedCashAmount"
>([
  "exDate",
  "expectedCashAmount",
  "expectedGrossAmount",
  "receivedCashAmount",
]);

export type DividendsSearchParamsRecord = Record<string, string | string[] | undefined>;

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isValidMonthKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function calendarMonthFromSearchParams(
  searchParams: DividendsSearchParamsRecord | URLSearchParams,
): string {
  const requestedMonth = getValue(searchParams, "month");
  return isValidMonthKey(requestedMonth) ? requestedMonth : currentMonthKey();
}

export function monthQuery(monthKey: string): DividendQuery & {
  fromPaymentDate: string;
  toPaymentDate: string;
  limit: number;
} {
  const year = Number(monthKey.slice(0, 4));
  const monthIndex = Number(monthKey.slice(5, 7)) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));

  return {
    fromPaymentDate: start.toISOString().slice(0, 10),
    toPaymentDate: end.toISOString().slice(0, 10),
    limit: 500,
  };
}

export function currentMonthQuery(): DividendQuery & {
  fromPaymentDate: string;
  toPaymentDate: string;
  limit: number;
} {
  return monthQuery(currentMonthKey());
}

export function calendarQueryFromSearchParams(
  searchParams: DividendsSearchParamsRecord | URLSearchParams,
): DividendQuery & {
  fromPaymentDate: string;
  toPaymentDate: string;
  limit: number;
} {
  return monthQuery(calendarMonthFromSearchParams(searchParams));
}

function getValue(
  searchParams: DividendsSearchParamsRecord | URLSearchParams,
  key: string,
): string | undefined {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get(key) ?? undefined;
  }

  const value = searchParams[key];
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

function getValues(
  searchParams: DividendsSearchParamsRecord | URLSearchParams,
  key: string,
): string[] {
  const values = searchParams instanceof URLSearchParams
    ? searchParams.getAll(key)
    : typeof searchParams[key] === "string"
      ? [searchParams[key]]
      : searchParams[key] ?? [];
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function normalizeTickerQueryValues(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values, (value) => value.trim().toUpperCase()).filter(Boolean)));
}

function normalizeStatusFilter(status: string): string {
  if (status === "needs-review" || status === "needsReview") {
    return "needsReconciliation";
  }
  return status;
}

export function normalizeReviewSort(
  value: string | undefined,
): { sortBy: DividendReviewSortColumn; canonicalized: boolean } {
  if (!value || value === "paymentDate") {
    return { sortBy: "paymentDate", canonicalized: false };
  }
  if (RETIRED_REVIEW_SORTS.has(value as DividendReviewSortColumn) || !SUPPORTED_REVIEW_SORTS.has(value as DividendReviewSortColumn)) {
    return { sortBy: "paymentDate", canonicalized: true };
  }
  return {
    sortBy: value as DividendReviewSortColumn,
    canonicalized: false,
  };
}

function normalizeReviewLimit(value: string | undefined): DividendReviewPageLimit {
  const parsed = Number.parseInt(value ?? "", 10);
  return REVIEW_PAGE_SIZE_VALUES.includes(parsed as (typeof REVIEW_PAGE_SIZE_VALUES)[number])
    ? parsed as DividendReviewPageLimit
    : DEFAULT_REVIEW_PAGE_SIZE;
}

export function searchParamsToReviewQuery(
  searchParams: DividendsSearchParamsRecord | URLSearchParams,
): DividendReviewPrimaryQueryDto {
  const preset = (getValue(searchParams, "preset") ?? "currentYear") as DatePreset;
  const today = new Date();
  const resolved = resolvePresetDates(preset, today);

  const fromDate = getValue(searchParams, "fromPaymentDate") ?? resolved.from ?? "";
  const toDate = getValue(searchParams, "toPaymentDate") ?? resolved.to ?? "";
  const status = normalizeStatusFilter(getValue(searchParams, "status") ?? "all");
  const sortBy = normalizeReviewSort(getValue(searchParams, "sortBy")).sortBy;
  const sortOrder = (getValue(searchParams, "sortOrder") ?? "desc") as "asc" | "desc";
  const page = Math.max(1, parseInt(getValue(searchParams, "page") ?? "1", 10) || 1);
  const limit = normalizeReviewLimit(getValue(searchParams, "limit"));
  const tickers = normalizeTickerQueryValues(getValues(searchParams, "ticker"));
  const marketCode = getValue(searchParams, "marketCode");
  const accountIds = getValues(searchParams, "accountId").slice(0, 50);
  const sourceComposition = getValue(searchParams, "sourceComposition") === "pending" ? "pending" : undefined;
  const cashStatuses = getValues(searchParams, "cashStatus")
    .filter((value): value is DividendCashReconciliationStatus => CASH_STATUSES.includes(value as DividendCashReconciliationStatus))
    .slice(0, 50);
  const stockStatuses = getValues(searchParams, "stockStatus")
    .filter((value): value is DividendStockReconciliationStatus => STOCK_STATUSES.includes(value as DividendStockReconciliationStatus))
    .slice(0, 50);

  let postingStatus: DividendReviewPostingStatus | undefined;
  let reconciliationStatus: DividendReviewReconciliationStatus | undefined;
  let excludeExpected = getValue(searchParams, "excludeExpected") === "true";
  if (status === "needsReconciliation") {
    reconciliationStatus = "open";
    excludeExpected = true;
  } else if (status !== "all") {
    reconciliationStatus = status as DividendReviewReconciliationStatus;
  }

  return {
    fromPaymentDate: fromDate || undefined,
    toPaymentDate: toDate || undefined,
    tickers: tickers.length > 0 ? tickers : undefined,
    marketCode: marketCode as MarketCode | undefined,
    ...(accountIds.length > 0 ? { accountIds } : {}),
    ...(cashStatuses.length > 0 ? { cashStatuses } : {}),
    ...(stockStatuses.length > 0 ? { stockStatuses } : {}),
    ...(postingStatus ? { postingStatus } : {}),
    ...(reconciliationStatus ? { reconciliationStatus } : {}),
    ...(excludeExpected ? { excludeExpected } : {}),
    ...(sourceComposition ? { sourceComposition } : {}),
    sortBy,
    sortOrder,
    page,
    limit,
  };
}
