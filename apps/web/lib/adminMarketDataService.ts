import type {
  AdminInstrumentSupportState,
  AdminMarketCode,
  AdminMarketDataActionExecuteRequest,
  AdminMarketDataActionExecuteResponse,
  AdminMarketDataBackfillExecuteRequest,
  AdminMarketDataBackfillExecuteResponse,
  AdminMarketDataDelistingOverrideAction,
  AdminMarketDataDelistingOverrideRequest,
  AdminMarketDataDelistingOverrideResponse,
  AdminMarketDataBackfillPreviewRequest,
  AdminMarketDataBackfillPreviewResponse,
  AdminMarketDataPurgeExecuteRequest,
  AdminMarketDataPurgeExecuteResponse,
  AdminMarketDataPurgePreviewRequest,
  AdminMarketDataPurgePreviewResponse,
  AdminMarketDataSupportStateRequest,
  AdminMarketDataSupportStateResponse,
  ProviderFixerDashboardOperationDto,
  ProviderResolutionMappingDto,
  ProviderUnresolvedItemDto,
  ProviderUnresolvedItemState,
} from "@vakwen/shared-types";
import { postJson } from "./api";

export function executeMarketAction(
  marketCode: AdminMarketCode,
  input: AdminMarketDataActionExecuteRequest,
): Promise<AdminMarketDataActionExecuteResponse> {
  return postJson(`/admin/market-data/${encodeURIComponent(marketCode)}/actions/execute`, input);
}

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

export function updateMarketInstrumentDelistingOverride(input: {
  ticker: string;
  marketCode: Exclude<AdminMarketCode, "FX">;
  action: AdminMarketDataDelistingOverrideAction;
}): Promise<AdminMarketDataDelistingOverrideResponse> {
  const body: AdminMarketDataDelistingOverrideRequest = input;
  return postJson(
    `/admin/market-data/${encodeURIComponent(input.marketCode)}/instruments/delisting-override`,
    body,
  );
}

export function updateProviderUnresolvedState(input: {
  providerId: string;
  marketCode: ProviderUnresolvedItemDto["marketCode"];
  errorCode: string;
  sourceSymbol: string;
  state: Exclude<ProviderUnresolvedItemState, "resolved">;
  reason?: string;
}): Promise<{ item: ProviderUnresolvedItemDto }> {
  const { providerId, ...body } = input;
  return postJson(`/admin/providers/${encodeURIComponent(providerId)}/unresolved/state`, body);
}

export function bulkUpdateProviderUnresolvedState(input: {
  providerId: string;
  state: "unsupported" | "ignored";
  scope:
    | {
        type: "selected_items";
        items: Array<Pick<ProviderUnresolvedItemDto, "providerId" | "marketCode" | "errorCode" | "sourceSymbol">>;
      }
    | {
        type: "filter";
        marketCode: ProviderUnresolvedItemDto["marketCode"];
        errorCode: string;
        state: "active";
        search?: string;
      };
  acknowledged?: boolean;
  typedConfirmation?: string;
  reason?: string;
}): Promise<{ operation: ProviderFixerDashboardOperationDto; updatedCount: number }> {
  const { providerId, ...body } = input;
  return postJson(`/admin/providers/${encodeURIComponent(providerId)}/unresolved/state/bulk`, body);
}

export function previewProviderRepair(input: {
  providerId: string;
  marketCode: ProviderUnresolvedItemDto["marketCode"];
  errorCode: string;
  resolverMode: "quote_first" | "chart_probe_v1";
  resolverModeRiskAccepted?: boolean;
  scope:
    | {
        type: "selected_items";
        items: Array<Pick<ProviderUnresolvedItemDto, "providerId" | "marketCode" | "errorCode" | "sourceSymbol">>;
      }
    | {
        type: "filter";
        marketCode: ProviderUnresolvedItemDto["marketCode"];
        errorCode: string;
        state: "active";
        search?: string;
      };
}): Promise<{ operation: ProviderFixerDashboardOperationDto }> {
  const { providerId, ...body } = input;
  return postJson(`/admin/providers/${encodeURIComponent(providerId)}/operations/preview`, body);
}

export function renewProviderEvidence(input: {
  providerId: string;
  marketCode: ProviderUnresolvedItemDto["marketCode"];
  errorCode: string;
  resolverMode: "quote_first" | "chart_probe_v1";
  scope:
    | {
        type: "selected_items";
        items: Array<Pick<ProviderUnresolvedItemDto, "providerId" | "marketCode" | "errorCode" | "sourceSymbol">>;
      }
    | {
        type: "filter";
        marketCode: ProviderUnresolvedItemDto["marketCode"];
        errorCode: string;
        state: "active";
        search?: string;
      };
}): Promise<{ operation: ProviderFixerDashboardOperationDto }> {
  const { providerId, ...body } = input;
  return postJson(`/admin/providers/${encodeURIComponent(providerId)}/operations/renew`, body);
}

export function executeProviderRepair(input: {
  providerId: string;
  operationId: string;
  previewToken: string;
  typedConfirmation?: string;
  acknowledged?: boolean;
}): Promise<{ operation: ProviderFixerDashboardOperationDto }> {
  const { providerId, operationId, ...body } = input;
  return postJson(
    `/admin/providers/${encodeURIComponent(providerId)}/operations/${encodeURIComponent(operationId)}/execute`,
    body,
  );
}

export function reverifyProviderMapping(input: {
  providerId: string;
  mapping: Pick<ProviderResolutionMappingDto, "marketCode" | "sourceSymbol" | "resolvedSymbol">;
  resolverMode: "quote_first" | "chart_probe_v1";
}): Promise<{ operation: ProviderFixerDashboardOperationDto }> {
  return postJson(`/admin/providers/${encodeURIComponent(input.providerId)}/mappings/reverify`, {
    marketCode: input.mapping.marketCode,
    sourceSymbol: input.mapping.sourceSymbol,
    resolvedSymbol: input.mapping.resolvedSymbol,
    resolverMode: input.resolverMode,
  });
}

export function rerunProviderMapping(input: {
  providerId: string;
  mapping: Pick<ProviderResolutionMappingDto, "marketCode" | "sourceSymbol" | "resolvedSymbol">;
  resolverMode: "quote_first" | "chart_probe_v1";
}): Promise<{ operation: ProviderFixerDashboardOperationDto }> {
  return postJson(`/admin/providers/${encodeURIComponent(input.providerId)}/mappings/rerun`, {
    marketCode: input.mapping.marketCode,
    sourceSymbol: input.mapping.sourceSymbol,
    resolverMode: input.resolverMode,
    acknowledged: true,
  });
}

export function revertProviderMapping(input: {
  providerId: string;
  mapping: Pick<ProviderResolutionMappingDto, "marketCode" | "sourceSymbol" | "resolvedSymbol">;
  typedConfirmation: string;
}): Promise<{ operation: ProviderFixerDashboardOperationDto }> {
  return postJson(`/admin/providers/${encodeURIComponent(input.providerId)}/mappings/revert`, {
    marketCode: input.mapping.marketCode,
    sourceSymbol: input.mapping.sourceSymbol,
    resolvedSymbol: input.mapping.resolvedSymbol,
    typedConfirmation: input.typedConfirmation,
  });
}
