import { getJson, postJson } from "../../../lib/api";
import type { InstrumentCatalogItemDto, TransactionHistoryItemDto } from "@tw-portfolio/shared-types";
import type { TransactionInput } from "../../../components/portfolio/types";

export interface RecomputePreviewResponse {
  id: string;
  items: Array<{ tradeEventId: string }>;
}

export interface RecomputeConfirmResponse {
  status: string;
}

export interface TransactionInstrumentCatalogResponse {
  instruments: InstrumentCatalogItemDto[];
}

export async function submitTransaction(input: TransactionInput): Promise<void> {
  await postJson("/portfolio/transactions", {
    ...input,
    ticker: input.ticker.trim().toUpperCase(),
  }, {
    "idempotency-key": `web-${Date.now()}`,
  });
}

export async function fetchTransactionHistory(filters: {
  ticker?: string;
  accountId?: string;
  limit?: number;
}): Promise<TransactionHistoryItemDto[]> {
  const params = new URLSearchParams();

  if (filters.ticker?.trim()) {
    params.set("ticker", filters.ticker.trim().toUpperCase());
  }

  if (filters.accountId) {
    params.set("accountId", filters.accountId);
  }

  if (filters.limit) {
    params.set("limit", String(filters.limit));
  }

  const query = params.toString();
  return getJson<TransactionHistoryItemDto[]>(query ? `/portfolio/transactions?${query}` : "/portfolio/transactions");
}

export async function fetchTransactionInstrumentCatalog(): Promise<TransactionInstrumentCatalogResponse> {
  return getJson<TransactionInstrumentCatalogResponse>("/instruments");
}

export async function previewRecompute(): Promise<RecomputePreviewResponse> {
  return postJson<RecomputePreviewResponse>("/portfolio/recompute/preview", {
    useFallbackBindings: true,
  });
}

export async function confirmRecompute(jobId: string): Promise<RecomputeConfirmResponse> {
  return postJson<RecomputeConfirmResponse>("/portfolio/recompute/confirm", { jobId });
}
