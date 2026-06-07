import type {
  AdminInstrumentSupportState,
  AdminMarketCode,
  AdminMarketDataBackfillExecuteRequest,
  AdminMarketDataBackfillExecuteResponse,
  AdminMarketDataBackfillPreviewRequest,
  AdminMarketDataBackfillPreviewResponse,
  AdminMarketDataPurgeExecuteRequest,
  AdminMarketDataPurgeExecuteResponse,
  AdminMarketDataPurgePreviewRequest,
  AdminMarketDataPurgePreviewResponse,
  AdminMarketDataSupportStateRequest,
  AdminMarketDataSupportStateResponse,
} from "@vakwen/shared-types";
import { postJson } from "./api";

export function previewMarketBackfill(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: AdminMarketDataBackfillPreviewRequest,
): Promise<AdminMarketDataBackfillPreviewResponse> {
  return postJson(`/admin/market-data/${encodeURIComponent(marketCode)}/backfill/preview`, input);
}

export function executeMarketBackfill(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: AdminMarketDataBackfillExecuteRequest,
): Promise<AdminMarketDataBackfillExecuteResponse> {
  return postJson(`/admin/market-data/${encodeURIComponent(marketCode)}/backfill/execute`, input);
}

export function previewMarketPurge(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: AdminMarketDataPurgePreviewRequest,
): Promise<AdminMarketDataPurgePreviewResponse> {
  return postJson(`/admin/market-data/${encodeURIComponent(marketCode)}/purge/preview`, input);
}

export function executeMarketPurge(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: AdminMarketDataPurgeExecuteRequest,
): Promise<AdminMarketDataPurgeExecuteResponse> {
  return postJson(`/admin/market-data/${encodeURIComponent(marketCode)}/purge/execute`, input);
}

export function updateMarketInstrumentSupportState(input: {
  ticker: string;
  marketCode: Exclude<AdminMarketCode, "FX">;
  supportState: AdminInstrumentSupportState;
}): Promise<AdminMarketDataSupportStateResponse> {
  const body: AdminMarketDataSupportStateRequest = input;
  return postJson(
    `/admin/market-data/${encodeURIComponent(input.marketCode)}/instruments/support-state`,
    body,
  );
}
