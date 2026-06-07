import { notFound } from "next/navigation";
import type {
  AdminMarketCode,
  AdminMarketDataActionsResponse,
  AdminMarketDataInstrumentsResponse,
  AdminMarketDataLogsResponse,
  AdminMarketDataOperationsResponse,
  AdminMarketDataOverviewResponse,
  AdminMarketWorkspaceTab,
} from "@vakwen/shared-types";
import { getJson } from "../../../../../lib/api";
import { AdminMarketDataWorkspaceClient } from "../../../../../components/admin/AdminMarketDataClient";

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

const marketCodes = new Set(["TW", "US", "AU", "KR", "FX"]);
const tabs = new Set([
  "overview",
  "instruments",
  "backfill",
  "mappings",
  "purge",
  "operations",
  "logs",
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

function instrumentQueryFromSearchParams(query: Record<string, string | string[] | undefined>): InstrumentQuery {
  return {
    page: positiveIntQueryValue(query.page, 1),
    limit: positiveIntQueryValue(query.limit, 50),
    status: firstOptionalQueryValue(query.status) ?? "all",
    supportState: firstOptionalQueryValue(query.supportState) ?? "all",
    search: firstOptionalQueryValue(query.search) ?? "",
    instrumentType: firstOptionalQueryValue(query.instrumentType) ?? "all",
    backfillStatus: firstOptionalQueryValue(query.backfillStatus) ?? "all",
    sort: firstOptionalQueryValue(query.sort) ?? "ticker_asc",
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
  const tab = resolvedParams.tab as AdminMarketWorkspaceTab;
  const instrumentQuery = instrumentQueryFromSearchParams(query);
  const page = instrumentQuery.page;
  const limit = instrumentQuery.limit;
  const providerId = firstOptionalQueryValue(query.providerId);
  const operationId = firstOptionalQueryValue(query.operationId);

  const [overview, actions] = await Promise.all([
    getJson<AdminMarketDataOverviewResponse>(`/admin/market-data/${encodeURIComponent(marketCode)}/overview`),
    getJson<AdminMarketDataActionsResponse>(`/admin/market-data/${encodeURIComponent(marketCode)}/actions`),
  ]);

  const instruments =
    tab === "instruments" && marketCode !== "FX"
      ? await getJson<AdminMarketDataInstrumentsResponse>(
          `/admin/market-data/${encodeURIComponent(marketCode)}/instruments?${instrumentQueryString(instrumentQuery)}`,
        )
      : null;
  const operations =
    tab === "operations"
      ? await getJson<AdminMarketDataOperationsResponse>(
          `/admin/market-data/${encodeURIComponent(marketCode)}/operations?page=${page}&limit=${limit}${providerId ? `&providerId=${encodeURIComponent(providerId)}` : ""}`,
        )
      : null;
  const logs =
    tab === "logs"
      ? await getJson<AdminMarketDataLogsResponse>(
          `/admin/market-data/${encodeURIComponent(marketCode)}/logs?page=${page}&limit=${limit}${providerId ? `&providerId=${encodeURIComponent(providerId)}` : ""}${operationId ? `&operationId=${encodeURIComponent(operationId)}` : ""}`,
        )
      : null;

  return (
    <AdminMarketDataWorkspaceClient
      marketCode={marketCode}
      tab={tab}
      overview={overview}
      actions={actions.actions}
      instruments={instruments}
      instrumentQuery={instrumentQuery}
      operations={operations}
      logs={logs}
    />
  );
}
