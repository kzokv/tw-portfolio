import { patchJson, postJson } from "../../../lib/api";

export interface FxTransferInput {
  fromAccountId: string;
  toAccountId: string;
  fromAmount: number;
  toAmount: number;
  effectiveRate: number;
  entryDate: string;
  notes?: string;
}

export interface FxTransferPatch {
  fromAmount?: number;
  toAmount?: number;
  effectiveRate?: number;
  entryDate?: string;
  notes?: string | null;
}

export interface FxTransferEstimate {
  realizedFxImpactUsd: number;
  midRate: number | null;
  midRateAvailable: boolean;
  midRateProvider: string | null;
  tolerancePct: number | null;
  toleranceState: "safe" | "warn" | "block";
  fromAccountAvailableBalance: number;
  insufficientBalance: boolean;
}

export interface FxTransferCreateResponse {
  fxTransferId: string;
  legOutId: string;
  legInId: string;
}

export interface FxTransferUpdateResponse {
  fxTransferId: string;
  legOutId: string;
  legInId: string;
}

export interface FxTransferReverseResponse {
  reversalLegOutId: string;
  reversalLegInId: string;
  fxTransferIdReversed: string;
}

export async function estimateFxTransfer(input: FxTransferInput, signal?: AbortSignal): Promise<FxTransferEstimate> {
  return postJson<FxTransferEstimate>("/fx-transfers/estimate", input, undefined, { signal });
}

export async function createFxTransfer(input: FxTransferInput): Promise<FxTransferCreateResponse> {
  return postJson<FxTransferCreateResponse>("/fx-transfers", input);
}

export async function updateFxTransfer(
  fxTransferId: string,
  patch: FxTransferPatch,
): Promise<FxTransferUpdateResponse> {
  return patchJson<FxTransferUpdateResponse>(`/fx-transfers/${encodeURIComponent(fxTransferId)}`, patch);
}

export async function reverseFxTransfer(
  fxTransferId: string,
  reason?: string,
): Promise<FxTransferReverseResponse> {
  return postJson<FxTransferReverseResponse>(
    `/fx-transfers/${encodeURIComponent(fxTransferId)}/reverse`,
    { reason },
  );
}
