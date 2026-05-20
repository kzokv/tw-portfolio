import { resolvePresetDates, type DatePreset } from "./dividendReviewUtils";
import type { DividendReviewQuery } from "../../features/dividends/services/dividendService";

export type DividendsSearchParamsRecord = Record<string, string | string[] | undefined>;

export function currentMonthQuery(): {
  fromPaymentDate: string;
  toPaymentDate: string;
  limit: number;
} {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));

  return {
    fromPaymentDate: start.toISOString().slice(0, 10),
    toPaymentDate: end.toISOString().slice(0, 10),
    limit: 500,
  };
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

export function searchParamsToReviewQuery(
  searchParams: DividendsSearchParamsRecord | URLSearchParams,
): DividendReviewQuery {
  const preset = (getValue(searchParams, "preset") ?? "currentYear") as DatePreset;
  const today = new Date();
  const resolved = resolvePresetDates(preset, today);

  const fromDate = getValue(searchParams, "fromPaymentDate") ?? resolved.from ?? "";
  const toDate = getValue(searchParams, "toPaymentDate") ?? resolved.to ?? "";
  const status = getValue(searchParams, "status") ?? "all";
  const sortBy = getValue(searchParams, "sortBy") ?? "paymentDate";
  const sortOrder = (getValue(searchParams, "sortOrder") ?? "desc") as "asc" | "desc";
  const page = parseInt(getValue(searchParams, "page") ?? "1", 10) || 1;
  const ticker = getValue(searchParams, "ticker");
  const accountId = getValue(searchParams, "accountId");

  let postingStatus: string | undefined;
  let reconciliationStatus: string | undefined;
  if (status === "needsReconciliation") {
    postingStatus = "posted";
    reconciliationStatus = "open";
  } else if (status !== "all") {
    reconciliationStatus = status;
  }

  return {
    fromPaymentDate: fromDate || undefined,
    toPaymentDate: toDate || undefined,
    ticker: ticker || undefined,
    accountId: accountId || undefined,
    ...(postingStatus ? { postingStatus } : {}),
    ...(reconciliationStatus ? { reconciliationStatus } : {}),
    sortBy,
    sortOrder,
    page,
    limit: 25,
  };
}
