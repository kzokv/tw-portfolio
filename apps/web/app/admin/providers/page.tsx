import type {
  AdminProvidersResponse,
  ProviderActivityResponse,
  ProviderFixerDashboardDiagnosticsResponse,
  ProviderFixerDashboardLogsResponse,
  ProviderFixerDashboardOperationsResponse,
  ProviderFixerDashboardSummaryResponse,
  ProviderIncidentsResponse,
  ProviderOperationOutcomesResponse,
  ProviderResolutionMappingsResponse,
  ProviderUnresolvedItemsResponse,
} from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";
import { AdminProvidersClient } from "../../../components/admin/AdminProvidersClient";

interface AdminProvidersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

type ProviderConsoleTab =
  | "overview"
  | "unresolved"
  | "fixer"
  | "operations"
  | "incidents"
  | "activity"
  | "logs"
  | "mappings";

type ProviderUnresolvedSort = "last_seen_desc" | "updated_desc" | "source_symbol_asc" | "occurrence_count_desc";

const providerConsoleTabs = new Set<string>([
  "overview",
  "unresolved",
  "fixer",
  "operations",
  "incidents",
  "activity",
  "logs",
  "mappings",
]);

function firstQueryValue(value: string | string[] | undefined, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return fallback;
}

function firstOptionalQueryValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return undefined;
}

function firstTabQueryValue(value: string | string[] | undefined): ProviderConsoleTab | undefined {
  const tab = firstOptionalQueryValue(value);
  return tab && providerConsoleTabs.has(tab) ? (tab as ProviderConsoleTab) : undefined;
}

function positiveIntQueryValue(value: string | string[] | undefined, fallback: number): number {
  const raw = firstOptionalQueryValue(value);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unresolvedStateQueryValue(value: string | string[] | undefined): "active" | "resolved" | "unsupported" | "ignored" {
  const state = firstOptionalQueryValue(value);
  return state === "resolved" || state === "unsupported" || state === "ignored" ? state : "active";
}

function unresolvedSortQueryValue(value: string | string[] | undefined): ProviderUnresolvedSort {
  const sort = firstOptionalQueryValue(value);
  return sort === "updated_desc" || sort === "source_symbol_asc" || sort === "occurrence_count_desc"
    ? sort
    : "last_seen_desc";
}

export default async function AdminProvidersPage({ searchParams }: AdminProvidersPageProps) {
  const query = await searchParams;
  const providerId = firstQueryValue(query.providerId, "yahoo-finance-kr");
  const resolverMode = firstQueryValue(query.resolverMode, "quote_first");
  const errorCode = firstQueryValue(query.errorCode, "yahoo_finance_kr_symbol_unresolved");
  const initialTab = firstTabQueryValue(query.tab);
  const unresolvedState = unresolvedStateQueryValue(query.unresolvedState);
  const unresolvedSearch = firstOptionalQueryValue(query.unresolvedSearch) ?? "";
  const unresolvedSort = unresolvedSortQueryValue(query.unresolvedSort);
  const unresolvedPage = positiveIntQueryValue(query.unresolvedPage, 1);
  const operationsPage = positiveIntQueryValue(query.operationsPage, 1);
  const operationId = firstOptionalQueryValue(query.operationId);

  const [providersData, summaryData] = await Promise.all([
    getJson<AdminProvidersResponse>("/admin/providers"),
    getJson<ProviderFixerDashboardSummaryResponse>(
      `/admin/providers/${encodeURIComponent(providerId)}/operations/summary`,
    ),
  ]);

  const pageLimit = summaryData.guardrails.uiPageSize;
  const [diagnosticsData, unresolvedData, incidentsData, mappingsData, activityData, operationsData, logsData] = await Promise.all([
    getJson<ProviderFixerDashboardDiagnosticsResponse>(
      `/admin/providers/${encodeURIComponent(providerId)}/diagnostics?resolverMode=${encodeURIComponent(resolverMode)}&errorCode=${encodeURIComponent(errorCode)}`,
    ),
    getJson<ProviderUnresolvedItemsResponse>(
      `/admin/providers/${encodeURIComponent(providerId)}/unresolved?state=${encodeURIComponent(unresolvedState)}&errorCode=${encodeURIComponent(errorCode)}&search=${encodeURIComponent(unresolvedSearch)}&sort=${encodeURIComponent(unresolvedSort)}&page=${unresolvedPage}&limit=${pageLimit}`,
    ),
    getJson<ProviderIncidentsResponse>(
      `/admin/providers/${encodeURIComponent(providerId)}/incidents?status=open&page=1&limit=${pageLimit}`,
    ),
    getJson<ProviderResolutionMappingsResponse>(
      `/admin/providers/${encodeURIComponent(providerId)}/mappings?page=1&limit=${pageLimit}`,
    ),
    getJson<ProviderActivityResponse>(
      `/admin/providers/${encodeURIComponent(providerId)}/activity?page=1&limit=${pageLimit}`,
    ),
    getJson<ProviderFixerDashboardOperationsResponse>(
      `/admin/providers/${encodeURIComponent(providerId)}/operations?page=${operationsPage}&limit=${pageLimit}`,
    ),
    getJson<ProviderFixerDashboardLogsResponse>(
      `/admin/providers/${encodeURIComponent(providerId)}/logs?page=1&limit=${pageLimit}${operationId ? `&operationId=${encodeURIComponent(operationId)}` : ""}`,
    ),
  ]);

  const operations =
    operationsData.stagedOperation &&
    !operationsData.operations.some((operation) => operation.id === operationsData.stagedOperation?.id)
      ? [operationsData.stagedOperation, ...operationsData.operations]
      : operationsData.operations;
  const selectedOperationForOutcomes =
    (operationId ? operations.find((operation) => operation.id === operationId && operation.providerId === providerId) : null)
    ?? operationsData.stagedOperation
    ?? operations[0]
    ?? null;
  const outcomesData = selectedOperationForOutcomes
    ? await getJson<ProviderOperationOutcomesResponse>(
        `/admin/providers/${encodeURIComponent(providerId)}/operations/${encodeURIComponent(selectedOperationForOutcomes.id)}/outcomes?page=1&limit=${pageLimit}`,
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
        limit: pageLimit,
      };

  return (
    <AdminProvidersClient
      providers={providersData.providers}
      capabilities={providersData.capabilities}
      initialProviderId={providerId}
      initialTab={initialTab}
      summary={summaryData.summary}
      guardrails={summaryData.guardrails}
      diagnostics={diagnosticsData.diagnostics}
      unresolvedItems={unresolvedData.items}
      unresolvedPage={unresolvedData.page}
      unresolvedLimit={unresolvedData.limit}
      unresolvedTotal={unresolvedData.total}
      initialUnresolvedState={unresolvedState}
      initialUnresolvedSearch={unresolvedSearch}
      initialUnresolvedSort={unresolvedSort}
      incidents={incidentsData.items}
      incidentsPage={incidentsData.page}
      incidentsLimit={incidentsData.limit}
      incidentsTotal={incidentsData.total}
      mappings={mappingsData.items}
      mappingsPage={mappingsData.page}
      mappingsLimit={mappingsData.limit}
      mappingsTotal={mappingsData.total}
      activityItems={activityData.items}
      activityPage={activityData.page}
      activityLimit={activityData.limit}
      activityTotal={activityData.total}
      stagedOperation={operationsData.stagedOperation}
      operations={operations}
      initialOperationId={selectedOperationForOutcomes?.id}
      operationsPage={operationsData.page}
      operationsLimit={operationsData.limit}
      operationsTotal={operationsData.total}
      operationOutcomes={outcomesData.items}
      operationOutcomeSummary={outcomesData.summary}
      operationOutcomesPage={outcomesData.page}
      operationOutcomesLimit={outcomesData.limit}
      operationOutcomesTotal={outcomesData.total}
      logs={logsData.items}
      logsPage={logsData.page}
      logsLimit={logsData.limit}
      logsTotal={logsData.total}
    />
  );
}
