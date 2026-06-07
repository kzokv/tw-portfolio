"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  AdminMarketDataDelistingOverrideAction,
  AdminInstrumentSupportState,
  AdminMarketCode,
  AdminMarketDataActionDto,
  AdminMarketDataActionExecuteResponse,
  AdminMarketDataBackfillExecuteResponse,
  AdminMarketDataBackfillPreviewResponse,
  AdminMarketDataInstrumentDto,
  AdminMarketDataInstrumentsResponse,
  AdminMarketDataLandingResponse,
  AdminMarketDataLogsResponse,
  AdminMarketDataOperationsResponse,
  AdminMarketDataOverviewResponse,
  AdminMarketDataPurgeCategory,
  AdminMarketDataPurgeExecuteResponse,
  AdminMarketDataPurgePreviewResponse,
  AdminMarketWorkspaceTab,
  ProviderFixerDashboardOperationDto,
  ProviderResolutionMappingDto,
  ProviderResolutionMappingsResponse,
  ProviderUnresolvedItemDto,
  ProviderUnresolvedItemsResponse,
  ProviderUnresolvedListState,
} from "@vakwen/shared-types";
import { Card } from "../ui/Card";
import { cn } from "../../lib/utils";
import {
  bulkUpdateProviderUnresolvedState,
  executeProviderRepair,
  executeMarketBackfill,
  executeMarketAction,
  executeMarketPurge,
  previewProviderRepair,
  previewMarketBackfill,
  previewMarketPurge,
  renewProviderEvidence,
  reverifyProviderMapping,
  revertProviderMapping,
  rerunProviderMapping,
  updateProviderUnresolvedState,
  updateMarketInstrumentDelistingOverride,
  updateMarketInstrumentSupportState,
} from "../../lib/adminMarketDataService";

interface AdminMarketDataLandingClientProps {
  data: AdminMarketDataLandingResponse;
}

interface AdminMarketDataWorkspaceClientProps {
  marketCode: AdminMarketCode;
  tab: AdminMarketWorkspaceTab;
  overview: AdminMarketDataOverviewResponse;
  actions: AdminMarketDataActionDto[];
  instruments: AdminMarketDataInstrumentsResponse | null;
  instrumentQuery?: InstrumentQuery;
  operations: AdminMarketDataOperationsResponse | null;
  logs: AdminMarketDataLogsResponse | null;
  krMappings: KrMappingsData | null;
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

interface KrMappingsData {
  unresolved: ProviderUnresolvedItemsResponse;
  mappings: ProviderResolutionMappingsResponse;
  query: {
    unresolvedPage: number;
    unresolvedLimit: number;
    unresolvedState: ProviderUnresolvedListState;
    unresolvedSearch: string;
    unresolvedSort: "last_seen_desc" | "updated_desc" | "source_symbol_asc" | "occurrence_count_desc";
    mappingsPage: number;
    mappingsLimit: number;
    mappingsSearch: string;
  };
}

const tabLabels: Record<AdminMarketWorkspaceTab, string> = {
  overview: "Overview",
  instruments: "Instruments",
  backfill: "Backfill",
  mappings: "Mappings",
  purge: "Purge data",
  operations: "Operations",
  logs: "Logs",
  "refresh-rates": "Refresh rates",
};

const purgeCategories: Array<{ value: AdminMarketDataPurgeCategory; label: string }> = [
  { value: "price_bars", label: "Price bars" },
  { value: "dividends", label: "Dividends" },
  { value: "backfill_jobs", label: "Backfill job history" },
  { value: "provider_operation_outcomes", label: "Provider operation outcomes" },
  { value: "provider_error_trail", label: "Provider error trail" },
  { value: "provider_resolution_mappings", label: "Provider resolution mappings" },
  { value: "asx_gics_enrichment", label: "ASX GICS enrichment" },
  { value: "admin_state_reset", label: "Admin state reset" },
];

function marketTone(status: AdminMarketDataLandingResponse["markets"][number]["healthStatus"]): string {
  if (status === "healthy") return "bg-emerald-500";
  if (status === "degraded") return "bg-amber-500";
  if (status === "down") return "bg-rose-500";
  return "bg-slate-400";
}

function ActionChips({ marketCode, actions }: { marketCode: AdminMarketCode; actions: AdminMarketDataActionDto[] }) {
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [result, setResult] = useState<AdminMarketDataActionExecuteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: AdminMarketDataActionDto) {
    if (action.action === "backfill_catalog_rows") return;
    setRunningAction(action.action);
    setError(null);
    try {
      const response = await executeMarketAction(marketCode, {
        action: action.action,
        providerId: action.providerId,
        acknowledged: true,
        ...(action.action === "repair_mapping" ? { resolverMode: "quote_first" as const } : {}),
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const executable = action.supported && action.action !== "backfill_catalog_rows";
          return (
            <div
              key={`${action.providerId}:${action.action}`}
              className={cn(
                "flex max-w-full items-center gap-2 rounded border px-2.5 py-1 text-xs",
                action.supported ? "border-border text-muted-foreground" : "border-amber-300 bg-amber-50 text-amber-800",
              )}
              title={action.disabledReason ?? action.description}
            >
              <span className="min-w-0">
                {action.label} - {action.providerId}
              </span>
              {executable ? (
                <button
                  type="button"
                  disabled={runningAction === action.action}
                  onClick={() => void runAction(action)}
                  className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  {runningAction === action.action ? "Running" : "Run"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {result ? (
        <p className="text-xs text-muted-foreground">
          {result.message} Operation {result.operationId} is {result.status}.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function AdminMarketDataLandingClient({ data }: AdminMarketDataLandingClientProps) {
  return (
    <div className="space-y-6" data-testid="admin-market-data-page">
      <div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">Market data</p>
        <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">Market workspaces</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Catalog state, provider ownership, backfill, mappings, purge, and operations are grouped by market.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {data.markets.map((market) => (
          <Link key={market.marketCode} href={market.href} className="block">
            <Card className="h-full px-5 py-4 hover:translate-y-0" data-testid={`market-data-tile-${market.marketCode}`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", marketTone(market.healthStatus))} />
                    <h2 className="text-lg font-semibold text-foreground">{market.marketCode} - {market.label}</h2>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {market.providers.map((provider) => (
                      <span key={provider.providerId} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        {provider.providerId}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="rounded bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                  {market.healthStatus}
                </span>
              </div>
              <dl className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Unresolved</dt>
                  <dd className="mt-1 font-semibold text-foreground">{market.unresolvedCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Pending</dt>
                  <dd className="mt-1 font-semibold text-foreground">{market.pendingBackfillCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Failed</dt>
                  <dd className="mt-1 font-semibold text-foreground">{market.failedBackfillCount.toLocaleString()}</dd>
                </div>
              </dl>
              <p className="mt-4 text-sm text-muted-foreground">{market.nextAction}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function AdminMarketDataWorkspaceClient({
  marketCode,
  tab,
  overview,
  actions,
  instruments,
  instrumentQuery,
  operations,
  logs,
  krMappings,
}: AdminMarketDataWorkspaceClientProps) {
  const tabSet = new Set(overview.tabs);
  const safeTab = tabSet.has(tab) ? tab : "overview";

  return (
    <div className="space-y-5" data-testid={`admin-market-data-${marketCode}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">Market data</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">
            {marketCode} - {overview.label}
          </h1>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {overview.providers.map((provider) => (
              <span key={provider.providerId} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                {provider.providerId}: {provider.role}
              </span>
            ))}
          </div>
        </div>
        <Link href="/admin/market-data" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          All markets
        </Link>
      </div>

      <nav className="flex gap-2 overflow-x-auto border-b border-border pb-2" aria-label="Market data tabs">
        {overview.tabs.map((item) => (
          <Link
            key={item}
            href={`/admin/market-data/${marketCode}/${item}`}
            className={cn(
              "whitespace-nowrap rounded px-3 py-2 text-sm font-medium",
              item === safeTab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {tabLabels[item]}
          </Link>
        ))}
      </nav>

      {safeTab === "overview" && <OverviewPanel overview={overview} actions={actions} />}
      {safeTab === "instruments" && instruments && (
        <InstrumentsPanel
          instruments={instruments}
          initialQuery={instrumentQuery ?? defaultInstrumentQuery(instruments)}
        />
      )}
      {safeTab === "backfill" && marketCode !== "FX" && <BackfillPanel marketCode={marketCode} actions={actions} />}
      {safeTab === "mappings" && <MappingsPanel marketCode={marketCode} actions={actions} krMappings={krMappings} />}
      {safeTab === "purge" && marketCode !== "FX" && <PurgePanel marketCode={marketCode} />}
      {safeTab === "refresh-rates" && <RefreshRatesPanel actions={actions} />}
      {safeTab === "operations" && operations && <OperationsPanel operations={operations} />}
      {safeTab === "logs" && logs && <LogsPanel logs={logs} />}
    </div>
  );
}

function OverviewPanel({ overview, actions }: { overview: AdminMarketDataOverviewResponse; actions: AdminMarketDataActionDto[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="px-5 py-4 hover:translate-y-0">
        <h2 className="text-base font-semibold text-foreground">State</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Health</dt><dd className="mt-1 font-semibold">{overview.healthStatus}</dd></div>
          <div><dt className="text-muted-foreground">Unresolved</dt><dd className="mt-1 font-semibold">{overview.unresolvedCount}</dd></div>
          <div><dt className="text-muted-foreground">Pending</dt><dd className="mt-1 font-semibold">{overview.pendingBackfillCount}</dd></div>
          <div><dt className="text-muted-foreground">Failed</dt><dd className="mt-1 font-semibold">{overview.failedBackfillCount}</dd></div>
        </dl>
        <div className="mt-4 space-y-2 text-sm text-muted-foreground">
          {overview.guidance.map((line) => <p key={line}>{line}</p>)}
        </div>
      </Card>
      <Card className="px-5 py-4 hover:translate-y-0">
        <h2 className="text-base font-semibold text-foreground">Provider-owned actions</h2>
        <p className="mt-2 text-sm text-muted-foreground">The market workspace previews scope and guardrails; execution remains attributed to the owning provider.</p>
        <div className="mt-4"><ActionChips marketCode={overview.marketCode} actions={actions} /></div>
      </Card>
    </div>
  );
}

function defaultInstrumentQuery(instruments: AdminMarketDataInstrumentsResponse): InstrumentQuery {
  return {
    page: instruments.page,
    limit: instruments.limit,
    status: "all",
    supportState: "all",
    search: "",
    instrumentType: "all",
    backfillStatus: "all",
    sort: "ticker_asc",
  };
}

function queryPath(marketCode: string, query: InstrumentQuery, page = query.page): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(query.limit));
  for (const key of ["status", "supportState", "instrumentType", "backfillStatus", "sort"] as const) {
    if (query[key] && query[key] !== "all") {
      params.set(key, query[key]);
    }
  }
  if (query.search.trim()) {
    params.set("search", query.search.trim());
  }
  return `/admin/market-data/${marketCode}/instruments?${params.toString()}`;
}

function InstrumentsPanel({
  instruments,
  initialQuery,
}: {
  instruments: AdminMarketDataInstrumentsResponse;
  initialQuery: InstrumentQuery;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(instruments.items);
  const [filters, setFilters] = useState<InstrumentQuery>(initialQuery);
  const [savingTicker, setSavingTicker] = useState<string | null>(null);
  const [savingDelistingTicker, setSavingDelistingTicker] = useState<string | null>(null);
  const totalPages = Math.max(1, Math.ceil(instruments.total / instruments.limit));
  const delistingOverrideSupported = instruments.marketCode === "AU" || instruments.marketCode === "KR";

  useEffect(() => {
    setRows(instruments.items);
    setFilters(initialQuery);
  }, [initialQuery, instruments.items]);

  function updateFilter(key: keyof InstrumentQuery, value: string) {
    setFilters((current) => ({ ...current, [key]: key === "limit" ? Number.parseInt(value, 10) || current.limit : value }));
  }

  function applyFilters() {
    router.push(queryPath(instruments.marketCode, { ...filters, page: 1 }, 1));
  }

  async function setSupportState(row: AdminMarketDataInstrumentDto, supportState: AdminInstrumentSupportState) {
    setSavingTicker(row.ticker);
    try {
      const result = await updateMarketInstrumentSupportState({
        ticker: row.ticker,
        marketCode: row.marketCode,
        supportState,
      });
      setRows((current) => current.map((item) => item.ticker === row.ticker ? result.instrument : item));
    } finally {
      setSavingTicker(null);
    }
  }

  async function setDelistingOverride(row: AdminMarketDataInstrumentDto, action: AdminMarketDataDelistingOverrideAction) {
    setSavingDelistingTicker(row.ticker);
    try {
      const result = await updateMarketInstrumentDelistingOverride({
        ticker: row.ticker,
        marketCode: row.marketCode,
        action,
      });
      setRows((current) => current.map((item) => item.ticker === row.ticker ? result.instrument : item));
    } finally {
      setSavingDelistingTicker(null);
    }
  }

  return (
    <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="market-data-instruments">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">Instruments</h2>
        <p className="mt-1 text-sm text-muted-foreground">Support state is separate from delisting, exclusion, purge, and holdings visibility.</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(10rem,1fr)_repeat(5,minmax(9rem,auto))_auto]">
          <label className="text-sm font-medium text-foreground">
            Search
            <input
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
              placeholder="Ticker or name"
            />
          </label>
          <FilterSelect label="Status" value={filters.status} options={instruments.filters.status} onChange={(value) => updateFilter("status", value)} />
          <FilterSelect label="Support" value={filters.supportState} options={instruments.filters.supportState} onChange={(value) => updateFilter("supportState", value)} />
          <FilterSelect label="Type" value={filters.instrumentType} options={instruments.filters.instrumentType} onChange={(value) => updateFilter("instrumentType", value)} />
          <FilterSelect label="Backfill" value={filters.backfillStatus} options={instruments.filters.backfillStatus} onChange={(value) => updateFilter("backfillStatus", value)} />
          <FilterSelect label="Sort" value={filters.sort} options={instruments.filters.sort} onChange={(value) => updateFilter("sort", value)} />
          <div className="flex items-end gap-2">
            <button type="button" onClick={applyFilters} className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
              Apply
            </button>
            <Link href={`/admin/market-data/${instruments.marketCode}/instruments`} className="rounded border border-border px-3 py-2 text-sm text-muted-foreground">
              Reset
            </Link>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-5 py-3">Ticker</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Support</th>
              <th className="px-5 py-3">Backfill</th>
              <th className="px-5 py-3">Providers</th>
              <th className="px-5 py-3">Support controls</th>
              <th className="px-5 py-3">Delisting override</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={`${row.marketCode}:${row.ticker}`}>
                <td className="px-5 py-4">
                  <p className="font-medium text-foreground">{row.ticker}</p>
                  <p className="mt-1 max-w-[20rem] truncate text-xs text-muted-foreground">{row.name ?? "Unnamed"}</p>
                </td>
                <td className="px-5 py-4 text-muted-foreground">{row.status}</td>
                <td className="px-5 py-4 text-muted-foreground">{row.supportState}</td>
                <td className="px-5 py-4 text-muted-foreground">{row.backfillStatus}</td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-1">
                    {row.providerIds.map((providerId) => (
                      <span key={providerId} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">{providerId}</span>
                    ))}
                  </div>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-2">
                    {(["supported", "retired_by_admin", "unsupported_by_provider"] as const).map((state) => (
                      <button
                        key={state}
                        type="button"
                        disabled={savingTicker === row.ticker || row.supportState === state}
                        onClick={() => void setSupportState(row, state)}
                        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground disabled:opacity-50"
                      >
                        {state}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-5 py-4">
                  {delistingOverrideSupported ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={savingDelistingTicker === row.ticker || row.delistingDetectionExcluded}
                        onClick={() => void setDelistingOverride(row, "exclude_from_delisting_detection")}
                        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground disabled:opacity-50"
                      >
                        Exclude detection
                      </button>
                      <button
                        type="button"
                        disabled={savingDelistingTicker === row.ticker || !row.delistingDetectionExcluded}
                        onClick={() => void setDelistingOverride(row, "include_in_delisting_detection")}
                        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground disabled:opacity-50"
                      >
                        Include detection
                      </button>
                      <button
                        type="button"
                        disabled={savingDelistingTicker === row.ticker || !row.delistedAt}
                        onClick={() => void setDelistingOverride(row, "clear_delisted_state")}
                        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground disabled:opacity-50"
                      >
                        Clear delisted
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">AU/KR only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-border px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          Showing {rows.length.toLocaleString()} of {instruments.total.toLocaleString()} instruments, page {instruments.page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <Link
            href={queryPath(instruments.marketCode, filters, Math.max(1, instruments.page - 1))}
            aria-disabled={instruments.page <= 1}
            className={cn(
              "rounded border border-border px-3 py-2",
              instruments.page <= 1 && "pointer-events-none opacity-50",
            )}
          >
            Previous
          </Link>
          <Link
            href={queryPath(instruments.marketCode, filters, Math.min(totalPages, instruments.page + 1))}
            aria-disabled={instruments.page >= totalPages}
            className={cn(
              "rounded border border-border px-3 py-2",
              instruments.page >= totalPages && "pointer-events-none opacity-50",
            )}
          >
            Next
          </Link>
        </div>
      </div>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm font-medium text-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function BackfillPanel({ marketCode, actions }: { marketCode: Exclude<AdminMarketCode, "FX">; actions: AdminMarketDataActionDto[] }) {
  const [scope, setScope] = useState("user_owned_or_monitored");
  const [manualTargets, setManualTargets] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [preview, setPreview] = useState<AdminMarketDataBackfillPreviewResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<AdminMarketDataBackfillExecuteResponse | null>(null);
  const action = actions.find((item) => item.action === "backfill_catalog_rows");
  const providerId = action?.providerId;

  function parsedTargets() {
    return manualTargets
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((ticker) => ({ ticker, marketCode }));
  }

  async function runPreview() {
    const targets = parsedTargets();
    const result = await previewMarketBackfill(marketCode, {
      scope: scope as AdminMarketDataBackfillPreviewResponse["scope"],
      providerId,
      manualTargets: targets,
      selectedCatalogRows: targets,
    });
    setPreview(result);
    setExecuteResult(null);
    setAcknowledged(false);
    setTypedConfirmation("");
  }

  async function runExecute() {
    const targets = parsedTargets();
    const result = await executeMarketBackfill(marketCode, {
      scope: scope as AdminMarketDataBackfillPreviewResponse["scope"],
      providerId,
      manualTargets: targets,
      selectedCatalogRows: targets,
      acknowledged,
      typedConfirmation,
    });
    setExecuteResult(result);
  }

  return (
    <Card className="px-5 py-4 hover:translate-y-0" data-testid="market-data-backfill">
      <h2 className="text-base font-semibold text-foreground">Backfill preview</h2>
      <p className="mt-2 text-sm text-muted-foreground">Catalog sync repairs instrument rows. Backfill writes historical bars, dividends, or derived data and requires preview.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <label className="text-sm font-medium text-foreground">
          Scope
          <select value={scope} onChange={(event) => setScope(event.target.value)} className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm">
            <option value="user_owned_or_monitored">User-owned or monitored</option>
            <option value="selected_catalog_rows">Selected catalog rows</option>
            <option value="manual_targets">Manual targets</option>
            <option value="all_matching">All matching filters</option>
          </select>
        </label>
        <label className="text-sm font-medium text-foreground">
          Manual tickers
          <textarea value={manualTargets} onChange={(event) => setManualTargets(event.target.value)} rows={4} className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm" />
        </label>
      </div>
      <button type="button" onClick={() => void runPreview()} className="mt-4 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Preview backfill
      </button>
      {preview && (
        <div className="mt-4 space-y-4">
          <PreviewSummary title="Backfill estimate" rows={[
            ["Provider", preview.providerId],
            ["Matches", String(preview.matchCount)],
            ["Jobs", String(preview.estimatedJobCount)],
            ["Affected users", String(preview.affectedUserCount)],
            ["Affected accounts", String(preview.affectedAccountCount)],
            ["Confirmation", preview.confirmation.text ?? preview.confirmation.level],
          ]} />
          {preview.confirmation.level === "typed" ? (
            <label className="block text-sm font-medium text-foreground">
              Type confirmation
              <input
                value={typedConfirmation}
                onChange={(event) => setTypedConfirmation(event.target.value)}
                placeholder={preview.confirmation.text ?? ""}
                className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          ) : (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              I reviewed the preview and understand this queues provider-owned backfill jobs.
            </label>
          )}
          <button
            type="button"
            onClick={() => void runExecute()}
            disabled={preview.confirmation.level === "typed" ? typedConfirmation !== preview.confirmation.text : !acknowledged}
            className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            Execute backfill
          </button>
        </div>
      )}
      {executeResult && <PreviewSummary title="Backfill operation" rows={[
        ["Operation", executeResult.operationId],
        ["Status", executeResult.status],
        ["Enqueued", String(executeResult.enqueuedJobCount)],
        ["Skipped existing", String(executeResult.skippedExistingJobCount)],
        ["Batch", executeResult.batchId ?? "none"],
      ]} />}
    </Card>
  );
}

const yahooKrProviderId = "yahoo-finance-kr";
const yahooKrErrorCode = "yahoo_finance_kr_symbol_unresolved";

function formatTimestamp(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function unresolvedItemKey(item: Pick<ProviderUnresolvedItemDto, "providerId" | "marketCode" | "errorCode" | "sourceSymbol">): string {
  return `${item.providerId}:${item.marketCode}:${item.errorCode}:${item.sourceSymbol}`;
}

function mappingLinkedOperation(evidence: Record<string, unknown> | null): string | null {
  const raw = evidence?.operationId ?? evidence?.providerOperationId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function mappingEvidenceSummary(mapping: ProviderResolutionMappingDto): string {
  const evidence = mapping.evidence;
  for (const key of ["candidate", "candidateSymbol", "exchangeHint", "note"]) {
    const value = evidence?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Stored durable mapping";
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function exportUnresolvedCsv(items: ProviderUnresolvedItemDto[], filename: string) {
  const headers = [
    "providerId",
    "marketCode",
    "errorCode",
    "sourceSymbol",
    "providerSymbol",
    "state",
    "occurrenceCount",
    "firstSeenAt",
    "lastSeenAt",
    "updatedAt",
    "resolvedAt",
    "resolvedByOperationId",
  ];
  const rows = items.map((item) => [
    item.providerId,
    item.marketCode,
    item.errorCode,
    item.sourceSymbol,
    item.providerSymbol ?? "",
    item.state,
    item.occurrenceCount,
    item.firstSeenAt,
    item.lastSeenAt,
    item.updatedAt,
    item.resolvedAt ?? "",
    item.resolvedByOperationId ?? "",
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

function krMappingsPath(query: Partial<KrMappingsData["query"]>): string {
  const params = new URLSearchParams();
  const merged: KrMappingsData["query"] = {
    unresolvedPage: query.unresolvedPage ?? 1,
    unresolvedLimit: query.unresolvedLimit ?? 25,
    unresolvedState: query.unresolvedState ?? "active",
    unresolvedSearch: query.unresolvedSearch ?? "",
    unresolvedSort: query.unresolvedSort ?? "last_seen_desc",
    mappingsPage: query.mappingsPage ?? 1,
    mappingsLimit: query.mappingsLimit ?? 25,
    mappingsSearch: query.mappingsSearch ?? "",
  };
  if (merged.unresolvedPage !== 1) params.set("unresolvedPage", String(merged.unresolvedPage));
  if (merged.unresolvedLimit !== 25) params.set("unresolvedLimit", String(merged.unresolvedLimit));
  if (merged.unresolvedState !== "active") params.set("unresolvedState", merged.unresolvedState);
  if (merged.unresolvedSearch.trim()) params.set("unresolvedSearch", merged.unresolvedSearch.trim());
  if (merged.unresolvedSort !== "last_seen_desc") params.set("unresolvedSort", merged.unresolvedSort);
  if (merged.mappingsPage !== 1) params.set("mappingsPage", String(merged.mappingsPage));
  if (merged.mappingsLimit !== 25) params.set("mappingsLimit", String(merged.mappingsLimit));
  if (merged.mappingsSearch.trim()) params.set("mappingsSearch", merged.mappingsSearch.trim());
  const queryString = params.toString();
  return `/admin/market-data/KR/mappings${queryString ? `?${queryString}` : ""}`;
}

function MappingsPanel({
  marketCode,
  actions,
  krMappings,
}: {
  marketCode: AdminMarketCode;
  actions: AdminMarketDataActionDto[];
  krMappings: KrMappingsData | null;
}) {
  if (marketCode !== "KR" || !krMappings) {
    return (
      <Card className="px-5 py-4 hover:translate-y-0" data-testid="market-data-mappings">
        <h2 className="text-base font-semibold text-foreground">Provider mappings</h2>
        <p className="mt-2 text-sm text-muted-foreground">Mappings are not available for this market.</p>
      </Card>
    );
  }
  return <KrMappingsPanel actions={actions} data={krMappings} />;
}

function KrMappingsPanel({
  actions,
  data,
}: {
  actions: AdminMarketDataActionDto[];
  data: KrMappingsData;
}) {
  const router = useRouter();
  const mappingAction = actions.find((action) => action.action === "repair_mapping");
  const [unresolvedSearch, setUnresolvedSearch] = useState(data.query.unresolvedSearch);
  const [unresolvedState, setUnresolvedState] = useState<ProviderUnresolvedListState>(data.query.unresolvedState);
  const [unresolvedSort, setUnresolvedSort] = useState<KrMappingsData["query"]["unresolvedSort"]>(data.query.unresolvedSort);
  const [mappingsSearch, setMappingsSearch] = useState(data.query.mappingsSearch);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProviderFixerDashboardOperationDto | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [revertTarget, setRevertTarget] = useState<string | null>(null);
  const [revertConfirmation, setRevertConfirmation] = useState("");

  useEffect(() => {
    setUnresolvedSearch(data.query.unresolvedSearch);
    setUnresolvedState(data.query.unresolvedState);
    setUnresolvedSort(data.query.unresolvedSort);
    setMappingsSearch(data.query.mappingsSearch);
    setSelectedKeys(new Set());
    setAllMatchingSelected(false);
  }, [data.query]);

  const visibleItems = data.unresolved.items;
  const visibleKeys = visibleItems.map(unresolvedItemKey);
  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));
  const selectedItems = visibleItems.filter((item) => selectedKeys.has(unresolvedItemKey(item)));
  const selectedCount = allMatchingSelected ? data.unresolved.total : selectedItems.length;
  const activeFilterSelected = data.query.unresolvedState === "active";

  function pushQuery(next: Partial<KrMappingsData["query"]>) {
    router.push(krMappingsPath({ ...data.query, ...next }));
  }

  function selectedScope() {
    if (allMatchingSelected) {
      return {
        type: "filter" as const,
        marketCode: "KR" as const,
        errorCode: yahooKrErrorCode,
        state: "active" as const,
        ...(data.query.unresolvedSearch.trim() ? { search: data.query.unresolvedSearch.trim() } : {}),
      };
    }
    return {
      type: "selected_items" as const,
      items: selectedItems.map((item) => ({
        providerId: item.providerId,
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
      })),
    };
  }

  function toggleVisible(checked: boolean) {
    setAllMatchingSelected(false);
    setSelectedKeys((current) => {
      const next = new Set(current);
      for (const item of visibleItems) {
        const key = unresolvedItemKey(item);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  async function runWithMessage<T>(label: string, task: () => Promise<T>, success: (result: T) => string) {
    setBusyAction(label);
    setMessage(null);
    try {
      const result = await task();
      setMessage(success(result));
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  }

  async function setUnresolvedStateForItem(item: ProviderUnresolvedItemDto, state: Exclude<ProviderUnresolvedItemDto["state"], "resolved">) {
    await runWithMessage(
      `state-${item.sourceSymbol}`,
      () => updateProviderUnresolvedState({
        providerId: item.providerId,
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
        state,
      }),
      (result) => `Set unresolved item ${result.item.sourceSymbol} to ${result.item.state}.`,
    );
  }

  async function bulkSetState(state: "unsupported" | "ignored") {
    if (selectedCount === 0) return;
    const scope = selectedScope();
    const typedConfirmationForFilter = scope.type === "filter"
      ? state === "ignored"
        ? `IGNORE ${selectedCount} MATCHING ACTIVE`
        : `MARK ${selectedCount} MATCHING UNSUPPORTED`
      : undefined;
    await runWithMessage(
      `bulk-${state}`,
      () => bulkUpdateProviderUnresolvedState({
        providerId: yahooKrProviderId,
        state,
        scope,
        acknowledged: scope.type === "selected_items",
        typedConfirmation: typedConfirmationForFilter,
      }),
      (result) => `Updated ${result.updatedCount} unresolved rows.`,
    );
  }

  async function previewSelectedRepair() {
    if (selectedCount === 0) return;
    await runWithMessage(
      "preview-repair",
      () => previewProviderRepair({
        providerId: yahooKrProviderId,
        marketCode: "KR",
        errorCode: yahooKrErrorCode,
        resolverMode: "quote_first",
        scope: selectedScope(),
      }),
      (result) => {
        setPreview(result.operation);
        setTypedConfirmation("");
        setAcknowledged(false);
        return `Repair preview created for ${result.operation.matchCount} rows.`;
      },
    );
  }

  async function renewSelectedEvidence() {
    if (selectedCount === 0) return;
    await runWithMessage(
      "renew-evidence",
      () => renewProviderEvidence({
        providerId: yahooKrProviderId,
        marketCode: "KR",
        errorCode: yahooKrErrorCode,
        resolverMode: "quote_first",
        scope: selectedScope(),
      }),
      (result) => `Renew evidence started: ${result.operation.id}`,
    );
  }

  async function executePreview() {
    if (!preview?.preview.token) return;
    await runWithMessage(
      "execute-repair",
      () => executeProviderRepair({
        providerId: yahooKrProviderId,
        operationId: preview.id,
        previewToken: preview.preview.token,
        acknowledged: true,
        typedConfirmation: preview.preview.confirmationText ?? typedConfirmation,
      }),
      (result) => {
        setPreview(result.operation);
        return `Repair operation ${result.operation.id} started.`;
      },
    );
  }

  const executeDisabled = !preview
    || busyAction !== null
    || (preview.preview.confirmationText ? typedConfirmation !== preview.preview.confirmationText : !acknowledged);

  return (
    <div className="space-y-5" data-testid="market-data-mappings">
      <Card className="px-5 py-4 hover:translate-y-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">KR mapping repair</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Repair persists verified Yahoo Finance KR mappings only. Backfill after mapping is a separate explicit action.
            </p>
          </div>
          {mappingAction ? <ActionChips marketCode="KR" actions={[mappingAction]} /> : null}
        </div>
        {message ? <p className="mt-4 rounded border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{message}</p> : null}
      </Card>

      <Card className="overflow-hidden p-0 hover:translate-y-0">
        <div className="border-b border-border px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-base font-semibold text-foreground">Unique unresolved instruments</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Durable unresolved rows from Yahoo Finance KR. Resolver behavior is unchanged; this panel only scopes admin repair work.
              </p>
            </div>
            <button
              type="button"
              disabled={selectedCount === 0 || busyAction !== null}
              onClick={() => void previewSelectedRepair()}
              className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Repair selected
            </button>
          </div>
          <form
            className="mt-4 grid gap-3 lg:grid-cols-[minmax(10rem,1fr)_12rem_14rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              pushQuery({
                unresolvedPage: 1,
                unresolvedSearch,
                unresolvedState,
                unresolvedSort,
              });
            }}
          >
            <label className="text-sm font-medium text-foreground">
              Search
              <input
                value={unresolvedSearch}
                onChange={(event) => setUnresolvedSearch(event.target.value)}
                placeholder="Search symbol, provider symbol, error"
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                data-testid="provider-console-unresolved-search"
              />
            </label>
            <label className="text-sm font-medium text-foreground">
              State
              <select
                value={unresolvedState}
                onChange={(event) => setUnresolvedState(event.target.value as ProviderUnresolvedListState)}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                data-testid="provider-console-unresolved-state"
              >
                <option value="active">active</option>
                <option value="all">all</option>
                <option value="resolved">resolved</option>
                <option value="unsupported">unsupported</option>
                <option value="ignored">ignored</option>
              </select>
            </label>
            <label className="text-sm font-medium text-foreground">
              Sort
              <select
                value={unresolvedSort}
                onChange={(event) => setUnresolvedSort(event.target.value as KrMappingsData["query"]["unresolvedSort"])}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                data-testid="provider-console-unresolved-sort"
              >
                <option value="last_seen_desc">last seen</option>
                <option value="updated_desc">recently updated</option>
                <option value="occurrence_count_desc">most occurrences</option>
                <option value="source_symbol_asc">source symbol</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
                data-testid="provider-console-unresolved-apply"
              >
                Apply filters
              </button>
            </div>
          </form>
          <div className="mt-4 flex flex-col gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between" data-testid="provider-console-selection-banner">
            <span><strong>{selectedCount.toLocaleString()} rows selected.</strong> {data.unresolved.total.toLocaleString()} rows match this filter.</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!activeFilterSelected || data.unresolved.total === 0}
                onClick={() => {
                  setSelectedKeys(new Set());
                  setAllMatchingSelected((current) => !current);
                }}
                className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
                data-testid="provider-console-select-all-matching"
              >
                {allMatchingSelected ? "Clear all matching" : "Select all matching"}
              </button>
              <button type="button" disabled={selectedCount === 0 || busyAction !== null} onClick={() => void previewSelectedRepair()} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50">Repair</button>
              <button type="button" disabled={selectedCount === 0 || busyAction !== null} onClick={() => void renewSelectedEvidence()} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50" data-testid="provider-console-bulk-renew">Renew</button>
              <button type="button" disabled={selectedCount === 0 || busyAction !== null} onClick={() => void bulkSetState("ignored")} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50" data-testid="provider-console-bulk-ignore">Ignore</button>
              <button type="button" disabled={selectedCount === 0 || busyAction !== null} onClick={() => void bulkSetState("unsupported")} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50" data-testid="provider-console-bulk-unsupported">Unsupported</button>
              <button
                type="button"
                disabled={visibleItems.length === 0}
                onClick={() => exportUnresolvedCsv(visibleItems, "yahoo-finance-kr-unresolved.csv")}
                className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
                data-testid="provider-console-unresolved-export"
              >
                Export CSV
              </button>
              <button type="button" disabled={selectedCount === 0} onClick={() => { setSelectedKeys(new Set()); setAllMatchingSelected(false); }} className="rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-50">Clear selection</button>
              <button type="button" onClick={() => pushQuery({ unresolvedState: "resolved", unresolvedSort: "updated_desc", unresolvedPage: 1 })} className="rounded border border-border bg-background px-2 py-1 text-xs" data-testid="provider-console-recently-resolved">Recently resolved</button>
            </div>
          </div>
          {preview ? (
            <div className="mt-4 rounded border border-border bg-muted/30 p-4">
              <h4 className="text-sm font-semibold text-foreground">Repair preview</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Operation {preview.id} matches {preview.matchCount.toLocaleString()} rows. Execute uses the frozen preview token.
              </p>
              {preview.preview.confirmationText ? (
                <label className="mt-3 block text-sm font-medium text-foreground">
                  Type confirmation
                  <input
                    value={typedConfirmation}
                    onChange={(event) => setTypedConfirmation(event.target.value)}
                    placeholder={preview.preview.confirmationText}
                    className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm"
                  />
                </label>
              ) : (
                <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                  I reviewed the preview and understand this writes verified KR mappings only.
                </label>
              )}
              <button
                type="button"
                disabled={executeDisabled}
                onClick={() => void executePreview()}
                className="mt-3 rounded bg-foreground px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                Execute operation
              </button>
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-3">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={visibleItems.length === 0 || allMatchingSelected}
                    onChange={(event) => toggleVisible(event.target.checked)}
                    aria-label="Select visible rows"
                    data-testid="provider-console-select-visible"
                  />
                </th>
                <th className="px-5 py-3">Source symbol</th>
                <th className="px-5 py-3">State</th>
                <th className="px-5 py-3">Evidence</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleItems.map((item) => {
                const key = unresolvedItemKey(item);
                const selected = selectedKeys.has(key);
                return (
                  <tr key={key}>
                    <td className="px-5 py-4">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={allMatchingSelected}
                        onChange={(event) => {
                          setSelectedKeys((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(key);
                            else next.delete(key);
                            return next;
                          });
                        }}
                        aria-label={`Select ${item.sourceSymbol}`}
                        data-testid={`provider-console-select-row-${item.sourceSymbol}`}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-mono font-semibold text-foreground">{item.sourceSymbol}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.providerSymbol ?? item.sourceSymbol}</p>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">{item.state}</td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {item.occurrenceCount.toLocaleString()} occurrences; last seen {formatTimestamp(item.lastSeenAt)}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        {item.state !== "active" ? (
                          <button type="button" disabled={busyAction !== null} onClick={() => void setUnresolvedStateForItem(item, "active")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-unresolved-reopen-${item.sourceSymbol}`}>Reopen</button>
                        ) : (
                          <>
                            <button type="button" disabled={busyAction !== null} onClick={() => void setUnresolvedStateForItem(item, "unsupported")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-unresolved-unsupported-${item.sourceSymbol}`}>Unsupported</button>
                            <button type="button" disabled={busyAction !== null} onClick={() => void setUnresolvedStateForItem(item, "ignored")} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-unresolved-ignore-${item.sourceSymbol}`}>Ignore</button>
                          </>
                        )}
                        <button type="button" disabled={item.state !== "resolved" || busyAction !== null} onClick={() => pushQuery({ mappingsSearch: item.sourceSymbol, mappingsPage: 1 })} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-unresolved-rerun-${item.sourceSymbol}`}>Rerun</button>
                      </div>
                      <p className="mt-1 text-right text-xs text-muted-foreground">Rerun requires resolved mapping.</p>
                    </td>
                  </tr>
                );
              })}
              {visibleItems.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-sm text-muted-foreground">No unresolved rows match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 border-t border-border px-5 py-4 text-sm">
          <Link className="rounded border border-border px-3 py-2" href={krMappingsPath({ ...data.query, unresolvedPage: Math.max(1, data.query.unresolvedPage - 1) })}>Previous</Link>
          <Link className="rounded border border-border px-3 py-2" href={krMappingsPath({ ...data.query, unresolvedPage: data.query.unresolvedPage + 1 })}>Next</Link>
        </div>
      </Card>

      <Card className="overflow-hidden p-0 hover:translate-y-0">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">Durable KR mappings</h3>
          <p className="mt-1 text-sm text-muted-foreground">Stored Yahoo Finance KR bindings with evidence and operation links.</p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              pushQuery({ mappingsSearch, mappingsPage: 1 });
            }}
          >
            <input
              value={mappingsSearch}
              onChange={(event) => setMappingsSearch(event.target.value)}
              placeholder="Source symbol, provider symbol, or operation ID"
              className="rounded border border-border bg-background px-3 py-2 text-sm"
              data-testid="provider-console-mappings-search"
            />
            <button type="submit" className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Search mappings</button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Resolved</th>
                <th className="px-5 py-3">Evidence</th>
                <th className="px-5 py-3">Links</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.mappings.items.map((mapping) => {
                const key = `${mapping.providerId}:${mapping.marketCode}:${mapping.sourceSymbol}`;
                const linkedOperationId = mappingLinkedOperation(mapping.evidence);
                const phrase = `REVERT ${mapping.sourceSymbol}`;
                const revertOpen = revertTarget === key;
                const revertReady = revertConfirmation.trim() === phrase;
                return (
                  <tr key={key}>
                    <td className="px-5 py-4 font-mono font-semibold text-foreground">{mapping.sourceSymbol}</td>
                    <td className="px-5 py-4 font-mono text-muted-foreground">{mapping.resolvedSymbol}</td>
                    <td className="px-5 py-4 text-muted-foreground">{mappingEvidenceSummary(mapping)}; verified {formatTimestamp(mapping.verifiedAt)}</td>
                    <td className="px-5 py-4 text-xs">
                      <button
                        type="button"
                        className="block font-mono text-primary underline-offset-4 hover:underline"
                        onClick={() => pushQuery({ unresolvedState: "all", unresolvedSearch: mapping.sourceSymbol, unresolvedPage: 1 })}
                        data-testid={`provider-console-mapping-unresolved-link-${mapping.sourceSymbol}`}
                      >
                        Unresolved: {mapping.sourceSymbol}
                      </button>
                      {linkedOperationId ? (
                        <Link
                          className="mt-1 block font-mono text-primary underline-offset-4 hover:underline"
                          href={`/admin/market-data/KR/operations?providerId=${encodeURIComponent(mapping.providerId)}&operationId=${encodeURIComponent(linkedOperationId)}`}
                          data-testid={`provider-console-mapping-operation-link-${mapping.sourceSymbol}`}
                        >
                          Operation: {linkedOperationId}
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button type="button" disabled={busyAction !== null} onClick={() => void runWithMessage("reverify", () => reverifyProviderMapping({ providerId: mapping.providerId, mapping, resolverMode: "quote_first" }), (result) => `Reverify started: ${result.operation.id}`)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-mapping-reverify-${mapping.sourceSymbol}`}>Reverify</button>
                        <button type="button" disabled={busyAction !== null} onClick={() => void runWithMessage("rerun-mapping", () => rerunProviderMapping({ providerId: mapping.providerId, mapping, resolverMode: "quote_first" }), (result) => `Rerun queued: ${result.operation.id}`)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-mapping-rerun-${mapping.sourceSymbol}`}>Rerun</button>
                        <button type="button" disabled={busyAction !== null} onClick={() => { setRevertTarget(revertOpen ? null : key); setRevertConfirmation(""); }} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50" data-testid={`provider-console-mapping-revert-open-${mapping.sourceSymbol}`}>Revert</button>
                      </div>
                      {revertOpen ? (
                        <div className="mt-3 grid gap-2">
                          <p className="text-xs text-red-700">Type {phrase} to remove this mapping.</p>
                          <input
                            value={revertConfirmation}
                            onChange={(event) => setRevertConfirmation(event.target.value)}
                            placeholder={phrase}
                            className="rounded border border-red-300 bg-background px-3 py-2 text-sm"
                            data-testid={`provider-console-mapping-revert-confirmation-${mapping.sourceSymbol}`}
                          />
                          <button
                            type="button"
                            disabled={!revertReady || busyAction !== null}
                            onClick={() => void runWithMessage("revert-mapping", () => revertProviderMapping({ providerId: mapping.providerId, mapping, typedConfirmation: revertConfirmation.trim() }), (result) => `Revert started: ${result.operation.id}`)}
                            className="rounded bg-destructive px-3 py-2 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                            data-testid={`provider-console-mapping-revert-execute-${mapping.sourceSymbol}`}
                          >
                            Execute revert
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {data.mappings.items.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-sm text-muted-foreground">No durable mappings match this filter.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2 border-t border-border px-5 py-4 text-sm">
          <Link className="rounded border border-border px-3 py-2" href={krMappingsPath({ ...data.query, mappingsPage: Math.max(1, data.query.mappingsPage - 1) })}>Previous</Link>
          <Link className="rounded border border-border px-3 py-2" href={krMappingsPath({ ...data.query, mappingsPage: data.query.mappingsPage + 1 })}>Next</Link>
        </div>
      </Card>
    </div>
  );
}

function PurgePanel({ marketCode }: { marketCode: Exclude<AdminMarketCode, "FX"> }) {
  const [selected, setSelected] = useState<AdminMarketDataPurgeCategory[]>(["price_bars"]);
  const [enqueueBackfill, setEnqueueBackfill] = useState(false);
  const [fullHistory, setFullHistory] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [preview, setPreview] = useState<AdminMarketDataPurgePreviewResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<AdminMarketDataPurgeExecuteResponse | null>(null);

  function toggle(category: AdminMarketDataPurgeCategory) {
    setSelected((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }

  async function runPreview() {
    const result = await previewMarketPurge(marketCode, {
      categories: selected,
      fullHistory,
      startDate: fullHistory || !startDate ? undefined : startDate,
      endDate: fullHistory || !endDate ? undefined : endDate,
      enqueueBackfillAfterPurge: enqueueBackfill,
    });
    setPreview(result);
    setExecuteResult(null);
    setTypedConfirmation("");
  }

  async function runExecute() {
    const result = await executeMarketPurge(marketCode, {
      categories: selected,
      fullHistory,
      startDate: fullHistory || !startDate ? undefined : startDate,
      endDate: fullHistory || !endDate ? undefined : endDate,
      enqueueBackfillAfterPurge: enqueueBackfill,
      typedConfirmation,
    });
    setExecuteResult(result);
  }

  return (
    <Card className="px-5 py-4 hover:translate-y-0" data-testid="market-data-purge">
      <h2 className="text-base font-semibold text-foreground">Purge data preview</h2>
      <p className="mt-2 text-sm text-muted-foreground">Delete-only removes selected data. Delete-then-refill also queues a backfill when the selected category supports refill.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {purgeCategories.map((category) => (
          <label key={category.value} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm">
            <input type="checkbox" checked={selected.includes(category.value)} onChange={() => toggle(category.value)} />
            {category.label}
          </label>
        ))}
      </div>
      <div className="mt-4 rounded border border-border p-3">
        <p className="text-sm font-medium text-foreground">Price/dividend range</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={fullHistory}
              onChange={(event) => setFullHistory(event.target.checked)}
            />
            Full history
          </label>
          <label className="text-sm font-medium text-foreground">
            Start date
            <input
              type="date"
              value={startDate}
              disabled={fullHistory}
              onChange={(event) => setStartDate(event.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
            />
          </label>
          <label className="text-sm font-medium text-foreground">
            End date
            <input
              type="date"
              value={endDate}
              disabled={fullHistory}
              onChange={(event) => setEndDate(event.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Date range applies to price bars and dividends. Provider logs, outcomes, mappings, enrichment, and admin state use operation or target scope instead.
        </p>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={enqueueBackfill} onChange={(event) => setEnqueueBackfill(event.target.checked)} />
        Enqueue backfill after purge where supported
      </label>
      <button type="button" onClick={() => void runPreview()} className="mt-4 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Preview purge
      </button>
      {preview && (
        <div className="mt-4 space-y-4">
          <PreviewSummary title="Purge estimate" rows={[
            ["Provider", preview.providerId],
            ["Categories", preview.categories.join(", ")],
            ["Affected instruments", String(preview.affectedInstrumentCount)],
            ["Estimated rows", preview.estimatedRows == null ? "unknown" : String(preview.estimatedRows)],
            ["Linked refill", preview.linkedRefill.available ? preview.linkedRefill.mode ?? "available" : preview.linkedRefill.warning ?? "not available"],
            ["Confirmation", preview.confirmation.text ?? preview.confirmation.level],
          ]} />
          {preview.unsupportedCategories.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {preview.unsupportedCategories.map((item) => (
                <p key={item.category}>{item.category}: {item.reason}</p>
              ))}
            </div>
          )}
          <label className="block text-sm font-medium text-foreground">
            Type confirmation
            <input
              value={typedConfirmation}
              onChange={(event) => setTypedConfirmation(event.target.value)}
              placeholder={preview.confirmation.text ?? ""}
              className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void runExecute()}
            disabled={typedConfirmation !== preview.confirmation.text}
            className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            Execute purge
          </button>
        </div>
      )}
      {executeResult && <PreviewSummary title="Purge operation" rows={[
        ["Operation", executeResult.operationId],
        ["Deleted rows", executeResult.deletedRows == null ? "unknown" : String(executeResult.deletedRows)],
        ["Affected instruments", String(executeResult.affectedInstrumentCount)],
        ["Linked backfill", executeResult.linkedBackfillOperationId ?? "none"],
      ]} />}
    </Card>
  );
}

function RefreshRatesPanel({ actions }: { actions: AdminMarketDataActionDto[] }) {
  return (
    <Card className="px-5 py-4 hover:translate-y-0" data-testid="market-data-refresh-rates">
      <h2 className="text-base font-semibold text-foreground">FX refresh</h2>
      <p className="mt-2 text-sm text-muted-foreground">FX is lightweight here: refresh rates, operations, and logs only.</p>
      <div className="mt-4"><ActionChips marketCode="FX" actions={actions} /></div>
    </Card>
  );
}

function OperationsPanel({ operations }: { operations: AdminMarketDataOperationsResponse }) {
  return (
    <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="market-data-operations">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">Operations</h2>
      </div>
      <ul className="divide-y divide-border">
        {operations.items.map((operation) => (
          <li key={operation.id} className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="font-medium text-foreground">{operation.id}</p>
              <p className="mt-1 text-muted-foreground">{operation.providerId} - {operation.phase}</p>
            </div>
            <p className="text-muted-foreground">{operation.matchCount.toLocaleString()} matches</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LogsPanel({ logs }: { logs: AdminMarketDataLogsResponse }) {
  return (
    <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="market-data-logs">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">Logs</h2>
      </div>
      <ul className="divide-y divide-border">
        {logs.items.map((log) => (
          <li key={log.id} className="px-5 py-4 text-sm">
            <p className="font-medium text-foreground">{log.message}</p>
            <p className="mt-1 text-muted-foreground">{log.operationId} - {log.phase} - {log.occurredAt}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PreviewSummary({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div className="mt-4 rounded border border-border bg-muted/30 p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
