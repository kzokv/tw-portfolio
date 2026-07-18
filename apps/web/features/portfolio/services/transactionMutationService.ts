import { getJson, patchJson, postJson } from "../../../lib/api";
import type {
  PreviewImpactResponse,
  DeleteTransactionResponse,
  PatchTransactionResponse,
  PatchFeeConfirmationResponse,
  PostedTransactionMutationConfirmRequestDto,
  PostedTransactionMutationDeleteItemDto,
  PostedTransactionMutationPreviewDto,
  PostedTransactionMutationPreviewQueryDto,
  PostedTransactionMutationRunDto,
  PostedTransactionMutationUpdateItemDto,
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

export async function previewPostedTransactionUpdateBatch(
  reason: string,
  items: readonly PostedTransactionMutationUpdateItemDto[],
): Promise<PostedTransactionMutationPreviewDto> {
  return postJson<PostedTransactionMutationPreviewDto>(
    "/portfolio/transactions/mutations/update-preview",
    { reason, items },
  );
}

export async function previewPostedTransactionDeleteBatch(
  reason: string,
  items: readonly PostedTransactionMutationDeleteItemDto[],
): Promise<PostedTransactionMutationPreviewDto> {
  return postJson<PostedTransactionMutationPreviewDto>(
    "/portfolio/transactions/mutations/delete-preview",
    { reason, items },
  );
}

export async function getPostedTransactionMutationPreview(
  previewId: string,
  query: PostedTransactionMutationPreviewQueryDto = {},
  contextOwnerId?: string | null,
): Promise<PostedTransactionMutationPreviewDto> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  if (query.accountId) params.set("accountId", query.accountId);
  if (query.ticker) params.set("ticker", query.ticker);
  if (query.marketCode) params.set("marketCode", query.marketCode);
  if (query.status) params.set("status", query.status);
  const search = params.toString();
  return getJson<PostedTransactionMutationPreviewDto>(
    `/portfolio/transactions/mutations/previews/${encodeURIComponent(previewId)}${search ? `?${search}` : ""}`,
    contextOwnerId
      ? { contextScope: "session", headers: { "x-context-user-id": contextOwnerId } }
      : undefined,
  );
}

export async function confirmPostedTransactionMutation(
  previewId: string,
  confirmation: Omit<PostedTransactionMutationConfirmRequestDto, "previewId">,
): Promise<PostedTransactionMutationRunDto> {
  return postJson<PostedTransactionMutationRunDto>(
    `/portfolio/transactions/mutations/previews/${encodeURIComponent(previewId)}/confirm`,
    confirmation,
  );
}

export async function getPostedTransactionMutationRun(
  runId: string,
  contextOwnerId?: string | null,
): Promise<PostedTransactionMutationRunDto> {
  return getJson<PostedTransactionMutationRunDto>(
    `/portfolio/transactions/mutations/runs/${encodeURIComponent(runId)}`,
    contextOwnerId
      ? { contextScope: "session", headers: { "x-context-user-id": contextOwnerId } }
      : undefined,
  );
}
