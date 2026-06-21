"use client";

import { MARKET_CODES, type MarketCode } from "@vakwen/shared-types";

export const TRANSACTION_HISTORY_TYPE_VALUES = ["ALL", "BUY", "SELL"] as const;
export const TRANSACTION_HISTORY_PNL_VALUES = ["any", "realized"] as const;
export const TRANSACTION_HISTORY_LIMIT_VALUES = [25, 50, 100] as const;
export const TRANSACTION_HISTORY_SORT_BY_VALUES = ["tradeDate", "type", "ticker", "account", "realizedPnl"] as const;
export const TRANSACTION_HISTORY_SORT_ORDER_VALUES = ["asc", "desc"] as const;

export type TransactionHistoryTypeFilter = (typeof TRANSACTION_HISTORY_TYPE_VALUES)[number];
export type TransactionHistoryPnlFilter = (typeof TRANSACTION_HISTORY_PNL_VALUES)[number];
export type TransactionHistoryMarketFilter = MarketCode | "ALL";
export type TransactionHistorySortBy = (typeof TRANSACTION_HISTORY_SORT_BY_VALUES)[number];
export type TransactionHistorySortOrder = (typeof TRANSACTION_HISTORY_SORT_ORDER_VALUES)[number];

export interface TransactionHistoryRouteState {
  type: TransactionHistoryTypeFilter;
  pnl: TransactionHistoryPnlFilter;
  marketCode: TransactionHistoryMarketFilter;
  accountId: string | "ALL";
  ticker: string;
  from: string;
  to: string;
  limit: (typeof TRANSACTION_HISTORY_LIMIT_VALUES)[number];
  offset: number;
  sortBy: TransactionHistorySortBy;
  sortOrder: TransactionHistorySortOrder;
  returnTo: string | null;
}

export const DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE: TransactionHistoryRouteState = {
  type: "ALL",
  pnl: "any",
  marketCode: "ALL",
  accountId: "ALL",
  ticker: "",
  from: "",
  to: "",
  limit: 50,
  offset: 0,
  sortBy: "tradeDate",
  sortOrder: "desc",
  returnTo: null,
};

const TRANSACTION_HISTORY_QUERY_KEYS = [
  "type",
  "pnl",
  "marketCode",
  "accountId",
  "ticker",
  "from",
  "to",
  "limit",
  "offset",
  "sortBy",
  "sortOrder",
  "returnTo",
] as const;

type QueryKey = (typeof TRANSACTION_HISTORY_QUERY_KEYS)[number];

export function parseTransactionHistoryRouteState(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): TransactionHistoryRouteState {
  const read = (key: QueryKey): string | undefined => {
    if (input instanceof URLSearchParams) return input.get(key) ?? undefined;
    const value = input[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return normalizeTransactionHistoryRouteState({
    type: normalizeValue(read("type"), TRANSACTION_HISTORY_TYPE_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.type),
    pnl: normalizeValue(read("pnl"), TRANSACTION_HISTORY_PNL_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.pnl),
    marketCode: normalizeValue(
      read("marketCode"),
      ["ALL", ...MARKET_CODES] as const,
      DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.marketCode,
    ),
    accountId: normalizeAccountId(read("accountId")),
    ticker: normalizeTicker(read("ticker")),
    from: normalizeDate(read("from")),
    to: normalizeDate(read("to")),
    limit: normalizeNumberOption(read("limit"), TRANSACTION_HISTORY_LIMIT_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.limit),
    offset: normalizeOffset(read("offset")),
    sortBy: normalizeValue(read("sortBy"), TRANSACTION_HISTORY_SORT_BY_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.sortBy),
    sortOrder: normalizeValue(read("sortOrder"), TRANSACTION_HISTORY_SORT_ORDER_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.sortOrder),
    returnTo: normalizeReturnTo(read("returnTo")),
  });
}

export function normalizeTransactionHistoryRouteState(
  state: TransactionHistoryRouteState,
): TransactionHistoryRouteState {
  const normalizedTicker = normalizeTicker(state.ticker);
  const normalizedFrom = normalizeDate(state.from);
  const normalizedTo = normalizeDate(state.to);
  const normalized = {
    ...state,
    accountId: normalizeAccountId(state.accountId),
    from: normalizedFrom,
    limit: normalizeNumberOption(state.limit, TRANSACTION_HISTORY_LIMIT_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.limit),
    marketCode: normalizeValue(state.marketCode, ["ALL", ...MARKET_CODES] as const, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.marketCode),
    offset: Math.max(0, Math.trunc(state.offset)),
    pnl: normalizeValue(state.pnl, TRANSACTION_HISTORY_PNL_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.pnl),
    returnTo: normalizeReturnTo(state.returnTo),
    sortBy: normalizeValue(state.sortBy, TRANSACTION_HISTORY_SORT_BY_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.sortBy),
    sortOrder: normalizeValue(state.sortOrder, TRANSACTION_HISTORY_SORT_ORDER_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.sortOrder),
    ticker: normalizedTicker,
    to: normalizedTo,
    type: normalizeValue(state.type, TRANSACTION_HISTORY_TYPE_VALUES, DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.type),
  } satisfies TransactionHistoryRouteState;

  if (normalized.pnl === "realized" && normalized.type !== "SELL") {
    normalized.type = "SELL";
  }

  return normalized;
}

export function transactionHistoryRouteStateToSearchParams(
  state: TransactionHistoryRouteState,
): URLSearchParams {
  const normalized = normalizeTransactionHistoryRouteState(state);
  const params = new URLSearchParams();

  if (normalized.type !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.type) {
    params.set("type", normalized.type);
  }
  if (normalized.pnl !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.pnl) {
    params.set("pnl", normalized.pnl);
  }
  if (normalized.marketCode !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.marketCode) {
    params.set("marketCode", normalized.marketCode);
  }
  if (normalized.accountId !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.accountId) {
    params.set("accountId", normalized.accountId);
  }
  if (normalized.ticker) {
    params.set("ticker", normalized.ticker);
  }
  if (normalized.from) {
    params.set("from", normalized.from);
  }
  if (normalized.to) {
    params.set("to", normalized.to);
  }
  if (normalized.limit !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.limit) {
    params.set("limit", String(normalized.limit));
  }
  if (normalized.offset !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.offset) {
    params.set("offset", String(normalized.offset));
  }
  if (normalized.sortBy !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.sortBy) {
    params.set("sortBy", normalized.sortBy);
  }
  if (normalized.sortOrder !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.sortOrder) {
    params.set("sortOrder", normalized.sortOrder);
  }
  if (normalized.returnTo) {
    params.set("returnTo", normalized.returnTo);
  }

  return params;
}

export function mergeTransactionHistoryRouteStateIntoSearchParams(
  searchParams: URLSearchParams,
  state: TransactionHistoryRouteState,
): URLSearchParams {
  const next = new URLSearchParams(searchParams.toString());
  for (const key of TRANSACTION_HISTORY_QUERY_KEYS) {
    next.delete(key);
  }
  const historyParams = transactionHistoryRouteStateToSearchParams(state);
  historyParams.forEach((value, key) => next.set(key, value));
  return next;
}

export function transactionHistoryRouteStatesEqual(
  left: TransactionHistoryRouteState,
  right: TransactionHistoryRouteState,
): boolean {
  return transactionHistoryRouteStateToSearchParams(left).toString()
    === transactionHistoryRouteStateToSearchParams(right).toString();
}

function normalizeTicker(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function normalizeDate(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function normalizeAccountId(value: string | null | undefined): string | "ALL" {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : "ALL";
}

function normalizeReturnTo(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed && isValidReturnTo(trimmed) ? trimmed : null;
}

function isValidReturnTo(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  try {
    const url = new URL(path, "http://n");
    return url.host === "n";
  } catch {
    return false;
  }
}

function normalizeOffset(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.offset;
  }
  return parsed;
}

function normalizeNumberOption<const T extends readonly number[]>(
  value: string | number | null | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (allowed.includes(parsed as T[number])) {
    return parsed as T[number];
  }
  return fallback;
}

function normalizeValue<const T extends readonly string[]>(
  value: string | null | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  const trimmed = value?.trim();
  if (trimmed && allowed.includes(trimmed as T[number])) {
    return trimmed as T[number];
  }
  return fallback;
}
