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
  fromPaymentDate: string;
  toPaymentDate: string;
  accountId?: string;
  limit?: number;
}

function buildQuery(params: DividendQuery): string {
  const query = new URLSearchParams({
    fromPaymentDate: params.fromPaymentDate,
    toPaymentDate: params.toPaymentDate,
    limit: String(params.limit ?? 500),
  });

  if (params.accountId) {
    query.set("accountId", params.accountId);
  }

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
