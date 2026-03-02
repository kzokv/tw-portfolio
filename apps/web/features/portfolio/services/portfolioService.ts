import { postJson } from "../../../lib/api";
import type { TransactionInput } from "../../../components/portfolio/types";

export interface RecomputePreviewResponse {
  id: string;
  items: Array<{ transactionId: string }>;
}

export interface RecomputeConfirmResponse {
  status: string;
}

export async function submitTransaction(input: TransactionInput): Promise<void> {
  await postJson("/portfolio/transactions", input, {
    "idempotency-key": `web-${Date.now()}`,
  });
}

export async function previewRecompute(): Promise<RecomputePreviewResponse> {
  return postJson<RecomputePreviewResponse>("/portfolio/recompute/preview", {
    useFallbackBindings: true,
  });
}

export async function confirmRecompute(jobId: string): Promise<RecomputeConfirmResponse> {
  return postJson<RecomputeConfirmResponse>("/portfolio/recompute/confirm", { jobId });
}
