"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  AdminMarketDataDelistingOverrideAction,
  AdminMarketDataBackfillTargetDto,
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
  AdminMarketDataPurgePreviewRequest,
  AdminMarketDataPurgePreviewResponse,
  AdminMarketWorkspaceTab,
} from "@vakwen/shared-types";
import { cn } from "../../lib/utils";
import {
  executeMarketBackfill,
  executeMarketAction,
  executeMarketPurge,
  previewMarketBackfill,
  previewMarketPurge,
  updateMarketInstrumentDelistingOverride,
  updateMarketInstrumentSupportState,
} from "../../lib/adminMarketDataService";
import { Card } from "../ui/Card";
import { KrOperationsPanel, MappingsPanel, type KrMappingsData, type KrOperationsData } from "./AdminMarketDataKrResolver";
import { formatUtcTimestamp } from "./adminFormat";

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
  providerFilterId?: string;
  krMappings: KrMappingsData | null;
  krOperations?: KrOperationsData | null;
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
  providerFilterId = "",
  krMappings,
  krOperations,
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
      {safeTab === "backfill" && marketCode !== "FX" && instruments && (
        <BackfillPanel
          marketCode={marketCode}
          actions={actions}
          instruments={instruments}
          initialQuery={instrumentQuery ?? defaultInstrumentQuery(instruments)}
        />
      )}
      {safeTab === "mappings" && <MappingsPanel marketCode={marketCode} actions={actions} krMappings={krMappings} />}
      {safeTab === "purge" && marketCode !== "FX" && <PurgePanel marketCode={marketCode} />}
      {safeTab === "refresh-rates" && <RefreshRatesPanel actions={actions} />}
      {safeTab === "operations" && marketCode === "KR" && krOperations
        ? <KrOperationsPanel data={krOperations} />
        : safeTab === "operations" && operations
          ? <OperationsPanel operations={operations} currentProviderId={providerFilterId} />
          : null}
      {safeTab === "logs" && logs && <LogsPanel logs={logs} currentProviderId={providerFilterId} />}
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

function queryPath(marketCode: string, tab: "instruments" | "backfill", query: InstrumentQuery, page = query.page): string {
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
  return `/admin/market-data/${marketCode}/${tab}?${params.toString()}`;
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
    router.push(queryPath(instruments.marketCode, "instruments", { ...filters, page: 1 }, 1));
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
            href={queryPath(instruments.marketCode, "instruments", filters, Math.max(1, instruments.page - 1))}
            aria-disabled={instruments.page <= 1}
            className={cn(
              "rounded border border-border px-3 py-2",
              instruments.page <= 1 && "pointer-events-none opacity-50",
            )}
          >
            Previous
          </Link>
          <Link
            href={queryPath(instruments.marketCode, "instruments", filters, Math.min(totalPages, instruments.page + 1))}
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

function targetFromInstrument(row: AdminMarketDataInstrumentDto): AdminMarketDataBackfillTargetDto {
  return {
    ticker: row.ticker,
    marketCode: row.marketCode,
    name: row.name,
    instrumentType: row.instrumentType,
    status: row.status,
    supportState: row.supportState,
    backfillStatus: row.backfillStatus,
    providerIds: row.providerIds,
  };
}

function BackfillPanel({
  marketCode,
  actions,
  instruments,
  initialQuery,
}: {
  marketCode: Exclude<AdminMarketCode, "FX">;
  actions: AdminMarketDataActionDto[];
  instruments: AdminMarketDataInstrumentsResponse;
  initialQuery: InstrumentQuery;
}) {
  const router = useRouter();
  const backfillActions = actions.filter((item) => item.action === "backfill_catalog_rows" && item.supported);
  const [mode, setMode] = useState<"owned" | "supported">("owned");
  const [filters, setFilters] = useState<InstrumentQuery>(initialQuery);
  const [providerId, setProviderId] = useState(backfillActions[0]?.providerId ?? actions.find((item) => item.action === "backfill_catalog_rows")?.providerId ?? "");
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [includeDemoUsers, setIncludeDemoUsers] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [preview, setPreview] = useState<AdminMarketDataBackfillPreviewResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<AdminMarketDataBackfillExecuteResponse | null>(null);
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [targetModalFilter, setTargetModalFilter] = useState("");
  const totalPages = Math.max(1, Math.ceil(instruments.total / instruments.limit));
  const selectedRows = instruments.items
    .filter((row) => selectedTickers.includes(row.ticker))
    .map(targetFromInstrument);
  const selectedRequestTargets = selectedRows.map((row) => ({
    ticker: row.ticker,
    marketCode: row.marketCode,
  }));
  const previewTargets = preview?.targets ?? [];
  const filteredPreviewTargets = previewTargets.filter((target) => {
    const query = targetModalFilter.trim().toUpperCase();
    return !query || target.ticker.toUpperCase().includes(query) || (target.name ?? "").toUpperCase().includes(query);
  });

  useEffect(() => {
    setFilters(initialQuery);
  }, [initialQuery]);

  function clearFrozenPreview() {
    setPreview(null);
    setExecuteResult(null);
    setAcknowledged(false);
    setTypedConfirmation("");
  }

  function updateMode(nextMode: "owned" | "supported") {
    setMode(nextMode);
    clearFrozenPreview();
  }

  function updateProvider(nextProviderId: string) {
    setProviderId(nextProviderId);
    clearFrozenPreview();
  }

  function updateFilter(key: keyof InstrumentQuery, value: string) {
    setFilters((current) => ({ ...current, [key]: key === "limit" ? Number.parseInt(value, 10) || current.limit : value }));
    clearFrozenPreview();
  }

  function applyFilters() {
    clearFrozenPreview();
    router.push(queryPath(instruments.marketCode, "backfill", { ...filters, page: 1 }, 1));
  }

  function toggleTicker(ticker: string) {
    setSelectedTickers((current) => current.includes(ticker) ? current.filter((item) => item !== ticker) : [...current, ticker]);
    clearFrozenPreview();
  }

  function setDemoUsers(checked: boolean) {
    setIncludeDemoUsers(checked);
    clearFrozenPreview();
  }

  function previewFilters(): Record<string, string | number | boolean | null> {
    const scoped = (value: string) => value === "all" ? null : value;
    return {
      status: scoped(filters.status),
      supportState: scoped(filters.supportState),
      search: filters.search.trim() || null,
      instrumentType: scoped(filters.instrumentType),
      backfillStatus: scoped(filters.backfillStatus),
      sort: filters.sort === "ticker_asc" ? null : filters.sort,
    };
  }

  async function runPreview(scope: "user_owned_or_monitored" | "selected_catalog_rows" | "all_matching") {
    const result = await previewMarketBackfill(marketCode, {
      scope,
      providerId,
      includeDemoUsers: scope === "user_owned_or_monitored" ? includeDemoUsers : undefined,
      selectedCatalogRows: scope === "selected_catalog_rows" ? selectedRequestTargets : undefined,
      filters: scope === "all_matching" ? previewFilters() : undefined,
    });
    setPreview(result);
    setExecuteResult(null);
    setAcknowledged(false);
    setTypedConfirmation("");
  }

  async function runExecute() {
    const result = await executeMarketBackfill(marketCode, {
      operationId: preview?.operationId ?? "",
      previewToken: preview?.previewToken ?? "",
      acknowledged,
      typedConfirmation,
    });
    setExecuteResult(result);
  }

  return (
    <Card className="px-5 py-4 hover:translate-y-0" data-testid="market-data-backfill">
      <h2 className="text-base font-semibold text-foreground">Backfill preview</h2>
      <p className="mt-2 text-sm text-muted-foreground">Backfill writes historical bars and dividends from the owning provider. Preview freezes the exact target list before execution.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <label className="text-sm font-medium text-foreground">
            Backfill mode
            <select value={mode} onChange={(event) => updateMode(event.target.value as "owned" | "supported")} className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm">
              <option value="owned">Owned or monitored</option>
              <option value="supported">Supported instruments</option>
            </select>
          </label>
          {backfillActions.length > 1 ? (
            <label className="text-sm font-medium text-foreground">
              Provider
              <select value={providerId} onChange={(event) => updateProvider(event.target.value)} className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm">
                {backfillActions.map((action) => (
                  <option key={action.providerId} value={action.providerId}>{action.providerId}</option>
                ))}
              </select>
            </label>
          ) : (
            <div className="rounded border border-border px-3 py-2 text-sm text-muted-foreground">
              Provider <span className="font-medium text-foreground">{providerId || "unassigned"}</span>
            </div>
          )}
          {mode === "owned" ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={includeDemoUsers} onChange={(event) => setDemoUsers(event.target.checked)} />
              Include demo users
            </label>
          ) : null}
        </div>
        <div className="rounded border border-border p-4">
          {mode === "owned" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This collects all supported instruments that appear in open positions or monitored tickers across users. Demo users are excluded unless selected.
              </p>
              <button type="button" onClick={() => void runPreview("user_owned_or_monitored")} className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Preview owned or monitored
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_repeat(4,minmax(8rem,10rem))_minmax(9rem,auto)]">
                <label className="text-sm font-medium text-foreground">
                  Search
                  <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm" placeholder="Ticker or name" />
                </label>
                <FilterSelect label="Status" value={filters.status} options={instruments.filters.status} onChange={(value) => updateFilter("status", value)} />
                <FilterSelect label="Support" value={filters.supportState} options={instruments.filters.supportState} onChange={(value) => updateFilter("supportState", value)} />
                <FilterSelect label="Type" value={filters.instrumentType} options={instruments.filters.instrumentType} onChange={(value) => updateFilter("instrumentType", value)} />
                <FilterSelect label="Backfill" value={filters.backfillStatus} options={instruments.filters.backfillStatus} onChange={(value) => updateFilter("backfillStatus", value)} />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end xl:justify-end">
                  <button type="button" onClick={applyFilters} className="w-full rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground sm:w-auto">Apply</button>
                  <Link href={`/admin/market-data/${marketCode}/backfill`} className="w-full rounded border border-border px-3 py-2 text-center text-sm text-muted-foreground sm:w-auto">Reset</Link>
                </div>
              </div>
              <div className="overflow-x-auto rounded border border-border">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Select</th>
                      <th className="px-4 py-3">Ticker</th>
                      <th className="px-4 py-3">Support</th>
                      <th className="px-4 py-3">Backfill</th>
                      <th className="px-4 py-3">Providers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {instruments.items.map((row) => (
                      <tr key={`${row.marketCode}:${row.ticker}`}>
                        <td className="px-4 py-3">
                          <input aria-label={`Select ${row.ticker}`} type="checkbox" checked={selectedTickers.includes(row.ticker)} onChange={() => toggleTicker(row.ticker)} />
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{row.ticker}</p>
                          <p className="mt-1 max-w-[18rem] truncate text-xs text-muted-foreground">{row.name ?? "Unnamed"}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{row.supportState}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.backfillStatus}</td>
                        <td className="px-4 py-3 text-muted-foreground">{row.providerIds.join(", ") || "none"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <p>Showing {instruments.items.length.toLocaleString()} of {instruments.total.toLocaleString()} instruments, page {instruments.page} of {totalPages}. Selected {selectedTickers.length.toLocaleString()}.</p>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Link href={queryPath(instruments.marketCode, "backfill", filters, Math.max(1, instruments.page - 1))} aria-disabled={instruments.page <= 1} className={cn("rounded border border-border px-3 py-2", instruments.page <= 1 && "pointer-events-none opacity-50")}>Previous</Link>
                  <Link href={queryPath(instruments.marketCode, "backfill", filters, Math.min(totalPages, instruments.page + 1))} aria-disabled={instruments.page >= totalPages} className={cn("rounded border border-border px-3 py-2", instruments.page >= totalPages && "pointer-events-none opacity-50")}>Next</Link>
                  <button type="button" onClick={() => void runPreview("selected_catalog_rows")} disabled={selectedRows.length === 0} className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Preview selected</button>
                  <button type="button" onClick={() => void runPreview("all_matching")} className="rounded border border-border px-3 py-2 text-sm font-medium text-foreground">Preview all matching filters</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {preview && (
        <div className="mt-4 space-y-4">
          <PreviewSummary title="Backfill estimate" rows={[
            ["Provider", preview.providerId],
            ["Scope", preview.scope],
            ["Matches", String(preview.matchCount)],
            ["Jobs", String(preview.estimatedJobCount)],
            ["Affected users", String(preview.affectedUserCount)],
            ["Affected accounts", String(preview.affectedAccountCount)],
            ["Preview expires", formatUtcTimestamp(preview.tokenExpiresAt)],
            ["Demo users", includeDemoUsers ? "included" : "excluded"],
            ["Confirmation", preview.confirmation.text ?? preview.confirmation.level],
          ]} />
          {preview.unsupportedRows.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p className="font-medium">Unsupported rows skipped</p>
              {preview.unsupportedRows.slice(0, 10).map((row) => (
                <p key={`${row.marketCode}:${row.ticker}`}>{row.ticker}: {row.reason}</p>
              ))}
            </div>
          )}
          <div className="rounded border border-border p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-foreground">Frozen targets: {previewTargets.length.toLocaleString()}</p>
              {previewTargets.length > 100 ? (
                <button type="button" onClick={() => setTargetModalOpen(true)} className="rounded border border-border px-3 py-2 text-sm text-foreground">
                  View target details
                </button>
              ) : null}
            </div>
            {previewTargets.length <= 100 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="px-3 py-2">Ticker</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Backfill</th><th className="px-3 py-2">Support</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {previewTargets.map((target) => (
                      <tr key={`${target.marketCode}:${target.ticker}`}>
                        <td className="px-3 py-2 font-medium text-foreground">{target.ticker}</td>
                        <td className="px-3 py-2 text-muted-foreground">{target.name ?? "Unnamed"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{target.backfillStatus ?? "unknown"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{target.supportState ?? "unknown"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Large previews show a summary by default. Open details to filter the frozen list before executing.</p>
            )}
          </div>
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
            disabled={previewTargets.length === 0 || (preview.confirmation.level === "typed" ? typedConfirmation !== preview.confirmation.text : !acknowledged)}
            className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            Execute backfill
          </button>
          {targetModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" role="dialog" aria-modal="true" aria-label="Frozen backfill targets">
              <div className="max-h-full w-full max-w-4xl overflow-hidden rounded bg-background shadow-xl">
                <div className="border-b border-border px-5 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-base font-semibold text-foreground">Frozen backfill targets</h3>
                    <button type="button" onClick={() => setTargetModalOpen(false)} className="rounded border border-border px-3 py-1.5 text-sm">Close</button>
                  </div>
                  <input value={targetModalFilter} onChange={(event) => setTargetModalFilter(event.target.value)} className="mt-3 w-full rounded border border-border bg-background px-3 py-2 text-sm" placeholder="Filter frozen targets" />
                </div>
                <div className="max-h-[70vh] overflow-auto">
                  <table className="min-w-full divide-y divide-border text-sm">
                    <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                      <tr><th className="px-4 py-3">Ticker</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Backfill</th><th className="px-4 py-3">Support</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredPreviewTargets.map((target) => (
                        <tr key={`${target.marketCode}:${target.ticker}`}>
                          <td className="px-4 py-3 font-medium text-foreground">{target.ticker}</td>
                          <td className="px-4 py-3 text-muted-foreground">{target.name ?? "Unnamed"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{target.backfillStatus ?? "unknown"}</td>
                          <td className="px-4 py-3 text-muted-foreground">{target.supportState ?? "unknown"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
      {executeResult && (
        <div className="mt-4 space-y-3">
          <div
            role="status"
            data-testid="market-data-backfill-created-notice"
            className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          >
            <p className="font-medium">Backfill job created</p>
            <p className="mt-1">
              Operation {executeResult.operationId} is {executeResult.status}. Enqueued {executeResult.enqueuedJobCount.toLocaleString()} jobs and skipped {executeResult.skippedExistingJobCount.toLocaleString()} existing jobs.
            </p>
          </div>
          <PreviewSummary title="Backfill operation" rows={[
            ["Operation", executeResult.operationId],
            ["Status", executeResult.status],
            ["Enqueued", String(executeResult.enqueuedJobCount)],
            ["Skipped existing", String(executeResult.skippedExistingJobCount)],
            ["Batch", executeResult.batchId ?? "none"],
          ]} />
        </div>
      )}
    </Card>
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

  useEffect(() => {
    setPreview(null);
    setExecuteResult(null);
    setTypedConfirmation("");
  }, [selected, enqueueBackfill, fullHistory, startDate, endDate]);

  function toggle(category: AdminMarketDataPurgeCategory) {
    setSelected((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }

  function buildPurgeRequest(): AdminMarketDataPurgePreviewRequest {
    return {
      categories: selected,
      fullHistory,
      startDate: fullHistory || !startDate ? undefined : startDate,
      endDate: fullHistory || !endDate ? undefined : endDate,
      enqueueBackfillAfterPurge: enqueueBackfill,
    };
  }

  async function runPreview() {
    const request = buildPurgeRequest();
    const result = await previewMarketPurge(marketCode, request);
    setPreview(result);
    setExecuteResult(null);
    setTypedConfirmation("");
  }

  async function runExecute() {
    if (!preview) return;
    const result = await executeMarketPurge(marketCode, {
      operationId: preview.operationId,
      previewToken: preview.previewToken,
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
            disabled={!preview || typedConfirmation !== preview.confirmation.text}
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


function ProviderFilterLinks({
  currentProviderId,
  marketCode,
  providers,
  tab,
}: {
  currentProviderId: string;
  marketCode: AdminMarketCode;
  providers: Array<{ providerId: string; label: string; role: string }>;
  tab: "operations" | "logs";
}) {
  if (providers.length <= 1) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" data-testid={`market-data-${tab}-provider-filter`}>
      <Link
        href={`/admin/market-data/${marketCode}/${tab}`}
        className={cn(
          "rounded border border-border px-2.5 py-1 text-xs font-medium",
          currentProviderId ? "text-muted-foreground hover:text-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        All providers
      </Link>
      {providers.map((provider) => (
        <Link
          key={provider.providerId}
          href={`/admin/market-data/${marketCode}/${tab}?providerId=${encodeURIComponent(provider.providerId)}`}
          className={cn(
            "rounded border border-border px-2.5 py-1 text-xs font-medium",
            currentProviderId === provider.providerId ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          title={`${provider.label}: ${provider.role}`}
        >
          {provider.label}
        </Link>
      ))}
    </div>
  );
}

function OperationsPanel({
  operations,
  currentProviderId,
}: {
  operations: AdminMarketDataOperationsResponse;
  currentProviderId: string;
}) {
  return (
    <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="market-data-operations">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">Operations</h2>
        <p className="mt-1 text-sm text-muted-foreground">Use the provider filter when a market has multiple provider-owned operation streams.</p>
        <ProviderFilterLinks
          currentProviderId={currentProviderId}
          marketCode={operations.marketCode}
          providers={operations.providers}
          tab="operations"
        />
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

function LogsPanel({
  logs,
  currentProviderId,
}: {
  logs: AdminMarketDataLogsResponse;
  currentProviderId: string;
}) {
  return (
    <Card className="overflow-hidden p-0 hover:translate-y-0" data-testid="market-data-logs">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">Logs</h2>
        <p className="mt-1 text-sm text-muted-foreground">Provider filters keep raw diagnostics separated when several providers serve this market.</p>
        <ProviderFilterLinks
          currentProviderId={currentProviderId}
          marketCode={logs.marketCode}
          providers={logs.providers}
          tab="logs"
        />
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
