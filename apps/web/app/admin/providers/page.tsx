import type {
  AdminProvidersResponse,
  ProviderFixerDashboardDiagnosticsResponse,
  ProviderFixerDashboardLogsResponse,
  ProviderFixerDashboardOperationsResponse,
  ProviderFixerDashboardSummaryResponse,
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

export default async function AdminProvidersPage({ searchParams }: AdminProvidersPageProps) {
  const query = await searchParams;
  const providerId = firstQueryValue(query.providerId, "yahoo-finance-kr");
  const resolverMode = firstQueryValue(query.resolverMode, "quote_first");
  const errorCode = firstQueryValue(query.errorCode, "yahoo_finance_kr_symbol_unresolved");
  const initialTab = firstTabQueryValue(query.tab);

  const [providersData, summaryData] = await Promise.all([
    getJson<AdminProvidersResponse>("/admin/providers"),
    getJson<ProviderFixerDashboardSummaryResponse>("/admin/provider-fixer/summary"),
  ]);

  const pageLimit = summaryData.guardrails.uiPageSize;
  const [diagnosticsData, operationsData, logsData] = await Promise.all([
    getJson<ProviderFixerDashboardDiagnosticsResponse>(
      `/admin/provider-fixer/diagnostics?providerId=${encodeURIComponent(providerId)}&resolverMode=${encodeURIComponent(resolverMode)}&errorCode=${encodeURIComponent(errorCode)}`,
    ),
    getJson<ProviderFixerDashboardOperationsResponse>(
      `/admin/provider-fixer/operations?providerId=${encodeURIComponent(providerId)}&page=1&limit=${pageLimit}`,
    ),
    getJson<ProviderFixerDashboardLogsResponse>(
      `/admin/provider-fixer/logs?providerId=${encodeURIComponent(providerId)}&page=1&limit=${pageLimit}`,
    ),
  ]);

  const operations =
    operationsData.stagedOperation &&
    !operationsData.operations.some((operation) => operation.id === operationsData.stagedOperation?.id)
      ? [operationsData.stagedOperation, ...operationsData.operations]
      : operationsData.operations;

  return (
    <AdminProvidersClient
      providers={providersData.providers}
      initialProviderId={providerId}
      initialTab={initialTab}
      summary={summaryData.summary}
      guardrails={summaryData.guardrails}
      diagnostics={diagnosticsData.diagnostics}
      stagedOperation={operationsData.stagedOperation}
      operations={operations}
      operationsPage={operationsData.page}
      operationsLimit={operationsData.limit}
      operationsTotal={operationsData.total}
      logs={logsData.items}
      logsPage={logsData.page}
      logsLimit={logsData.limit}
      logsTotal={logsData.total}
    />
  );
}
