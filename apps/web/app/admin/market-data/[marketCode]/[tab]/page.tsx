import { notFound } from "next/navigation";
import type {
  AdminMarketCode,
  AdminMarketDataActionsResponse,
  AdminMarketDataInstrumentsResponse,
  AdminMarketDataOperationsResponse,
  AdminMarketDataOverviewResponse,
  AdminMarketDataUnresolvedResponse as SharedAdminMarketDataUnresolvedResponse,
  ProviderFixerDashboardOperationsResponse,
  ProviderOperationOutcomesResponse,
  ProviderResolutionMappingsResponse,
  ProviderUnresolvedItemsResponse,
} from "@vakwen/shared-types";
import { getJson } from "../../../../../lib/api";
import { AdminMarketDataWorkspaceClient } from "../../../../../components/admin/AdminMarketDataClient";
import type {
  AdminMarketDataActivityQuery,
  AdminMarketDataActivityResponse,
  AdminMarketDataCalendarResponse,
  AdminMarketDataOverviewUiResponse,
  AdminMarketDataUnresolvedQuery,
  AdminMarketDataUnresolvedResponse as AdminMarketDataUnresolvedUiResponse,
  AdminMarketWorkspaceUiTab,
} from "../../../../../lib/adminMarketDataContracts";

interface AdminMarketDataWorkspacePageProps {
  params: Promise<{ marketCode: string; tab: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

interface InstrumentQuery {
  page: number;
  limit: number;
  status: string;
  supportState: string;
  search: string;
  instrumentType: string;
  backfillStatus: string;
  sort: string;
}

interface KrMappingQuery {
  resolverMode: "quote_first" | "chart_probe_v1";
  unresolvedPage: number;
  unresolvedLimit: number;
  unresolvedState: "active" | "resolved" | "unsupported" | "ignored" | "all";
  unresolvedSearch: string;
  unresolvedSort: "last_seen_desc" | "updated_desc" | "source_symbol_asc" | "occurrence_count_desc";
  mappingsPage: number;
  mappingsLimit: number;
  mappingsSearch: string;
}

type UnresolvedQuery = AdminMarketDataUnresolvedQuery;

interface KrOperationsQuery {
  operationsPage: number;
  operationsLimit: number;
  operationOutcomesPage: number;
  operationOutcomesLimit: number;
  operationOutcomeState: "pending" | "running" | "succeeded" | "failed" | "skipped" | "rate_limited" | "cancelled" | "all";
  operationOutcomeAction: string;
}

interface SnapshotRepairRequest {
  mode: "snapshots" | "valuation";
  tickers: string[];
  fromDate: string | null;
  targetDate: string | null;
  startDate: string | null;
  endDate: string | null;
}

const marketCodes = new Set(["TW", "US", "AU", "KR", "FX"]);
const tabs = new Set([
  "overview",
  "calendar",
  "instruments",
  "backfill",
  "mappings",
  "purge",
  "operations",
  "activity",
  "unresolved",
  "refresh-rates",
]);

function firstOptionalQueryValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return undefined;
}

function positiveIntQueryValue(value: string | string[] | undefined, fallback: number): number {
  const raw = firstOptionalQueryValue(value);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function snapshotRepairTickersFromSearchParams(query: Record<string, string | string[] | undefined>, fallbackSearch: string): string[] {
  const rawTickers = firstOptionalQueryValue(query.tickers);
  if (rawTickers) {
    return rawTickers
      .split(",")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter((ticker) => ticker.length > 0);
  }
  return fallbackSearch.trim() ? [fallbackSearch.trim().toUpperCase()] : [];
}

function instrumentQueryFromSearchParams(
  query: Record<string, string | string[] | undefined>,
  defaults: Pick<InstrumentQuery, "status" | "supportState"> = { status: "all", supportState: "all" },
): InstrumentQuery {
  return {
    page: positiveIntQueryValue(query.page, 1),
    limit: positiveIntQueryValue(query.limit, 50),
    status: firstOptionalQueryValue(query.status) ?? defaults.status,
    supportState: firstOptionalQueryValue(query.supportState) ?? defaults.supportState,
    search: firstOptionalQueryValue(query.search) ?? "",
    instrumentType: firstOptionalQueryValue(query.instrumentType) ?? "all",
    backfillStatus: firstOptionalQueryValue(query.backfillStatus) ?? "all",
    sort: firstOptionalQueryValue(query.sort) ?? "ticker_asc",
  };
}

function unresolvedStateQueryValue(value: string | string[] | undefined): KrMappingQuery["unresolvedState"] {
  const state = firstOptionalQueryValue(value);
  return state === "resolved" || state === "unsupported" || state === "ignored" || state === "all" ? state : "active";
}

function krMappingUnresolvedSortQueryValue(value: string | string[] | undefined): KrMappingQuery["unresolvedSort"] {
  const sort = firstOptionalQueryValue(value);
  return sort === "updated_desc" || sort === "source_symbol_asc" || sort === "occurrence_count_desc"
    ? sort
    : "last_seen_desc";
}

function resolverModeQueryValue(value: string | string[] | undefined): KrMappingQuery["resolverMode"] {
  const mode = firstOptionalQueryValue(value);
  return mode === "chart_probe_v1" ? mode : "quote_first";
}

function unresolvedTableSortQueryValue(value: string | string[] | undefined): UnresolvedQuery["sort"] {
  const sort = firstOptionalQueryValue(value);
  return sort === "updated_desc"
    || sort === "occurrence_count_desc"
    || sort === "source_symbol_asc"
    ? sort
    : "last_seen_desc";
}

function unresolvedQueryFromSearchParams(query: Record<string, string | string[] | undefined>): UnresolvedQuery {
  return {
    page: positiveIntQueryValue(query.page, 1),
    limit: positiveIntQueryValue(query.limit, 25),
    providerId: firstOptionalQueryValue(query.providerId) ?? "",
    state: unresolvedStateQueryValue(query.state ?? query.unresolvedState),
    errorCode: firstOptionalQueryValue(query.errorCode) ?? "",
    search: firstOptionalQueryValue(query.search ?? query.unresolvedSearch) ?? "",
    sort: unresolvedTableSortQueryValue(query.sort ?? query.unresolvedSort),
  };
}

function krMappingQueryFromSearchParams(query: Record<string, string | string[] | undefined>): KrMappingQuery {
  return {
    resolverMode: resolverModeQueryValue(query.resolverMode),
    unresolvedPage: positiveIntQueryValue(query.unresolvedPage, 1),
    unresolvedLimit: positiveIntQueryValue(query.unresolvedLimit, 25),
    unresolvedState: unresolvedStateQueryValue(query.unresolvedState),
    unresolvedSearch: firstOptionalQueryValue(query.unresolvedSearch) ?? "",
    unresolvedSort: krMappingUnresolvedSortQueryValue(query.unresolvedSort),
    mappingsPage: positiveIntQueryValue(query.mappingsPage, 1),
    mappingsLimit: positiveIntQueryValue(query.mappingsLimit, 25),
    mappingsSearch: firstOptionalQueryValue(query.mappingsSearch) ?? "",
  };
}

function operationOutcomeStateQueryValue(value: string | string[] | undefined): KrOperationsQuery["operationOutcomeState"] {
  const state = firstOptionalQueryValue(value);
  return state === "pending"
    || state === "running"
    || state === "succeeded"
    || state === "failed"
    || state === "skipped"
    || state === "rate_limited"
    || state === "cancelled"
    ? state
    : "all";
}

function krOperationsQueryFromSearchParams(query: Record<string, string | string[] | undefined>): KrOperationsQuery {
  return {
    operationsPage: positiveIntQueryValue(query.operationsPage ?? query.page, 1),
    operationsLimit: positiveIntQueryValue(query.operationsLimit ?? query.limit, 25),
    operationOutcomesPage: positiveIntQueryValue(query.operationOutcomesPage, 1),
    operationOutcomesLimit: positiveIntQueryValue(query.operationOutcomesLimit, 25),
    operationOutcomeState: operationOutcomeStateQueryValue(query.operationOutcomeState),
    operationOutcomeAction: firstOptionalQueryValue(query.operationOutcomeAction) ?? "",
  };
}

function instrumentQueryString(filters: InstrumentQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(filters.page));
  params.set("limit", String(filters.limit));
  for (const key of ["status", "supportState", "instrumentType", "backfillStatus", "sort"] as const) {
    if (filters[key] && filters[key] !== "all") {
      params.set(key, filters[key]);
    }
  }
  if (filters.search.trim()) {
    params.set("search", filters.search.trim());
  }
  return params.toString();
}

function activityQueryFromSearchParams(query: Record<string, string | string[] | undefined>): AdminMarketDataActivityQuery {
  return {
    page: positiveIntQueryValue(query.page, 1),
    limit: positiveIntQueryValue(query.limit, 25),
    search: firstOptionalQueryValue(query.search) ?? "",
    source: firstOptionalQueryValue(query.source) ?? "",
    sourceKind: firstOptionalQueryValue(query.sourceKind) ?? firstOptionalQueryValue(query.source) ?? "",
    sourceId: firstOptionalQueryValue(query.sourceId) ?? "",
    category: firstOptionalQueryValue(query.category) ?? "",
    result: firstOptionalQueryValue(query.result) ?? "all",
    timeRange: firstOptionalQueryValue(query.timeRange) ?? "24h",
  };
}

function activityQueryString(query: AdminMarketDataActivityQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("limit", String(query.limit));
  if (query.search.trim()) params.set("search", query.search.trim());
  if (query.sourceKind) params.set("sourceKind", query.sourceKind);
  else if (query.source) params.set("source", query.source);
  if (query.sourceId) params.set("sourceId", query.sourceId);
  if (query.category) params.set("category", query.category);
  if (query.result && query.result !== "all") params.set("result", query.result);
  if (query.timeRange) params.set("timeRange", query.timeRange);
  return params.toString();
}

function stringifyEvidence(evidence: unknown): string {
  if (!evidence) return "No evidence summary";
  if (typeof evidence === "string") return evidence;
  if (typeof evidence === "object") {
    const record = evidence as Record<string, unknown>;
    for (const key of ["errorMessage", "message", "reason", "status"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return JSON.stringify(record);
  }
  return String(evidence);
}

function unresolvedActionLabel(action: SharedAdminMarketDataUnresolvedResponse["items"][number]["recommendedAction"]): string {
  if (action === "repair_mapping") return "Repair mapping";
  if (action === "retry_via_backfill") return "Retry via backfill";
  if (action === "mark_unsupported") return "Mark unsupported";
  if (action === "reopen") return "Reopen";
  if (action === "ignore") return "Ignore";
  return "Review";
}

function adaptMarketUnresolvedResponse(
  response: SharedAdminMarketDataUnresolvedResponse,
): AdminMarketDataUnresolvedUiResponse {
  const providerLabels = new Map(response.providers.map((provider) => [provider.providerId, provider.label]));
  return {
    ...response,
    marketCode: response.marketCode,
    summary: [
      { id: "active", label: "Active unresolved rows", value: response.summary.activeRowCount },
      { id: "affected", label: "Affected instruments", value: response.summary.affectedInstrumentCount },
      {
        id: "oldest",
        label: "Oldest unresolved",
        value: response.summary.oldestUnresolvedAt ? response.summary.oldestUnresolvedAt.slice(0, 10) : "none",
        detail: response.summary.oldestUnresolvedAt,
      },
    ],
    activeUnresolvedRowCount: response.summary.activeRowCount,
    affectedInstrumentCount: response.summary.affectedInstrumentCount,
    oldestUnresolvedAt: response.summary.oldestUnresolvedAt,
    filters: {
      providers: response.providers.map((provider) => ({ value: provider.providerId, label: provider.label })),
      states: response.summary.byState.map((bucket) => ({ value: bucket.key, label: `${bucket.key} (${bucket.count})` })),
      errorCodes: response.summary.byErrorCode.map((bucket) => ({ value: bucket.key, label: `${bucket.key} (${bucket.count})` })),
      sorts: [
        { value: "last_seen_desc", label: "Last seen" },
        { value: "updated_desc", label: "Recently updated" },
        { value: "occurrence_count_desc", label: "Most occurrences" },
        { value: "source_symbol_asc", label: "Source symbol" },
      ],
    },
    blocker: null,
    items: response.items.map((item) => {
      const activeActions = item.state === "active"
        ? (item.marketCode === "KR"
            ? ["ignore", "unsupported"] as const
            : ["retry_via_backfill", "ignore", "unsupported"] as const)
        : ["reopen"] as const;
      return {
        ...item,
        id: `${item.providerId}:${item.marketCode}:${item.errorCode}:${item.sourceSymbol}`,
        providerLabel: providerLabels.get(item.providerId) ?? item.providerId,
        errorLabel: item.errorCode,
        affectedInstrumentCount: 1,
        recommendedActionLabel: unresolvedActionLabel(item.recommendedAction),
        evidenceSummary: item.recommendedActionReason || stringifyEvidence(item.evidence),
        actions: [...activeActions],
      };
    }),
    query: {
      page: response.page,
      limit: response.limit,
      providerId: response.filters.providerId ?? "",
      state: response.filters.state,
      errorCode: response.filters.errorCode ?? "",
      search: response.filters.search ?? "",
      sort: response.filters.sort,
    },
  };
}

export default async function AdminMarketDataWorkspacePage({
  params,
  searchParams,
}: AdminMarketDataWorkspacePageProps) {
  const resolvedParams = await params;
  const query = await searchParams;
  if (!marketCodes.has(resolvedParams.marketCode) || !tabs.has(resolvedParams.tab)) {
    notFound();
  }

  const marketCode = resolvedParams.marketCode as AdminMarketCode;
  const requestedTab = resolvedParams.tab as AdminMarketWorkspaceUiTab;
  const tab = (marketCode === "KR" && requestedTab === "mappings" ? "unresolved" : requestedTab) as AdminMarketWorkspaceUiTab;
  const instrumentQuery = instrumentQueryFromSearchParams(
    query,
    tab === "backfill" ? { status: "listed", supportState: "supported" } : undefined,
  );
  const activityQuery = activityQueryFromSearchParams(query);
  const krMappingQuery = krMappingQueryFromSearchParams(query);
  const krOperationsQuery = krOperationsQueryFromSearchParams(query);
  const unresolvedQuery = unresolvedQueryFromSearchParams(query);
  const page = instrumentQuery.page;
  const limit = instrumentQuery.limit;
  const providerId = firstOptionalQueryValue(query.providerId);
  const operationId = firstOptionalQueryValue(query.operationId);
  const repairMode = firstOptionalQueryValue(query.repair);
  const snapshotRepairRequest: SnapshotRepairRequest | null =
    tab === "backfill" && (repairMode === "snapshots" || repairMode === "valuation")
      ? {
          mode: repairMode,
          tickers: snapshotRepairTickersFromSearchParams(query, instrumentQuery.search),
          fromDate: firstOptionalQueryValue(query.fromDate) ?? null,
          targetDate: firstOptionalQueryValue(query.targetDate) ?? null,
          startDate: firstOptionalQueryValue(query.startDate) ?? firstOptionalQueryValue(query.fromDate) ?? null,
          endDate: firstOptionalQueryValue(query.endDate) ?? firstOptionalQueryValue(query.targetDate) ?? null,
        }
      : null;

  const [overview, actions] = await Promise.all([
    getJson<AdminMarketDataOverviewResponse>(`/admin/market-data/${encodeURIComponent(marketCode)}/overview`),
    getJson<AdminMarketDataActionsResponse>(`/admin/market-data/${encodeURIComponent(marketCode)}/actions`),
  ]);
  const overviewTabs = new Set<AdminMarketWorkspaceUiTab>(overview.tabs as AdminMarketWorkspaceUiTab[]);
  if (tab === "activity" || tab === "calendar") overviewTabs.add(tab);
  if (marketCode !== "FX") overviewTabs.add("unresolved");
  const overviewWithUiTabs: AdminMarketDataOverviewUiResponse = {
    ...overview,
    tabs: [...overviewTabs],
    unresolvedInstrumentCount: (overview as AdminMarketDataOverviewUiResponse).unresolvedInstrumentCount ?? null,
  };

  const instruments =
    (tab === "instruments" || tab === "backfill") && marketCode !== "FX"
      ? await getJson<AdminMarketDataInstrumentsResponse>(
          `/admin/market-data/${encodeURIComponent(marketCode)}/instruments?${instrumentQueryString(instrumentQuery)}`,
        )
      : null;
  const operations =
    tab === "operations" && marketCode !== "KR"
      ? await getJson<AdminMarketDataOperationsResponse>(
          `/admin/market-data/${encodeURIComponent(marketCode)}/operations?page=${page}&limit=${limit}${providerId ? `&providerId=${encodeURIComponent(providerId)}` : ""}`,
        )
      : null;
  const activity =
    tab === "activity"
      ? {
          ...(await getJson<AdminMarketDataActivityResponse>(
            `/admin/market-data/${encodeURIComponent(marketCode)}/activity?${activityQueryString(activityQuery)}`,
          )),
          query: activityQuery,
        }
      : null;
  const calendar =
    tab === "calendar" && marketCode !== "FX"
      ? await getJson<AdminMarketDataCalendarResponse>(
          `/admin/market-data/${encodeURIComponent(marketCode)}/calendar`,
        )
      : null;
  const unresolved =
    tab === "unresolved" && marketCode !== "FX"
      ? await getJson<SharedAdminMarketDataUnresolvedResponse>(
          `/admin/market-data/${encodeURIComponent(marketCode)}/unresolved?page=${unresolvedQuery.page}&limit=${unresolvedQuery.limit}&state=${encodeURIComponent(unresolvedQuery.state)}&sort=${encodeURIComponent(unresolvedQuery.sort)}${unresolvedQuery.providerId ? `&providerId=${encodeURIComponent(unresolvedQuery.providerId)}` : ""}${unresolvedQuery.errorCode ? `&errorCode=${encodeURIComponent(unresolvedQuery.errorCode)}` : ""}${unresolvedQuery.search.trim() ? `&search=${encodeURIComponent(unresolvedQuery.search.trim())}` : ""}`,
        ).then(adaptMarketUnresolvedResponse)
      : null;
  const krMappings =
    marketCode === "KR" && tab === "unresolved"
      ? await Promise.all([
          getJson<ProviderUnresolvedItemsResponse>(
            `/admin/providers/yahoo-finance-kr/unresolved?state=${encodeURIComponent(krMappingQuery.unresolvedState)}&errorCode=yahoo_finance_kr_symbol_unresolved&search=${encodeURIComponent(krMappingQuery.unresolvedSearch)}&sort=${encodeURIComponent(krMappingQuery.unresolvedSort)}&page=${krMappingQuery.unresolvedPage}&limit=${krMappingQuery.unresolvedLimit}`,
          ),
          getJson<ProviderResolutionMappingsResponse>(
            `/admin/providers/yahoo-finance-kr/mappings?page=${krMappingQuery.mappingsPage}&limit=${krMappingQuery.mappingsLimit}&search=${encodeURIComponent(krMappingQuery.mappingsSearch)}`,
          ),
        ]).then(([unresolved, mappings]) => ({ unresolved, mappings, query: krMappingQuery }))
      : null;
  const krOperations =
    marketCode === "KR" && tab === "operations"
      ? await getJson<ProviderFixerDashboardOperationsResponse>(
          `/admin/providers/yahoo-finance-kr/operations?page=${krOperationsQuery.operationsPage}&limit=${krOperationsQuery.operationsLimit}${operationId ? `&includeOperationId=${encodeURIComponent(operationId)}` : ""}`,
        ).then(async (providerOperations) => {
          const operationRows =
            providerOperations.stagedOperation
            && !providerOperations.operations.some((operation) => operation.id === providerOperations.stagedOperation?.id)
              ? [providerOperations.stagedOperation, ...providerOperations.operations]
              : providerOperations.operations;
          const selectedOperation =
            operationId
              ? providerOperations.selectedOperation
                ?? operationRows.find((operation) => operation.id === operationId)
                ?? null
              : null;
          const outcomes = selectedOperation
            ? await getJson<ProviderOperationOutcomesResponse>(
                `/admin/providers/yahoo-finance-kr/operations/${encodeURIComponent(selectedOperation.id)}/outcomes?page=${krOperationsQuery.operationOutcomesPage}&limit=${krOperationsQuery.operationOutcomesLimit}${krOperationsQuery.operationOutcomeState !== "all" ? `&state=${encodeURIComponent(krOperationsQuery.operationOutcomeState)}` : ""}${krOperationsQuery.operationOutcomeAction.trim() ? `&action=${encodeURIComponent(krOperationsQuery.operationOutcomeAction.trim())}` : ""}`,
              )
            : {
                items: [],
                summary: {
                  total: 0,
                  processed: 0,
                  pending: 0,
                  running: 0,
                  succeeded: 0,
                  failed: 0,
                  skipped: 0,
                  rateLimited: 0,
                  cancelled: 0,
                  progressPercent: 0,
                },
                total: 0,
                page: 1,
                limit: krOperationsQuery.operationOutcomesLimit,
              };
          return {
            operations: providerOperations,
            explicitOperationId: operationId ?? "",
            selectedOperationId: selectedOperation?.id ?? "",
            outcomes,
            query: krOperationsQuery,
          };
        })
      : null;

  return (
    <AdminMarketDataWorkspaceClient
      marketCode={marketCode}
      tab={tab}
      overview={overviewWithUiTabs}
      actions={actions.actions}
      instruments={instruments}
      instrumentQuery={instrumentQuery}
      unresolved={unresolved}
      operations={operations}
      activity={activity}
      calendar={calendar}
      providerFilterId={providerId ?? ""}
      krMappings={krMappings}
      krOperations={krOperations}
      snapshotRepairRequest={snapshotRepairRequest}
    />
  );
}
