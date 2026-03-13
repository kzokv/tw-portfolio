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
  symbol: string;
  accountId?: string;
}): Promise<TransactionHistoryItemDto[]> {
  const params = new URLSearchParams({
    symbol: filters.symbol.trim().toUpperCase(),
  });

  if (filters.accountId) {
    params.set("accountId", filters.accountId);
  }

  return getJson<TransactionHistoryItemDto[]>(`/portfolio/transactions?${params.toString()}`);
}

export async function previewRecompute(): Promise<RecomputePreviewResponse> {
  return postJson<RecomputePreviewResponse>("/portfolio/recompute/preview", {
    useFallbackBindings: true,
  });
}

export async function confirmRecompute(jobId: string): Promise<RecomputeConfirmResponse> {
  return postJson<RecomputeConfirmResponse>("/portfolio/recompute/confirm", { jobId });
}
