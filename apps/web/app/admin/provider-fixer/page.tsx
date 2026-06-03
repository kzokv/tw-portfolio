import type {
  ProviderFixerDashboardDiagnosticsResponse,
  ProviderFixerDashboardLogsResponse,
  ProviderFixerDashboardOperationsResponse,
  ProviderFixerDashboardSummaryResponse,
} from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";
import { ProviderFixerClient } from "../../../components/admin/ProviderFixerClient";

interface ProviderFixerPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstQueryValue(value: string | string[] | undefined, fallback: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return fallback;
}

export default async function AdminProviderFixerPage({ searchParams }: ProviderFixerPageProps) {
  const query = await searchParams;
  const providerId = firstQueryValue(query.providerId, "yahoo-finance-kr");
  const resolverMode = firstQueryValue(query.resolverMode, "quote_first");
  const errorCode = firstQueryValue(query.errorCode, "yahoo_finance_kr_symbol_unresolved");

  const summaryData = await getJson<ProviderFixerDashboardSummaryResponse>("/admin/provider-fixer/summary");
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
    <ProviderFixerClient
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
