import type { DividendDailyHighlightsDto, DividendLedgerAggregates, MarketCode } from "@vakwen/shared-types";
import { getJson, patchJson, postJson } from "../../../lib/api";
import type {
  DividendCalendarSnapshot,
  DividendEventListItem,
  DividendLedgerEntryDetails,
  DividendPostingPayload,
  DividendPostingResult,
  DividendReconciliationStatus,
} from "../types";

export interface DividendQuery {
  fromPaymentDate?: string;
  toPaymentDate?: string;
  accountId?: string;
  ticker?: string;
  limit?: number;
  marketCode?: MarketCode;
}

export interface DividendReviewQuery {
  fromPaymentDate?: string;
  toPaymentDate?: string;
  accountId?: string;
  ticker?: string;
  marketCode?: MarketCode;
  postingStatus?: string;
  reconciliationStatus?: string;
  excludeExpected?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}

interface DividendRequestOptions {
  signal?: AbortSignal;
}

export interface DividendLedgerReviewResponse {
  ledgerEntries: DividendLedgerEntryDetails[];
  reviewRows?: DividendLedgerEntryDetails[];
  total: number;
  aggregates: DividendLedgerAggregates;
}

function buildQuery(params: DividendQuery): string {
  const query = new URLSearchParams({
    limit: String(params.limit ?? 500),
  });

  if (params.fromPaymentDate) {
    query.set("fromPaymentDate", params.fromPaymentDate);
  }
  if (params.toPaymentDate) {
    query.set("toPaymentDate", params.toPaymentDate);
  }
  if (params.accountId) {
    query.set("accountId", params.accountId);
  }
  if (params.ticker) {
    query.set("ticker", params.ticker);
  }
  if (params.marketCode) {
    query.set("marketCode", params.marketCode);
  }

  return query.toString();
}

function buildReviewQuery(params: DividendReviewQuery): string {
  const query = new URLSearchParams();

  if (params.fromPaymentDate) query.set("fromPaymentDate", params.fromPaymentDate);
  if (params.toPaymentDate) query.set("toPaymentDate", params.toPaymentDate);
  if (params.accountId) query.set("accountId", params.accountId);
  if (params.ticker) query.set("ticker", params.ticker);
  if (params.marketCode) query.set("marketCode", params.marketCode);
  if (params.postingStatus) query.set("postingStatus", params.postingStatus);
  if (params.reconciliationStatus) query.set("reconciliationStatus", params.reconciliationStatus);
  if (params.excludeExpected) query.set("excludeExpected", "true");
  if (params.sortBy) query.set("sortBy", params.sortBy);
  if (params.sortOrder) query.set("sortOrder", params.sortOrder);
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));

  return query.toString();
}

function unwrapEvents(payload: unknown): DividendEventListItem[] {
  if (payload && typeof payload === "object" && "dividendEvents" in payload) {
    return ((payload as { dividendEvents?: DividendEventListItem[] }).dividendEvents ?? []);
  }

  if (payload && typeof payload === "object" && "events" in payload) {
    return ((payload as { events?: DividendEventListItem[] }).events ?? []);
  }

  return Array.isArray(payload) ? (payload as DividendEventListItem[]) : [];
}

function unwrapLedger(payload: unknown): DividendLedgerEntryDetails[] {
  if (payload && typeof payload === "object" && "ledgerEntries" in payload) {
    return ((payload as { ledgerEntries?: DividendLedgerEntryDetails[] }).ledgerEntries ?? []);
  }

  if (payload && typeof payload === "object" && "entries" in payload) {
    return ((payload as { entries?: DividendLedgerEntryDetails[] }).entries ?? []);
  }

  return Array.isArray(payload) ? (payload as DividendLedgerEntryDetails[]) : [];
}

export async function fetchDividendEvents(params: DividendQuery): Promise<DividendEventListItem[]> {
  const payload = await getJson<unknown>(`/dividend-events?${buildQuery(params)}`);
  return unwrapEvents(payload);
}

export async function fetchDividendLedger(params: DividendQuery): Promise<DividendLedgerEntryDetails[]> {
  const payload = await getJson<unknown>(`/portfolio/dividends/ledger?${buildQuery(params)}`);
  return unwrapLedger(payload);
}

export async function fetchDividendCalendarSnapshot(
  params: DividendQuery,
  options: DividendRequestOptions = {},
): Promise<DividendCalendarSnapshot> {
  const payload = await getJson<unknown>(`/portfolio/dividends/calendar?${buildQuery(params)}`, { signal: options.signal });
  const events = unwrapEvents(payload);
  const ledgerEntries = unwrapLedger(payload);

  return { events, ledgerEntries };
}

export async function fetchDividendDailyHighlights(
  options: DividendRequestOptions = {},
): Promise<DividendDailyHighlightsDto> {
  const payload = await getJson<DividendDailyHighlightsDto>("/portfolio/dividends/daily-highlights", { signal: options.signal });
  return {
    payingToday: payload.payingToday ?? [],
    exDividendToday: payload.exDividendToday ?? [],
  };
}

export async function submitDividendPosting(payload: DividendPostingPayload): Promise<DividendPostingResult> {
  return postJson<DividendPostingResult>(
    "/portfolio/dividends/postings",
    payload,
    { "idempotency-key": `dividend-${payload.dividendLedgerEntryId ?? payload.dividendEventId}-${Date.now()}` },
  );
}

export async function fetchDividendLedgerReview(params: DividendReviewQuery): Promise<DividendLedgerReviewResponse> {
  const payload = await getJson<DividendLedgerReviewResponse>(`/portfolio/dividends/review?${buildReviewQuery(params)}`);
  const ledgerEntries = payload.reviewRows ?? payload.ledgerEntries ?? [];
  return {
    ledgerEntries,
    total: payload.total ?? 0,
    aggregates: payload.aggregates ?? {
      totalExpectedCashAmount: {},
      totalReceivedCashAmount: {},
      openCount: 0,
      byMonth: {},
      byTicker: {},
    },
  };
}

export async function fetchDividendLedgerEntry(dividendLedgerEntryId: string): Promise<DividendLedgerEntryDetails> {
  return getJson<DividendLedgerEntryDetails>(
    `/portfolio/dividends/postings/${encodeURIComponent(dividendLedgerEntryId)}`,
  );
}

export async function fetchDividendLedgerYears(): Promise<number[]> {
  const payload = await getJson<{ years: number[] }>("/portfolio/dividends/ledger/years");
  return payload.years ?? [];
}

export async function updateDividendReconciliation(
  dividendLedgerEntryId: string,
  status: DividendReconciliationStatus,
  note?: string,
): Promise<DividendLedgerEntryDetails> {
  const response = await patchJson<DividendLedgerEntryDetails | { ledgerEntry: DividendLedgerEntryDetails }>(
    `/portfolio/dividends/postings/${encodeURIComponent(dividendLedgerEntryId)}/reconciliation`,
    { status, note },
  );

  if (response && typeof response === "object" && "ledgerEntry" in response) {
    return response.ledgerEntry;
  }

  return response;
}
