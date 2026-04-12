import type { DividendLedgerAggregates } from "@tw-portfolio/shared-types";
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
  limit?: number;
}

export interface DividendReviewQuery {
  fromPaymentDate?: string;
  toPaymentDate?: string;
  accountId?: string;
  ticker?: string;
  postingStatus?: string;
  reconciliationStatus?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface DividendLedgerReviewResponse {
  ledgerEntries: DividendLedgerEntryDetails[];
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

  return query.toString();
}

function buildReviewQuery(params: DividendReviewQuery): string {
  const query = new URLSearchParams();

  if (params.fromPaymentDate) query.set("fromPaymentDate", params.fromPaymentDate);
  if (params.toPaymentDate) query.set("toPaymentDate", params.toPaymentDate);
  if (params.accountId) query.set("accountId", params.accountId);
  if (params.ticker) query.set("ticker", params.ticker);
  if (params.postingStatus) query.set("postingStatus", params.postingStatus);
  if (params.reconciliationStatus) query.set("reconciliationStatus", params.reconciliationStatus);
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

export async function fetchDividendCalendarSnapshot(params: DividendQuery): Promise<DividendCalendarSnapshot> {
  const [events, ledgerEntries] = await Promise.all([
    fetchDividendEvents(params),
    fetchDividendLedger(params),
  ]);

  return { events, ledgerEntries };
}

export async function submitDividendPosting(payload: DividendPostingPayload): Promise<DividendPostingResult> {
  return postJson<DividendPostingResult>(
    "/portfolio/dividends/postings",
    payload,
    { "idempotency-key": `dividend-${payload.dividendLedgerEntryId ?? payload.dividendEventId}-${Date.now()}` },
  );
}

export async function fetchDividendLedgerReview(params: DividendReviewQuery): Promise<DividendLedgerReviewResponse> {
  const payload = await getJson<DividendLedgerReviewResponse>(`/portfolio/dividends/ledger?${buildReviewQuery(params)}`);
  return {
    ledgerEntries: payload.ledgerEntries ?? [],
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
