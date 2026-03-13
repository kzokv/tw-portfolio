import { getJson, postJson } from "../../../lib/api";
import type { TransactionHistoryItemDto } from "@tw-portfolio/shared-types";
import type { TransactionInput } from "../../../components/portfolio/types";

export interface RecomputePreviewResponse {
  id: string;
  items: Array<{ tradeEventId: string }>;
}

export interface RecomputeConfirmResponse {
  status: string;
}

export async function submitTransaction(input: TransactionInput): Promise<void> {
  await postJson("/portfolio/transactions", {
    ...input,
    symbol: input.symbol.trim().toUpperCase(),
  }, {
    "idempotency-key": `web-${Date.now()}`,
  });
}

export async function fetchTransactionHistory(filters: {
  symbol?: string;
  accountId?: string;
  limit?: number;
}): Promise<TransactionHistoryItemDto[]> {
  const params = new URLSearchParams();

  if (filters.symbol?.trim()) {
    params.set("symbol", filters.symbol.trim().toUpperCase());
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

export async function previewRecompute(): Promise<RecomputePreviewResponse> {
  return postJson<RecomputePreviewResponse>("/portfolio/recompute/preview", {
    useFallbackBindings: true,
  });
}

export async function confirmRecompute(jobId: string): Promise<RecomputeConfirmResponse> {
  return postJson<RecomputeConfirmResponse>("/portfolio/recompute/confirm", { jobId });
}
