import type {
  AdminInstrumentSupportState,
  AdminMarketCode,
  AdminMarketDataOperationLogsResponse,
  AdminMarketDataActionExecuteRequest,
  AdminMarketDataActionExecuteResponse,
  AdminMarketDataBackfillExecuteRequest,
  AdminMarketDataBackfillExecuteResponse,
  AdminMarketDataSnapshotRepairExecuteRequest,
  AdminMarketDataSnapshotRepairExecuteResponse,
  AdminMarketDataDelistingOverrideAction,
  AdminMarketDataDelistingOverrideRequest,
  AdminMarketDataDelistingOverrideResponse,
  QuoteFallbackPolicyRefreshResponse,
  QuoteFallbackPolicyResponse,
  QuoteFallbackPolicyUpsertRequest,
  AdminMarketDataBackfillPreviewRequest,
  AdminMarketDataBackfillPreviewResponse,
  AdminMarketDataValuationRepairStatusResponse,
  AdminMarketDataPurgeExecuteRequest,
  AdminMarketDataPurgeExecuteResponse,
  AdminMarketDataPurgePreviewRequest,
  AdminMarketDataPurgePreviewResponse,
  AdminMarketCalendarConfirmResponse,
  AdminMarketCalendarPreviewResponse,
  AdminMarketCalendarSourceConfigDto,
  AdminMarketDataSupportStateRequest,
  AdminMarketDataSupportStateResponse,
  ProviderFixerDashboardLogsResponse,
  ProviderFixerDashboardOperationDto,
  ProviderOperationOutcomesResponse,
  ProviderResolutionMappingDto,
  ProviderUnresolvedItemDto,
  ProviderUnresolvedItemState,
} from "@vakwen/shared-types";
import { ApiError, getJson, patchJson, postJson } from "./api";
import type {
  AdminMarketDataActivityResponse,
  AdminMarketDataActivityQuery,
  AdminMarketDataCalendarResponse,
  AdminMarketDataUnresolvedQuery,
  AdminMarketDataUnresolvedResponse,
  MarketCalendarConfirmRequest,
  MarketCalendarConfirmResponse,
  MarketCalendarInvalidateRequest,
  MarketCalendarInvalidateResponse,
  MarketCalendarPreviewRequest,
  MarketCalendarPreviewResponse,
  MarketCalendarSourceConfigUpdateRequest,
  MarketCalendarSourceUpdateRequest,
} from "./adminMarketDataContracts";

export type { AdminMarketDataOperationLogsResponse };

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

export function executeMarketSnapshotRepair(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: AdminMarketDataSnapshotRepairExecuteRequest,
): Promise<AdminMarketDataSnapshotRepairExecuteResponse> {
  return postJson(`/admin/market-data/${encodeURIComponent(marketCode)}/snapshot-repair/execute`, input);
}

export function fetchMarketValuationRepairStatus(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: { tickers: string[]; targetDate: string; operationId?: string },
): Promise<AdminMarketDataValuationRepairStatusResponse> {
  const params = new URLSearchParams();
  params.set("tickers", input.tickers.join(","));
  params.set("targetDate", input.targetDate);
  if (input.operationId) params.set("operationId", input.operationId);
  return getJson(`/admin/market-data/${encodeURIComponent(marketCode)}/valuation-repair/status?${params.toString()}`);
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

export function fetchMarketActivity(
  marketCode: AdminMarketCode,
  query: Partial<AdminMarketDataActivityQuery>,
): Promise<AdminMarketDataActivityResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return getJson(`/admin/market-data/${encodeURIComponent(marketCode)}/activity${suffix}`);
}

export function fetchMarketUnresolved(
  marketCode: Exclude<AdminMarketCode, "FX">,
  query: Partial<AdminMarketDataUnresolvedQuery>,
): Promise<AdminMarketDataUnresolvedResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return getJson(`/admin/market-data/${encodeURIComponent(marketCode)}/unresolved${suffix}`);
}

export function updateMarketUnresolvedState(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: {
    providerId: string;
    errorCode: string;
    sourceSymbol: string;
    state: "active" | "ignored" | "unsupported";
    reason?: string;
  },
): Promise<{ item: AdminMarketDataUnresolvedResponse["items"][number] }> {
  return postJson(`/admin/market-data/${encodeURIComponent(marketCode)}/unresolved/state`, input);
}

export function bulkUpdateMarketUnresolvedState(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: {
    state: "active" | "ignored" | "unsupported";
    scope:
      | {
          type: "selected_items";
          items: Array<{
            providerId: string;
            marketCode: Exclude<AdminMarketCode, "FX">;
            errorCode: string;
            sourceSymbol: string;
          }>;
        }
      | {
          type: "filter";
          filter?: {
            providerId?: string;
            state?: AdminMarketDataUnresolvedQuery["state"];
            errorCode?: string;
            search?: string;
          };
        };
    acknowledged?: boolean;
    typedConfirmation?: string;
    reason?: string;
  },
): Promise<{ updatedCount: number }> {
  return postJson(`/admin/market-data/${encodeURIComponent(marketCode)}/unresolved/state/bulk`, input);
}

export function fetchMarketCalendar(
  marketCode: Exclude<AdminMarketCode, "FX">,
): Promise<AdminMarketDataCalendarResponse> {
  return getJson(`/admin/market-data/${encodeURIComponent(marketCode)}/calendar`);
}

export function updateMarketCalendarSource(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: MarketCalendarSourceUpdateRequest,
): Promise<AdminMarketDataCalendarResponse> {
  return postJson(`/admin/market-data/${encodeURIComponent(marketCode)}/calendar/source`, input);
}

export function previewMarketCalendarImport(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: Omit<MarketCalendarPreviewRequest, "marketCode">,
): Promise<MarketCalendarPreviewResponse> {
  return postJson<AdminMarketCalendarPreviewResponse>(
    `/admin/market-data/${encodeURIComponent(marketCode)}/calendar/preview`,
    input,
  ).then((response) => {
    const addedDates = response.diff.addedExceptions;
    const changedDates = response.diff.changedExceptions;
    const removedDates = response.diff.removedExceptions;
    return {
      marketCode: response.marketCode,
      preview: {
        added: addedDates.length,
        changed: changedDates.length,
        removed: removedDates.length,
        previewToken: response.previewToken,
        warnings: response.warnings,
        confirmable: true,
        replaceConfirmedRequired: response.replaceConfirmedRequired,
        rows: [
          ...addedDates.map((date: string) => ({ date, session: "added", evidence: response.source?.label ?? null })),
          ...changedDates.map((date: string) => ({ date, session: "changed", evidence: response.source?.label ?? null })),
          ...removedDates.map((date: string) => ({ date, session: "removed", evidence: response.source?.label ?? null })),
        ],
      },
    };
  });
}

export function confirmMarketCalendarImport(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: Omit<MarketCalendarConfirmRequest, "marketCode">,
): Promise<MarketCalendarConfirmResponse> {
  return postJson<AdminMarketCalendarConfirmResponse>(
    `/admin/market-data/${encodeURIComponent(marketCode)}/calendar/confirm`,
    {
      ...input,
      replacementReason: input.replacementReason ?? input.reason,
    },
  ).then((response) => ({
    marketCode: response.marketCode,
    status: "confirmed",
    versionId: response.versionId,
  }));
}

export function invalidateMarketCalendar(
  marketCode: Exclude<AdminMarketCode, "FX">,
  input: MarketCalendarInvalidateRequest,
): Promise<MarketCalendarInvalidateResponse> {
  return postJson<AdminMarketCalendarConfirmResponse>(
    `/admin/market-data/${encodeURIComponent(marketCode)}/calendar/invalidate`,
    input,
  ).then((response) => ({
    marketCode: response.marketCode,
    calendarYear: response.calendarYear,
    status: "invalidated",
  }));
}

export function updateMarketCalendarSourceConfig(
  marketCode: Exclude<AdminMarketCode, "FX">,
  sourceId: string,
  input: MarketCalendarSourceConfigUpdateRequest,
): Promise<AdminMarketCalendarSourceConfigDto> {
  return patchJson(
    `/admin/market-data/${encodeURIComponent(marketCode)}/calendar/sources/${encodeURIComponent(sourceId)}`,
    input,
  );
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

export function upsertMarketQuoteFallbackPolicy(
  input: QuoteFallbackPolicyUpsertRequest,
): Promise<QuoteFallbackPolicyResponse> {
  return postJson(
    `/admin/market-data/${encodeURIComponent(input.marketCode)}/quote-fallback-policies/upsert`,
    input,
  );
}

export function deactivateMarketQuoteFallbackPolicy(input: {
  ticker: string;
  marketCode: Exclude<AdminMarketCode, "FX">;
}): Promise<QuoteFallbackPolicyResponse> {
  return postJson(
    `/admin/market-data/${encodeURIComponent(input.marketCode)}/quote-fallback-policies/deactivate`,
    input,
  );
}

export function refreshMarketQuoteFallbackPolicy(input: {
  ticker: string;
  marketCode: Exclude<AdminMarketCode, "FX">;
}): Promise<QuoteFallbackPolicyRefreshResponse> {
  return postJson(
    `/admin/market-data/${encodeURIComponent(input.marketCode)}/quote-fallback-policies/refresh`,
    input,
  );
}

export async function fetchOperationLogs(input: {
  marketCode: AdminMarketCode;
  providerId: string;
  operationId: string;
  page: number;
  limit: number;
}): Promise<AdminMarketDataOperationLogsResponse> {
  const marketUrl = `/admin/market-data/${encodeURIComponent(input.marketCode)}/operations/${encodeURIComponent(input.operationId)}/logs?page=${input.page}&limit=${input.limit}`;
  try {
    return await getJson<AdminMarketDataOperationLogsResponse>(marketUrl);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
  }

  const fallback = await getJson<ProviderFixerDashboardLogsResponse>(
    `/admin/providers/${encodeURIComponent(input.providerId)}/logs?operationId=${encodeURIComponent(input.operationId)}&page=${input.page}&limit=${input.limit}`,
  );
  return {
    marketCode: input.marketCode,
    operationId: input.operationId,
    items: fallback.items.map((item) => ({
      id: item.id,
      occurredAt: item.occurredAt,
      level: "info",
      phase: item.phase,
      message: item.message,
      detail: null,
      context: null,
      operationId: item.operationId ?? input.operationId,
    })),
    total: fallback.total,
    page: fallback.page,
    limit: fallback.limit,
  };
}

export function fetchOperationOutcomes(input: {
  providerId: string;
  operationId: string;
  page: number;
  limit: number;
  state?: string;
  action?: string;
}): Promise<ProviderOperationOutcomesResponse> {
  const params = new URLSearchParams();
  params.set("page", String(input.page));
  params.set("limit", String(input.limit));
  if (input.state && input.state !== "all") params.set("state", input.state);
  if (input.action?.trim()) params.set("action", input.action.trim());
  return getJson(
    `/admin/providers/${encodeURIComponent(input.providerId)}/operations/${encodeURIComponent(input.operationId)}/outcomes?${params.toString()}`,
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

export function mutateProviderOperation(input: {
  providerId: string;
  operationId: string;
  action: "pause" | "resume" | "cancel" | "retry";
}): Promise<{ operation: ProviderFixerDashboardOperationDto }> {
  return postJson(
    `/admin/providers/${encodeURIComponent(input.providerId)}/operations/${encodeURIComponent(input.operationId)}/${input.action}`,
    {},
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

export function rerunProviderResolvedUnresolvedItem(input: {
  providerId: string;
  marketCode: ProviderUnresolvedItemDto["marketCode"];
  sourceSymbol: string;
  resolverMode: "quote_first" | "chart_probe_v1";
}): Promise<{ operation: ProviderFixerDashboardOperationDto }> {
  return postJson(`/admin/providers/${encodeURIComponent(input.providerId)}/mappings/rerun`, {
    marketCode: input.marketCode,
    sourceSymbol: input.sourceSymbol,
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
