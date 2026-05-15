import { deleteJson, getJson, patchJson } from "../../../lib/api";
import type {
  PreviewImpactResponse,
  DeleteTransactionResponse,
  PatchTransactionResponse,
  PatchFeeConfirmationResponse,
} from "@vakwen/shared-types";

export async function previewImpact(
  tradeEventId: string,
  action: "delete" | "patch",
  params?: { quantity?: number; price?: number; side?: string; date?: string },
): Promise<PreviewImpactResponse> {
  const qs = new URLSearchParams({ action });
  if (params?.quantity !== undefined) qs.set("quantity", String(params.quantity));
  if (params?.price !== undefined) qs.set("price", String(params.price));
  if (params?.side) qs.set("side", params.side);
  if (params?.date) qs.set("date", params.date);
  return getJson<PreviewImpactResponse>(
    `/portfolio/transactions/${tradeEventId}/preview-impact?${qs}`,
  );
}

export async function deleteTransaction(
  tradeEventId: string,
): Promise<DeleteTransactionResponse> {
  return deleteJson<DeleteTransactionResponse>(
    `/portfolio/transactions/${tradeEventId}`,
  );
}

export async function patchTransaction(
  tradeEventId: string,
  patch: Record<string, unknown>,
): Promise<PatchTransactionResponse | PatchFeeConfirmationResponse> {
  return patchJson(`/portfolio/transactions/${tradeEventId}`, patch);
}
