import { notFound } from "next/navigation";
import type {
  AdminMarketCode,
  AdminMarketDataActionsResponse,
  AdminMarketDataInstrumentsResponse,
  AdminMarketDataLogsResponse,
  AdminMarketDataOperationsResponse,
  AdminMarketDataOverviewResponse,
  AdminMarketWorkspaceTab,
  ProviderResolutionMappingsResponse,
  ProviderUnresolvedItemsResponse,
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

interface KrMappingQuery {
  unresolvedPage: number;
  unresolvedLimit: number;
  unresolvedState: "active" | "resolved" | "unsupported" | "ignored" | "all";
  unresolvedSearch: string;
  unresolvedSort: "last_seen_desc" | "updated_desc" | "source_symbol_asc" | "occurrence_count_desc";
  mappingsPage: number;
  mappingsLimit: number;
  mappingsSearch: string;
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

function unresolvedStateQueryValue(value: string | string[] | undefined): KrMappingQuery["unresolvedState"] {
  const state = firstOptionalQueryValue(value);
  return state === "resolved" || state === "unsupported" || state === "ignored" || state === "all" ? state : "active";
}

function unresolvedSortQueryValue(value: string | string[] | undefined): KrMappingQuery["unresolvedSort"] {
  const sort = firstOptionalQueryValue(value);
  return sort === "updated_desc" || sort === "source_symbol_asc" || sort === "occurrence_count_desc"
    ? sort
    : "last_seen_desc";
}

function krMappingQueryFromSearchParams(query: Record<string, string | string[] | undefined>): KrMappingQuery {
  return {
    unresolvedPage: positiveIntQueryValue(query.unresolvedPage, 1),
    unresolvedLimit: positiveIntQueryValue(query.unresolvedLimit, 25),
    unresolvedState: unresolvedStateQueryValue(query.unresolvedState),
    unresolvedSearch: firstOptionalQueryValue(query.unresolvedSearch) ?? "",
    unresolvedSort: unresolvedSortQueryValue(query.unresolvedSort),
    mappingsPage: positiveIntQueryValue(query.mappingsPage, 1),
    mappingsLimit: positiveIntQueryValue(query.mappingsLimit, 25),
    mappingsSearch: firstOptionalQueryValue(query.mappingsSearch) ?? "",
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
  const krMappingQuery = krMappingQueryFromSearchParams(query);
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
  const krMappings =
    marketCode === "KR" && tab === "mappings"
      ? await Promise.all([
          getJson<ProviderUnresolvedItemsResponse>(
            `/admin/providers/yahoo-finance-kr/unresolved?state=${encodeURIComponent(krMappingQuery.unresolvedState)}&errorCode=yahoo_finance_kr_symbol_unresolved&search=${encodeURIComponent(krMappingQuery.unresolvedSearch)}&sort=${encodeURIComponent(krMappingQuery.unresolvedSort)}&page=${krMappingQuery.unresolvedPage}&limit=${krMappingQuery.unresolvedLimit}`,
          ),
          getJson<ProviderResolutionMappingsResponse>(
            `/admin/providers/yahoo-finance-kr/mappings?page=${krMappingQuery.mappingsPage}&limit=${krMappingQuery.mappingsLimit}&search=${encodeURIComponent(krMappingQuery.mappingsSearch)}`,
          ),
        ]).then(([unresolved, mappings]) => ({ unresolved, mappings, query: krMappingQuery }))
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
      krMappings={krMappings}
    />
  );
}
