import { getJson, patchJson, postJson } from "../../../lib/api";
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
  confirmation: DividendDeleteConfirmation,
): Promise<DeleteTransactionResponse> {
  return postJson<DeleteTransactionResponse>(
    `/portfolio/transactions/${tradeEventId}/dividend-delete-confirm`,
    confirmation,
  );
}

export interface DividendDeleteConfirmation {
  previewId: string;
  previewVersion: number;
  fingerprint: string;
}

export interface DividendDeletePreviewResponse {
  preview: DividendDeleteConfirmation & {
    accountId: string;
    targetTradeEventId: string | null;
    expiresAt: string;
  };
  affectedCounts: {
    dividendLedgerEntries: number;
    cashLedgerEntries: number;
    dividendDeductionEntries: number;
    dividendSourceLines: number;
    stockDividendPositionActions: number;
  };
  affectedDividends: Array<{
    dividendLedgerEntryId: string;
    requiresManualReceiptReentry: boolean;
  }>;
  manualReceiptReentryLedgerEntryIds: string[];
}

export async function previewDividendDelete(
  tradeEventId: string,
): Promise<DividendDeletePreviewResponse> {
  return postJson<DividendDeletePreviewResponse>(
    `/portfolio/transactions/${tradeEventId}/dividend-delete-preview`,
    { reason: "User requested transaction deletion" },
  );
}

export async function patchTransaction(
  tradeEventId: string,
  patch: Record<string, unknown>,
): Promise<PatchTransactionResponse | PatchFeeConfirmationResponse> {
  return patchJson(`/portfolio/transactions/${tradeEventId}`, patch);
}
