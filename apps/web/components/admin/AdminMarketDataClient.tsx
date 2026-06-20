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
  AdminMarketDataBackfillDateRangeDto,
  AdminMarketDataBackfillPreviewRequest,
  AdminMarketDataBackfillPreviewResponse,
  AdminMarketDataSnapshotRepairExecuteResponse,
  AdminMarketDataValuationRepairStatusResponse,
  AdminMarketDataInstrumentDto,
  AdminMarketDataInstrumentsResponse,
  AdminMarketDataLandingResponse,
  AdminMarketDataOperationsResponse,
  AdminMarketDataPurgeCategory,
  AdminMarketDataPurgeExecuteResponse,
  AdminMarketDataPurgePreviewRequest,
  AdminMarketDataPurgePreviewResponse,
} from "@vakwen/shared-types";
import { cn } from "../../lib/utils";
import {
  confirmMarketCalendarImport,
  executeMarketBackfill,
  executeMarketAction,
  executeMarketSnapshotRepair,
  executeMarketPurge,
  fetchMarketValuationRepairStatus,
  invalidateMarketCalendar,
  previewMarketBackfill,
  previewMarketCalendarImport,
  previewMarketPurge,
  updateMarketCalendarSource,
  updateMarketCalendarSourceConfig,
  updateMarketInstrumentDelistingOverride,
  updateMarketInstrumentSupportState,
} from "../../lib/adminMarketDataService";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import { KrOperationsPanel, MappingsPanel, type KrMappingsData, type KrOperationsData } from "./AdminMarketDataKrResolver";
import { Pagination } from "./Pagination";
import { formatUtcTimestamp } from "./adminFormat";
import { useAdminI18n } from "./admin-i18n";
import type {
  AdminMarketDataActivityResponse,
  AdminMarketDataCalendarResponse,
  AdminMarketDataOverviewUiResponse,
  AdminMarketWorkspaceUiTab,
  MarketActivityFilterOption,
  MarketActivitySummaryCardDto,
  MarketActivityTableItemDto,
  YahooChartActivitySummaryDto,
} from "../../lib/adminMarketDataContracts";

interface AdminMarketDataLandingClientProps {
  data: AdminMarketDataLandingResponse;
}

interface AdminMarketDataWorkspaceClientProps {
  marketCode: AdminMarketCode;
  tab: AdminMarketWorkspaceUiTab;
  overview: AdminMarketDataOverviewUiResponse;
  actions: AdminMarketDataActionDto[];
  instruments: AdminMarketDataInstrumentsResponse | null;
  instrumentQuery?: InstrumentQuery;
  operations: AdminMarketDataOperationsResponse | null;
  activity?: AdminMarketDataActivityResponse | null;
  calendar?: AdminMarketDataCalendarResponse | null;
  providerFilterId?: string;
  krMappings: KrMappingsData | null;
  krOperations?: KrOperationsData | null;
  snapshotRepairRequest?: SnapshotRepairRequest | null;
}

interface SnapshotRepairRequest {
  mode: "snapshots" | "valuation";
  tickers: string[];
  fromDate: string | null;
  targetDate: string | null;
  startDate: string | null;
  endDate: string | null;
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

const tabLabels: Record<AdminMarketWorkspaceUiTab, string> = {
  overview: "Overview",
  calendar: "Calendar",
  instruments: "Instruments",
  backfill: "Backfill",
  mappings: "Mappings",
  purge: "Purge data",
  operations: "Operations",
  activity: "Activity",
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
  activity,
  calendar,
  providerFilterId = "",
  krMappings,
  krOperations,
  snapshotRepairRequest = null,
}: AdminMarketDataWorkspaceClientProps) {
  const router = useRouter();
  const tabSet = new Set<AdminMarketWorkspaceUiTab>(overview.tabs);
  if (calendar) tabSet.add("calendar");
  if (activity) tabSet.add("activity");
  const safeTab = tabSet.has(tab) ? tab : "overview";
  const orderedTabs = ([
    "overview",
    "calendar",
    "instruments",
    "backfill",
    "mappings",
    "operations",
    "activity",
    "purge",
    "refresh-rates",
  ] as const).filter((item) => tabSet.has(item));

  return (
    <div className="min-w-0 space-y-5" data-testid={`admin-market-data-${marketCode}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
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

      <div className="rounded-xl border border-border bg-card p-3 md:hidden">
        <label className="mb-2 block text-sm font-medium text-foreground" htmlFor="admin-market-data-mobile-tabs">
          Section
        </label>
        <Select
          value={safeTab}
          onValueChange={(next) => {
            router.push(`/admin/market-data/${marketCode}/${next}`);
          }}
        >
          <SelectTrigger id="admin-market-data-mobile-tabs" className="w-full" data-testid="admin-market-data-mobile-tabs">
            <SelectValue placeholder={tabLabels[safeTab]} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {orderedTabs.map((item) => (
                <SelectItem key={item} value={item}>
                  {tabLabels[item]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <nav className="hidden gap-2 overflow-x-auto border-b border-border pb-2 md:flex" aria-label="Market data tabs">
        {orderedTabs.map((item) => (
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
      {safeTab === "calendar" && marketCode !== "FX" && (
        <CalendarPanel calendar={calendar ?? null} marketCode={marketCode} />
      )}
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
          snapshotRepairRequest={snapshotRepairRequest}
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
      {safeTab === "activity" && activity ? <ActivityPanel activity={activity} marketCode={marketCode} /> : null}
    </div>
  );
}

function OverviewPanel({ overview, actions }: { overview: AdminMarketDataOverviewUiResponse; actions: AdminMarketDataActionDto[] }) {
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
    <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0" data-testid="market-data-instruments">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold text-foreground">Instruments</h2>
        <p className="mt-1 text-sm text-muted-foreground">Support state is separate from delisting, exclusion, purge, and holdings visibility.</p>
        <div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-[minmax(10rem,1fr)_repeat(5,minmax(9rem,auto))_auto]">
          <label className="min-w-0 text-sm font-medium text-foreground">
            Search
            <input
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              className="mt-1 w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-sm"
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
      <div className="min-w-0 overflow-x-auto">
        <table className="w-max min-w-[72rem] divide-y divide-border text-sm">
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
    <label className="min-w-0 text-sm font-medium text-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full min-w-0 rounded border border-border bg-background px-3 py-2 text-sm"
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
  snapshotRepairRequest,
}: {
  marketCode: Exclude<AdminMarketCode, "FX">;
  actions: AdminMarketDataActionDto[];
  instruments: AdminMarketDataInstrumentsResponse;
  initialQuery: InstrumentQuery;
  snapshotRepairRequest: SnapshotRepairRequest | null;
}) {
  const router = useRouter();
  const backfillActions = actions.filter((item) => item.action === "backfill_catalog_rows" && item.supported);
  const guidedValuationRepair = snapshotRepairRequest?.mode === "valuation";
  const [mode, setMode] = useState<"owned" | "supported">("owned");
  const [filters, setFilters] = useState<InstrumentQuery>(initialQuery);
  const [providerId, setProviderId] = useState(backfillActions[0]?.providerId ?? actions.find((item) => item.action === "backfill_catalog_rows")?.providerId ?? "");
  const [selectedTickers, setSelectedTickers] = useState<string[]>([]);
  const [includeDemoUsers, setIncludeDemoUsers] = useState(false);
  const [fullHistory, setFullHistory] = useState(!guidedValuationRepair);
  const [startDate, setStartDate] = useState(snapshotRepairRequest?.startDate ?? snapshotRepairRequest?.fromDate ?? "");
  const [endDate, setEndDate] = useState(snapshotRepairRequest?.endDate ?? snapshotRepairRequest?.targetDate ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [preview, setPreview] = useState<AdminMarketDataBackfillPreviewResponse | null>(null);
  const [executeResult, setExecuteResult] = useState<AdminMarketDataBackfillExecuteResponse | null>(null);
  const [snapshotRepairResult, setSnapshotRepairResult] = useState<AdminMarketDataSnapshotRepairExecuteResponse | null>(null);
  const [snapshotRepairError, setSnapshotRepairError] = useState<string | null>(null);
  const [snapshotRepairRunning, setSnapshotRepairRunning] = useState(false);
  const [valuationRepairStatus, setValuationRepairStatus] = useState<AdminMarketDataValuationRepairStatusResponse | null>(null);
  const [valuationRepairStatusError, setValuationRepairStatusError] = useState<string | null>(null);
  const [valuationRepairStatusLoading, setValuationRepairStatusLoading] = useState(false);
  const [autoSnapshotRepairKey, setAutoSnapshotRepairKey] = useState<string | null>(null);
  const [trackedBackfillOperationId, setTrackedBackfillOperationId] = useState<string | null>(null);
  const [trackedSnapshotRepairKey, setTrackedSnapshotRepairKey] = useState<string | null>(null);
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

  useEffect(() => {
    setFullHistory(!guidedValuationRepair);
    setStartDate(snapshotRepairRequest?.startDate ?? snapshotRepairRequest?.fromDate ?? "");
    setEndDate(snapshotRepairRequest?.endDate ?? snapshotRepairRequest?.targetDate ?? "");
    setValuationRepairStatus(null);
    setValuationRepairStatusError(null);
    setAutoSnapshotRepairKey(null);
    setTrackedBackfillOperationId(null);
    setTrackedSnapshotRepairKey(null);
  }, [guidedValuationRepair, snapshotRepairRequest?.endDate, snapshotRepairRequest?.fromDate, snapshotRepairRequest?.startDate, snapshotRepairRequest?.targetDate]);

  useEffect(() => {
    if (!guidedValuationRepair || !snapshotRepairRequest?.targetDate || snapshotRepairRequest.tickers.length === 0) return;
    void refreshValuationRepairStatus();
  }, [guidedValuationRepair, marketCode, snapshotRepairRequest?.targetDate, snapshotRepairRequest?.tickers.join(",")]);

  function clearFrozenPreview() {
    setPreview(null);
    setExecuteResult(null);
    setSnapshotRepairResult(null);
    setSnapshotRepairError(null);
    setAcknowledged(false);
    setTypedConfirmation("");
  }

  function updateBackfillRange(next: { fullHistory?: boolean; startDate?: string; endDate?: string }) {
    if (next.fullHistory !== undefined) setFullHistory(next.fullHistory);
    if (next.startDate !== undefined) setStartDate(next.startDate);
    if (next.endDate !== undefined) setEndDate(next.endDate);
    clearFrozenPreview();
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

  function rangeRequest(): Pick<AdminMarketDataBackfillPreviewRequest, "startDate" | "endDate"> {
    return {
      startDate: fullHistory || !startDate ? undefined : startDate,
      endDate: fullHistory || !endDate ? undefined : endDate,
    };
  }

  function guidedRepairTargets() {
    return (snapshotRepairRequest?.tickers ?? []).map((ticker) => ({ ticker, marketCode }));
  }

  async function refreshValuationRepairStatus(operationId?: string): Promise<AdminMarketDataValuationRepairStatusResponse | null> {
    if (!guidedValuationRepair || !snapshotRepairRequest?.targetDate || snapshotRepairRequest.tickers.length === 0) return null;
    setValuationRepairStatusLoading(true);
    setValuationRepairStatusError(null);
    try {
      const status = await fetchMarketValuationRepairStatus(marketCode, {
        tickers: snapshotRepairRequest.tickers,
        targetDate: snapshotRepairRequest.targetDate,
        operationId,
      });
      setValuationRepairStatus(status);
      return status;
    } catch (err) {
      setValuationRepairStatusError(err instanceof Error ? err.message : "Repair status failed");
      return null;
    } finally {
      setValuationRepairStatusLoading(false);
    }
  }

  async function runPreview(
    scope: "user_owned_or_monitored" | "selected_catalog_rows" | "all_matching",
    overrideTargets?: Array<{ ticker: string; marketCode: Exclude<AdminMarketCode, "FX"> }>,
  ) {
    const result = await previewMarketBackfill(marketCode, {
      scope,
      providerId,
      includeDemoUsers: scope === "user_owned_or_monitored" ? includeDemoUsers : undefined,
      selectedCatalogRows: scope === "selected_catalog_rows" ? overrideTargets ?? selectedRequestTargets : undefined,
      filters: scope === "all_matching" ? previewFilters() : undefined,
      ...rangeRequest(),
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
    const status = await refreshValuationRepairStatus(result.operationId);
    if (status?.operation && isTerminalBackfillPhase(status.operation.phase)) {
      const eligibleTickers = status.tickers.filter((ticker) => ticker.eligibleForSnapshotRepair).map((ticker) => ticker.ticker);
      if (eligibleTickers.length > 0) {
        await runSnapshotRepair(eligibleTickers, result.operationId);
      } else if ((result.skippedExistingJobCount > 0 || (status.operation.skippedExistingJobCount ?? 0) > 0)
        && guidedValuationRepair
        && snapshotRepairRequest?.targetDate) {
        setTrackedBackfillOperationId(result.operationId);
      }
    } else if (guidedValuationRepair && snapshotRepairRequest?.targetDate) {
      setTrackedBackfillOperationId(result.operationId);
    }
  }

  async function runSnapshotRepair(tickers = snapshotRepairRequest?.tickers ?? [], repairKey = "manual") {
    if (!snapshotRepairRequest || tickers.length === 0) return;
    if (guidedValuationRepair && repairKey !== "manual" && autoSnapshotRepairKey === repairKey) return;
    if (guidedValuationRepair && repairKey !== "manual") setAutoSnapshotRepairKey(repairKey);
    setSnapshotRepairRunning(true);
    setSnapshotRepairError(null);
    setSnapshotRepairResult(null);
    try {
      const result = await executeMarketSnapshotRepair(marketCode, {
        tickers,
        ...(snapshotRepairRequest.fromDate ? { fromDate: snapshotRepairRequest.fromDate } : {}),
      });
      setSnapshotRepairResult(result);
      const status = await refreshValuationRepairStatus();
      const hasPendingSnapshotJob = result.queued.length > 0
        || result.rejected.some((item) => item.reason === "existing_snapshot_repair_job");
      if (guidedValuationRepair && hasPendingSnapshotJob && status && !isValuationRepairComplete(status)) {
        setTrackedSnapshotRepairKey(`${repairKey}:${tickers.slice().sort().join(",")}`);
      } else {
        setTrackedSnapshotRepairKey(null);
      }
    } catch (err) {
      setSnapshotRepairError(err instanceof Error ? err.message : "Snapshot repair failed");
    } finally {
      setSnapshotRepairRunning(false);
    }
  }

  useEffect(() => {
    if (!guidedValuationRepair || !trackedBackfillOperationId || !snapshotRepairRequest?.targetDate) return;
    const operationId = trackedBackfillOperationId;
    let cancelled = false;
    let attempts = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function pollGuidedRepairStatus() {
      attempts += 1;
      const status = await refreshValuationRepairStatus(operationId);
      if (cancelled) return;

      if (status?.operation && isTerminalBackfillPhase(status.operation.phase)) {
        const eligibleTickers = status.tickers.filter((ticker) => ticker.eligibleForSnapshotRepair).map((ticker) => ticker.ticker);
        if (eligibleTickers.length > 0) {
          setTrackedBackfillOperationId(null);
          await runSnapshotRepair(eligibleTickers, operationId);
          return;
        }
        if ((status.operation.skippedExistingJobCount ?? 0) <= 0 || attempts >= 24) {
          setTrackedBackfillOperationId(null);
          return;
        }
        timeoutId = setTimeout(() => {
          void pollGuidedRepairStatus();
        }, 2_500);
        return;
      }

      timeoutId = setTimeout(() => {
        void pollGuidedRepairStatus();
      }, 2_500);
    }

    timeoutId = setTimeout(() => {
      void pollGuidedRepairStatus();
    }, 2_500);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [guidedValuationRepair, trackedBackfillOperationId, snapshotRepairRequest?.targetDate]);

  useEffect(() => {
    if (!guidedValuationRepair || !trackedSnapshotRepairKey || !snapshotRepairRequest?.targetDate) return;
    let cancelled = false;
    let attempts = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function pollSnapshotReadiness() {
      const status = await refreshValuationRepairStatus();
      if (cancelled) return;

      if (status && isValuationRepairComplete(status)) {
        setTrackedSnapshotRepairKey(null);
        return;
      }

      attempts += 1;
      if (attempts >= 24) {
        setTrackedSnapshotRepairKey(null);
        return;
      }

      timeoutId = setTimeout(() => {
        void pollSnapshotReadiness();
      }, 2_500);
    }

    timeoutId = setTimeout(() => {
      void pollSnapshotReadiness();
    }, 2_500);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [guidedValuationRepair, trackedSnapshotRepairKey, snapshotRepairRequest?.targetDate, snapshotRepairRequest?.tickers.join(",")]);

  return (
    <div className="space-y-4">
    {snapshotRepairRequest ? (
      <Card className="px-5 py-4 hover:translate-y-0" data-testid="market-data-snapshot-repair">
        <h2 className="text-base font-semibold text-foreground">
          {guidedValuationRepair ? "Guided valuation repair" : "Snapshot repair"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {guidedValuationRepair
            ? "Backfill the affected bars and dividends first, then queue snapshot repair only for tickers whose latest bar reaches the target date."
            : "Recompute holding snapshots directly for the affected ticker scopes. Use this when bars are already present and valuation health reports stale or missing snapshots."}
        </p>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Market</p>
            <p className="mt-1 font-medium text-foreground">{marketCode}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Tickers</p>
            <p className="mt-1 font-medium text-foreground">{snapshotRepairRequest.tickers.length > 0 ? snapshotRepairRequest.tickers.join(", ") : "none"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Target repair date</p>
            <p className="mt-1 font-medium text-foreground">{snapshotRepairRequest.targetDate ?? snapshotRepairRequest.fromDate ?? "not provided"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Backfill range</p>
            <p className="mt-1 font-medium text-foreground">
              {fullHistory ? "full history" : `${startDate || "provider floor"} to ${endDate || "latest"}`}
            </p>
          </div>
        </div>
        {guidedValuationRepair ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runPreview("selected_catalog_rows", guidedRepairTargets())}
                disabled={snapshotRepairRequest.tickers.length === 0}
                className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Preview guided backfill
              </button>
              <button
                type="button"
                onClick={() => void refreshValuationRepairStatus()}
                disabled={valuationRepairStatusLoading || !snapshotRepairRequest.targetDate || snapshotRepairRequest.tickers.length === 0}
                className="rounded border border-border px-4 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {valuationRepairStatusLoading ? "Checking..." : "Refresh repair status"}
              </button>
            </div>
            {valuationRepairStatus ? (
              <ValuationRepairStatusSummary
                status={valuationRepairStatus}
                onQueueEligible={() => void runSnapshotRepair(
                  valuationRepairStatus.tickers.filter((ticker) => ticker.eligibleForSnapshotRepair).map((ticker) => ticker.ticker),
                )}
                snapshotRepairRunning={snapshotRepairRunning}
              />
            ) : null}
            {valuationRepairStatusError ? (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {valuationRepairStatusError}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Target {snapshotRepairRequest.tickers.length > 0 ? snapshotRepairRequest.tickers.join(", ") : "the filtered market scope"} in {marketCode}.
              {snapshotRepairRequest.fromDate ? ` Recompute from ${snapshotRepairRequest.fromDate}.` : ""}
            </p>
          <button
            type="button"
            onClick={() => void runSnapshotRepair()}
            disabled={snapshotRepairRunning || snapshotRepairRequest.tickers.length === 0}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="market-data-snapshot-repair-execute"
          >
            {snapshotRepairRunning ? "Repairing..." : "Queue snapshot repair"}
          </button>
          </div>
        )}
        {snapshotRepairResult ? (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
            Queued {snapshotRepairResult.queued.length.toLocaleString()} repair job(s).
            {snapshotRepairResult.rejected.length > 0 ? ` Rejected ${snapshotRepairResult.rejected.length.toLocaleString()}.` : ""}
          </div>
        ) : null}
        {snapshotRepairError ? (
          <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {snapshotRepairError}
          </div>
        ) : null}
      </Card>
    ) : null}
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
          <div className="rounded border border-border p-3">
            <p className="text-sm font-medium text-foreground">Price/dividend range</p>
            <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={fullHistory}
                onChange={(event) => updateBackfillRange({ fullHistory: event.target.checked })}
              />
              Full history
            </label>
            <label className="mt-3 block text-sm font-medium text-foreground">
              Start date
              <input
                type="date"
                value={startDate}
                disabled={fullHistory}
                onChange={(event) => updateBackfillRange({ startDate: event.target.value })}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
            </label>
            <label className="mt-3 block text-sm font-medium text-foreground">
              End date
              <input
                type="date"
                value={endDate}
                disabled={fullHistory}
                onChange={(event) => updateBackfillRange({ endDate: event.target.value })}
                className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              Applies to price bars and dividends. Guided valuation repair defaults to the affected target window.
            </p>
          </div>
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
            ...backfillDateRangeRows(preview.dateRange),
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
            ...backfillDateRangeRows(executeResult.dateRange),
            ["Batch", executeResult.batchId ?? "none"],
          ]} />
        </div>
      )}
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
      <p className="mt-2 text-sm text-muted-foreground">FX is lightweight here: refresh rates and operations only.</p>
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
  tab: "operations" | "activity";
}) {
  const adminDict = useAdminI18n().marketData;
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
        {adminDict.allProviders}
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
  const adminDict = useAdminI18n().marketData;
  const [selectedOperation, setSelectedOperation] = useState<AdminMarketDataOperationsResponse["items"][number] | null>(operations.items[0] ?? null);

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]" data-testid="market-data-operations">
      <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">{adminDict.operationTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{adminDict.operationDescription}</p>
          <ProviderFilterLinks
            currentProviderId={currentProviderId}
            marketCode={operations.marketCode}
            providers={operations.providers}
            tab="operations"
          />
        </div>
        <ul className="divide-y divide-border">
          {operations.items.map((operation) => (
            <li key={operation.id}>
              <button
                type="button"
                className={cn(
                  "grid w-full gap-3 px-5 py-4 text-left text-sm sm:grid-cols-[minmax(0,1fr)_auto]",
                  selectedOperation?.id === operation.id && "bg-muted/20",
                )}
                onClick={() => setSelectedOperation(operation)}
                data-testid={`market-data-operation-row-${operation.id}`}
              >
                <div className="min-w-0">
                  <p className="break-all font-medium text-foreground">{operation.id}</p>
                  <p className="mt-1 text-muted-foreground">{operation.providerId} - {friendlyLabel(operation.phase)}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{operation.preview.scopeSummary}</p>
                </div>
                <div className="text-left text-xs text-muted-foreground sm:text-right">
                  <div>{adminDict.matches.replace("{count}", operation.matchCount.toLocaleString())}</div>
                  <div>{operation.progressPercent === null ? adminDict.queued : adminDict.progressPercent.replace("{percent}", String(operation.progressPercent))}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Drawer
        open={selectedOperation !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedOperation(null);
        }}
        title={selectedOperation?.id ?? adminDict.operationDetails}
        bodyClassName="space-y-4"
      >
        {selectedOperation ? (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{adminDict.summary}</h3>
              <dl className="grid gap-2">
                {[
                  [adminDict.provider, selectedOperation.providerId],
                  [adminDict.market, selectedOperation.market ?? operations.marketCode],
                  [adminDict.phase, friendlyLabel(selectedOperation.phase)],
                  [adminDict.matchesLabel, selectedOperation.matchCount.toLocaleString()],
                  [adminDict.scope, selectedOperation.preview.scopeSummary],
                ].map(([label, value]) => (
                  <div key={`${selectedOperation.id}:${label}`} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="text-sm text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{adminDict.progress}</h3>
              <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
                <p>{selectedOperation.progressPercent === null ? adminDict.previewWaiting : adminDict.completePercent.replace("{percent}", String(selectedOperation.progressPercent))}</p>
                <p className="text-muted-foreground">
                  {adminDict.autoPauseFailures
                    .replace("{count}", String(selectedOperation.autoPauseFailureCount ?? 0))
                    .replace("{threshold}", String(selectedOperation.autoPauseFailureThresholdPerMinute ?? 0))}
                </p>
                <p className="text-muted-foreground">
                  {selectedOperation.effectiveRateCapPerMinute === null
                    ? adminDict.rateCapNotSet
                    : adminDict.rateCap.replace("{count}", String(selectedOperation.effectiveRateCapPerMinute))}
                </p>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{adminDict.logs}</h3>
              <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                <p>{adminDict.operationLogsRetention}</p>
                <p className="mt-2">{adminDict.previewTokenExpires.replace("{time}", formatUtcTimestamp(selectedOperation.preview.tokenExpiresAt))}</p>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{adminDict.outcomes}</h3>
              <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                <p>{adminDict.confirmationMode.replace("{mode}", friendlyLabel(selectedOperation.preview.confirmationMode))}</p>
                <p className="mt-1">{adminDict.evidenceSampleRows.replace("{count}", String(selectedOperation.preview.evidenceSample.length))}</p>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{adminDict.relatedActivity}</h3>
              <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href={`/admin/market-data/${operations.marketCode}/activity?search=${encodeURIComponent(selectedOperation.id)}`}>
                {adminDict.openFilteredActivity}
              </Link>
            </section>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

function ActivityPanel({
  activity,
  marketCode,
}: {
  activity: AdminMarketDataActivityResponse;
  marketCode: AdminMarketCode;
}) {
  const router = useRouter();
  const adminDict = useAdminI18n().marketData;
  const activityRows = normalizeActivityItems(activity, adminDict);
  const summaryCards = normalizeActivitySummaryCards(activity, adminDict);
  const filterOptions = normalizeActivityFilterGroups(activity, activityRows, adminDict);
  const retentionNote = normalizeActivityRetentionNote(activity, adminDict);
  const yahooSummary = normalizeYahooChartSummary(activity, adminDict);
  const [selectedItem, setSelectedItem] = useState<MarketActivityTableItemDto | null>(null);
  const [search, setSearch] = useState(activity.query?.search ?? "");
  const [sourceKind, setSourceKind] = useState(activity.query?.sourceKind ?? activity.query?.source ?? "");
  const [sourceId, setSourceId] = useState(activity.query?.sourceId ?? "");
  const [category, setCategory] = useState(activity.query?.category ?? "");
  const [result, setResult] = useState(activity.query?.result ?? "all");
  const [timeRange, setTimeRange] = useState(activity.query?.timeRange ?? "24h");

  function pushQuery(next: Partial<Record<string, string | number>>) {
    const params = new URLSearchParams();
    const values = {
      page: 1,
      limit: activity.limit,
      search,
      sourceKind,
      sourceId,
      category,
      result,
      timeRange,
      ...next,
    };
    for (const [key, value] of Object.entries(values)) {
      if (value === "" || value === null || value === undefined) continue;
      params.set(key, String(value));
    }
    router.push(`/admin/market-data/${marketCode}/activity?${params.toString()}`);
  }

  const activityAllOption = { value: "", label: adminDict.all };
  const sourceKinds = [activityAllOption, ...filterOptions.sources];
  const sourceIds = buildSourceIdOptions(activityRows, adminDict);
  const categories = [activityAllOption, ...filterOptions.categories];
  const results = [{ value: "all", label: adminDict.allResults }, ...filterOptions.results.filter((option) => option.value !== "all")];
  const timeRanges = filterOptions.timeRanges;

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]" data-testid="market-data-activity">
      <div className="min-w-0 space-y-4">
        <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">{adminDict.activityTitle}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {adminDict.activityDescription}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => router.refresh()} data-testid="activity-refresh-button">
                {adminDict.refreshActivity}
              </Button>
              <span className="text-xs text-muted-foreground">{retentionNote}</span>
            </div>
          </div>
          <div className="grid gap-3 px-5 py-4 md:grid-cols-2 xl:grid-cols-5">
            {yahooSummary ? (
              <button
                type="button"
                className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-left"
                onClick={() => pushQuery({
                  sourceKind: yahooSummary.filterPatch?.source ?? "yahoo_chart",
                  category: yahooSummary.filterPatch?.category ?? "intraday_price",
                  result: yahooSummary.filterPatch?.result ?? "all",
                  timeRange: yahooSummary.filterPatch?.timeRange ?? timeRange,
                })}
                data-testid="activity-yahoo-summary"
              >
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{yahooSummary.label}</p>
                <p className="mt-2 text-lg font-semibold text-foreground">
                  {adminDict.yahooOk.replace("{count}", String(yahooSummary.successCount ?? 0))}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatYahooSummaryDetail(yahooSummary, adminDict)}
                </p>
              </button>
            ) : null}
            <button
              type="button"
              className={cn(
                "rounded-lg border px-4 py-3 text-left",
                result === "warning,error" ? "border-amber-300 bg-amber-50" : "border-border bg-background",
              )}
              onClick={() => {
                setResult(result === "warning,error" ? "all" : "warning,error");
                pushQuery({ result: result === "warning,error" ? "all" : "warning,error" });
              }}
              data-testid="activity-problems-only-filter"
            >
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{adminDict.quickFilter}</p>
              <p className="mt-2 text-lg font-semibold text-foreground">{adminDict.problemsOnly}</p>
              <p className="mt-1 text-xs text-muted-foreground">{adminDict.problemsOnlyDescription}</p>
            </button>
            {summaryCards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={cn(
                  "rounded-lg border px-4 py-3 text-left",
                  card.filterPatch ? "border-border bg-muted/20" : "border-border/70 bg-background",
                )}
                onClick={() => {
                  if (!card.filterPatch) return;
                  pushQuery(card.filterPatch as Partial<Record<string, string | number>>);
                }}
                data-testid={`activity-summary-${card.id}`}
              >
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{card.label}</p>
                <p className="mt-2 text-lg font-semibold text-foreground">{card.value}</p>
                {card.detail ? <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p> : null}
              </button>
            ))}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0">
          <div className="grid min-w-0 gap-3 border-b border-border px-5 py-4 lg:grid-cols-[minmax(0,1.3fr)_repeat(2,minmax(0,0.8fr))] xl:grid-cols-[minmax(0,1.2fr)_repeat(5,minmax(0,0.7fr))]">
            <label className="min-w-0 space-y-1 text-sm">
              <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{adminDict.search}</span>
              <input
                className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onBlur={() => pushQuery({ search })}
                placeholder={adminDict.searchPlaceholder}
                data-testid="activity-search-input"
              />
            </label>
            <ActivityFilterSelect label={adminDict.sourceKind} options={sourceKinds} value={sourceKind} onChange={(next) => { setSourceKind(next); pushQuery({ sourceKind: next }); }} testId="activity-source-kind-filter" />
            <ActivityFilterSelect label={adminDict.sourceId} options={sourceIds} value={sourceId} onChange={(next) => { setSourceId(next); pushQuery({ sourceId: next }); }} testId="activity-source-id-filter" />
            <ActivityFilterSelect label={adminDict.category} options={categories} value={category} onChange={(next) => { setCategory(next); pushQuery({ category: next }); }} testId="activity-category-filter" />
            <ActivityFilterSelect label={adminDict.result} options={results} value={result} onChange={(next) => { setResult(next); pushQuery({ result: next }); }} testId="activity-result-filter" />
            <ActivityFilterSelect label={adminDict.time} options={timeRanges} value={timeRange} onChange={(next) => { setTimeRange(next); pushQuery({ timeRange: next }); }} testId="activity-time-filter" />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <table className="w-max min-w-[64rem] divide-y divide-border text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">{adminDict.time}</th>
                  <th className="px-5 py-3">{adminDict.category}</th>
                  <th className="px-5 py-3">{adminDict.source}</th>
                  <th className="px-5 py-3">{adminDict.subject}</th>
                  <th className="px-5 py-3">{adminDict.result}</th>
                  <th className="px-5 py-3">{adminDict.facts}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activityRows.map((item) => (
                  <tr
                    key={item.id}
                    className="cursor-pointer align-top hover:bg-muted/20"
                    onClick={() => setSelectedItem(item)}
                    data-testid={`activity-row-${item.id}`}
                  >
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{formatUtcTimestamp(item.occurredAt)}</td>
                    <td className="px-5 py-3"><ActivityBadge tone={item.category}>{friendlyCategoryLabel(item.category, adminDict)}</ActivityBadge></td>
                    <td className="px-5 py-3">
                      <div>{item.sourceLabel ?? friendlySourceLabel(item.sourceKind ?? item.source, adminDict)}</div>
                      {item.sourceId ? <div className="text-xs text-muted-foreground">{item.sourceId}</div> : null}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-foreground">{item.subject}</div>
                      {item.subjectDetail ? <div className="text-xs text-muted-foreground">{item.subjectDetail}</div> : null}
                    </td>
                    <td className="px-5 py-3"><ActivityBadge tone={item.result}>{friendlyResultLabel(item.result, adminDict)}</ActivityBadge></td>
                    <td className="max-w-[22rem] px-5 py-3 text-muted-foreground">
                      <span className="block break-words">{item.facts}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border px-5 py-4">
            <Pagination
              page={activity.page}
              limit={activity.limit}
              total={activity.total}
              onPageChange={(nextPage) => pushQuery({ page: nextPage })}
            />
          </div>
        </Card>
      </div>

      <Drawer
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
        title={selectedItem?.detailTitle ?? selectedItem?.subject ?? adminDict.activityDetails}
        bodyClassName="space-y-4"
      >
        {selectedItem ? (
          <>
            <p className="text-sm text-muted-foreground">{selectedItem.detailDescription ?? selectedItem.facts}</p>
            {selectedItem.detailRows?.length ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{adminDict.summary}</h3>
                <dl className="grid gap-2">
                  {selectedItem.detailRows.map((row) => (
                    <div key={`${selectedItem.id}:${row.label}`} className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd className="break-words text-sm text-foreground">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            {selectedItem.progressRows?.length ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{adminDict.progress}</h3>
                <dl className="grid gap-2">
                  {selectedItem.progressRows.map((row) => (
                    <div key={`${selectedItem.id}:progress:${row.label}`} className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd className="break-words text-sm text-foreground">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            {selectedItem.logRows?.length || selectedItem.timeline?.length ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{adminDict.logs}</h3>
                <div className="space-y-2">
                  {(selectedItem.logRows ?? selectedItem.timeline ?? []).map((entry, index) => {
                    const logEntry = entry as { at?: string | null; message?: string; label?: string; value?: string };
                    const text = logEntry.message ?? `${logEntry.label ?? adminDict.detail}: ${logEntry.value ?? ""}`;
                    return (
                    <div key={`${selectedItem.id}:timeline:${index}`} className="rounded-md border border-border/70 px-3 py-2 text-sm">
                      {logEntry.at ? <span className="mr-2 font-mono text-xs text-muted-foreground">{formatUtcTimestamp(logEntry.at)}</span> : null}
                      <span>{text}</span>
                    </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {selectedItem.outcomeRows?.length ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{adminDict.outcomes}</h3>
                <dl className="grid gap-2">
                  {selectedItem.outcomeRows.map((row) => (
                    <div key={`${selectedItem.id}:outcome:${row.label}`} className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)] gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                      <dt className="text-xs text-muted-foreground">{row.label}</dt>
                      <dd className="break-words text-sm text-foreground">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : null}
            {selectedItem.relatedActivity?.length ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{adminDict.relatedActivity}</h3>
                <div className="space-y-2">
                  {selectedItem.relatedActivity.map((entry, index) => (
                    entry.href ? (
                      <Link key={`${selectedItem.id}:related:${index}`} href={entry.href} className="block text-sm font-medium text-primary underline-offset-4 hover:underline">
                        {entry.label}
                      </Link>
                    ) : (
                      <div key={`${selectedItem.id}:related:${index}`} className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
                        <span className="text-muted-foreground">{entry.label}</span>
                        {entry.value ? <span className="ml-2 break-words text-foreground">{entry.value}</span> : null}
                      </div>
                    )
                  ))}
                </div>
              </section>
            ) : null}
            {selectedItem.metadata ? (
              <details className="rounded-md border border-border/70 bg-muted/20 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-foreground">{adminDict.activityRawMetadata}</summary>
                <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-foreground">{JSON.stringify(selectedItem.metadata, null, 2)}</pre>
              </details>
            ) : null}
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

function buildSourceIdOptions(rows: MarketActivityTableItemDto[], dict: ReturnType<typeof useAdminI18n>["marketData"]): MarketActivityFilterOption[] {
  const values = [...new Set(rows.map((row) => row.sourceId).filter((value): value is string => typeof value === "string" && value.length > 0))];
  return [{ value: "", label: dict.all }, ...values.map((value) => ({ value, label: value }))];
}

function normalizeActivitySummaryCards(activity: AdminMarketDataActivityResponse, dict: ReturnType<typeof useAdminI18n>["marketData"]): MarketActivitySummaryCardDto[] {
  if (Array.isArray(activity.summary)) return activity.summary;
  const summary = activity.summary as unknown as {
    total?: number;
    success?: number;
    warning?: number;
    error?: number;
    skipped?: number;
    rateLimited?: number;
    hiddenSuccessCount?: number;
  };
  return [
    { id: "total", label: dict.allResults, value: summary.total ?? activity.total ?? 0, tone: "neutral", filterPatch: { result: "all" } },
    { id: "warning", label: dict.warnings, value: summary.warning ?? 0, tone: "warning", filterPatch: { result: "warning" } },
    { id: "error", label: dict.errors, value: summary.error ?? 0, tone: "error", filterPatch: { result: "error" } },
    { id: "skipped", label: dict.skipped, value: summary.skipped ?? 0, tone: "skipped", filterPatch: { result: "skipped" } },
    {
      id: "success",
      label: dict.success,
      value: summary.success ?? 0,
      tone: "success",
      detail: summary.hiddenSuccessCount ? dict.activityHiddenByFilters.replace("{count}", String(summary.hiddenSuccessCount)) : null,
      filterPatch: { result: "success" },
    },
  ];
}

function normalizeActivityItems(activity: AdminMarketDataActivityResponse, dict: ReturnType<typeof useAdminI18n>["marketData"]): MarketActivityTableItemDto[] {
  return activity.items.map((item) => {
    if ("subject" in item && "facts" in item) return item as MarketActivityTableItemDto;
    const raw = item as unknown as {
      id: string;
      occurredAt: string;
      category: string;
      result: string;
      source: string;
      sourceKind?: string | null;
      sourceId?: string | null;
      eventType: string;
      title: string;
      message: string;
      ticker: string | null;
      providerSymbol: string | null;
      operationId: string | null;
      jobId: string | null;
      calendarYear: number | null;
      detail: Record<string, unknown>;
    };
    const subject = raw.ticker ?? raw.providerSymbol ?? raw.operationId ?? raw.jobId ?? (raw.calendarYear ? String(raw.calendarYear) : raw.eventType);
    const detailRows = [
      [dict.activityEvent, raw.eventType],
      [dict.activityTicker, raw.ticker],
      [dict.activityProviderSymbol, raw.providerSymbol],
      [dict.activityOperation, raw.operationId],
      [dict.activityJob, raw.jobId],
      [dict.activityCalendarYear, raw.calendarYear === null ? null : String(raw.calendarYear)],
    ]
      .filter((row): row is [string, string] => typeof row[1] === "string" && row[1].length > 0)
      .map(([label, value]) => ({ label, value }));
    return {
      id: raw.id,
      occurredAt: raw.occurredAt,
      category: raw.category,
      source: raw.source,
      sourceKind: raw.sourceKind ?? raw.source,
      sourceId: raw.sourceId ?? raw.operationId ?? raw.jobId ?? raw.providerSymbol ?? null,
      sourceLabel: friendlySourceLabel(raw.sourceKind ?? raw.source, dict),
      subject,
      subjectDetail: raw.title,
      result: raw.result,
      facts: raw.message,
      detailTitle: raw.title,
      detailDescription: raw.message,
      detailRows,
      progressRows: [
        [dict.sourceKind, friendlySourceLabel(raw.sourceKind ?? raw.source, dict)],
        [dict.sourceId, raw.sourceId ?? raw.operationId ?? raw.jobId ?? raw.providerSymbol ?? dict.unknown],
      ].map(([label, value]) => ({ label, value })),
      outcomeRows: [{ label: dict.result, value: friendlyResultLabel(raw.result, dict) }],
      metadata: raw.detail,
    };
  });
}

function normalizeActivityFilterGroups(
  activity: AdminMarketDataActivityResponse,
  rows: MarketActivityTableItemDto[],
  dict: ReturnType<typeof useAdminI18n>["marketData"],
): {
  sources: MarketActivityFilterOption[];
  categories: MarketActivityFilterOption[];
  results: MarketActivityFilterOption[];
  timeRanges: MarketActivityFilterOption[];
} {
  const rawFilters = (activity as AdminMarketDataActivityResponse & {
    filters?: {
      sourceKinds?: string[];
      sources?: string[];
      categories?: string[];
      results?: string[];
      timeRanges?: string[];
    } | null;
  }).filters ?? activity.availableFilters as AdminMarketDataActivityResponse["availableFilters"] | {
    sourceKinds?: string[];
    sources?: string[];
    categories?: string[];
    results?: string[];
    timeRanges?: string[];
  } | null | undefined;
  const rawSources = rawFilters && "sourceKinds" in rawFilters && Array.isArray(rawFilters.sourceKinds)
    ? rawFilters.sourceKinds
    : rawFilters?.sources;
  const sources = Array.isArray(rawSources) && typeof rawSources[0] === "string"
    ? (rawSources as string[]).map((value) => ({ value, label: friendlySourceLabel(value, dict) }))
    : activity.availableFilters?.sources;
  const categories = Array.isArray(rawFilters?.categories) && typeof rawFilters.categories[0] === "string"
    ? (rawFilters.categories as string[]).map((value) => ({ value, label: friendlyCategoryLabel(value, dict) }))
    : activity.availableFilters?.categories;
  const results = Array.isArray(rawFilters?.results) && typeof rawFilters.results[0] === "string"
    ? (rawFilters.results as string[]).map((value) => ({ value, label: friendlyResultLabel(value, dict) }))
    : activity.availableFilters?.results;
  const timeRanges = Array.isArray(rawFilters?.timeRanges) && typeof rawFilters.timeRanges[0] === "string"
    ? (rawFilters.timeRanges as string[]).map((value) => ({ value, label: value }))
    : activity.availableFilters?.timeRanges;
  return {
    sources: normalizeFilterOptions(sources, rows.map((item) => item.sourceKind ?? item.source), (value) => friendlySourceLabel(value, dict)),
    categories: normalizeFilterOptions(categories, rows.map((item) => item.category), (value) => friendlyCategoryLabel(value, dict)),
    results: normalizeFilterOptions(results, ["all", "warning,error", "warning", "error", "success", "skipped", "rate_limited"], (value) => friendlyResultLabel(value, dict)),
    timeRanges: normalizeFilterOptions(timeRanges, ["24h", "48h", "7d", "30d", "all"]),
  };
}

function normalizeActivityRetentionNote(activity: AdminMarketDataActivityResponse, dict: ReturnType<typeof useAdminI18n>["marketData"]): string {
  if (activity.retentionNote) return activity.retentionNote;
  const retention = (activity as unknown as {
    retention?: { detailedDays?: number; summaryDays?: number; calendarHistoryDays?: number };
  }).retention;
  if (retention) {
    return dict.activityRetentionWithDays
      .replace("{detailedDays}", String(retention.detailedDays ?? 7))
      .replace("{summaryDays}", String(retention.summaryDays ?? 90))
      .replace("{calendarHistoryDays}", String(retention.calendarHistoryDays ?? 730));
  }
  return dict.activityRetentionDefault;
}

function normalizeYahooChartSummary(activity: AdminMarketDataActivityResponse, dict: ReturnType<typeof useAdminI18n>["marketData"]): YahooChartActivitySummaryDto | null {
  if (activity.yahooChartSummary) return activity.yahooChartSummary;
  const rows = normalizeActivityItems(activity, dict);
  const yahooRows = rows.filter((item) => item.sourceKind === "yahoo_chart" || item.source === "yahoo_chart" || item.source === "intraday_yahoo_chart");
  if (yahooRows.length === 0) return null;
  return {
    label: dict.activityYahooChart,
    lastRequestAt: yahooRows[0]?.occurredAt ?? null,
    successCount: yahooRows.filter((item) => item.result === "success").length,
    delayedCount: yahooRows.filter((item) => item.result === "warning").length,
    rateLimitedCount: yahooRows.filter((item) => item.result === "rate_limited").length,
    errorCount: yahooRows.filter((item) => item.result === "error").length,
    filterPatch: { sourceKind: "yahoo_chart", category: "intraday_price", result: "all" },
  };
}

function friendlySourceLabel(value: string, dict: ReturnType<typeof useAdminI18n>["marketData"]): string {
  switch (value) {
    case "yahoo_chart":
      return dict.sourceYahooChart;
    case "official_calendar":
      return dict.sourceOfficialCalendar;
    case "official_source":
      return dict.sourceOfficialSource;
    case "twse_close":
      return dict.sourceTwseClose;
    case "finmind":
      return dict.sourceFinmind;
    case "system":
      return dict.sourceSystem;
    default:
      return friendlyLabel(value);
  }
}

const SUGGESTED_CALENDAR_SOURCE_URLS: Record<string, string> = {
  TW: "https://www.twse.com.tw/en/trading/holiday.html",
  US: "https://www.nasdaqtrader.com/trader.aspx?id=Calendar",
  AU: "https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar",
  KR: "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp",
};

const CALENDAR_JSON_EXAMPLE = `{
  "calendarYear": 2026,
  "sourceType": "official_source",
  "label": "Official exchange calendar",
  "retrievedAt": "2026-06-19T00:00:00.000Z",
  "coverage": {
    "scope": "full_year",
    "evidence": "Official exchange holiday page checked on 2026-06-19.",
    "notes": "All weekday closures and weekend openings are included."
  },
  "exceptions": [
    {
      "date": "2026-01-01",
      "status": "closed",
      "name": "New Year's Day",
      "evidence": "Official exchange holiday notice",
      "overrideReason": "Official holiday closure."
    }
  ]
}`;

function readCalendarReplacementFields(normalizedPayload: string): {
  replaceConfirmed?: boolean;
  replacementReason?: string | null;
} {
  try {
    const parsed = JSON.parse(normalizedPayload) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const envelope = parsed as Record<string, unknown>;
    const payload = envelope.payload && typeof envelope.payload === "object"
      ? envelope.payload as Record<string, unknown>
      : envelope;
    const replaceConfirmed = envelope.replaceConfirmed === true || payload.replaceConfirmed === true;
    const rawReason = typeof envelope.replacementReason === "string"
      ? envelope.replacementReason
      : typeof payload.replacementReason === "string"
        ? payload.replacementReason
        : null;
    return {
      replaceConfirmed: replaceConfirmed ? true : undefined,
      replacementReason: rawReason?.trim() ? rawReason.trim() : null,
    };
  } catch {
    return {};
  }
}

function resolveCalendarReplacementFields(
  normalizedPayload: string,
  replaceConfirmed: boolean,
  replacementReason: string,
): {
  replaceConfirmed?: boolean;
  replacementReason?: string | null;
} {
  const embedded = readCalendarReplacementFields(normalizedPayload);
  const resolvedReason = replacementReason.trim() || embedded.replacementReason || null;
  return {
    replaceConfirmed: replaceConfirmed || embedded.replaceConfirmed ? true : undefined,
    replacementReason: resolvedReason,
  };
}

function CalendarPanel({
  calendar,
  marketCode,
}: {
  calendar: AdminMarketDataCalendarResponse | null;
  marketCode: Exclude<AdminMarketCode, "FX">;
}) {
  const router = useRouter();
  const adminDict = useAdminI18n().marketData;
  const [activeExceptionFilter, setActiveExceptionFilter] = useState<"all" | "closed" | "open">("all");
  const [selectedSourceId, setSelectedSourceId] = useState(calendar?.sources.find((source) => source.isDefault)?.sourceId ?? calendar?.sources[0]?.sourceId ?? "");
  const selectedSource = calendar?.sources.find((source) => source.sourceId === selectedSourceId) ?? calendar?.sources[0] ?? null;
  const [sourceLabel, setSourceLabel] = useState(selectedSource?.label ?? "");
  const [sourceType, setSourceType] = useState<"official_source" | "manual_ai_assisted">(
    selectedSource?.sourceType === "manual_ai_assisted" ? "manual_ai_assisted" : "official_source",
  );
  const [sourceUrl, setSourceUrl] = useState(selectedSource?.suggestedSourceUrl ?? SUGGESTED_CALENDAR_SOURCE_URLS[marketCode] ?? "");
  const [sourceEnabled, setSourceEnabled] = useState(selectedSource?.isActive ?? true);
  const [normalizedPayload, setNormalizedPayload] = useState(CALENDAR_JSON_EXAMPLE);
  const [previewMessage, setPreviewMessage] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(calendar?.preview?.previewToken ?? null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [replacementReason, setReplacementReason] = useState("");
  const [previewReplaceConfirmedRequired, setPreviewReplaceConfirmedRequired] = useState(Boolean(calendar?.preview?.replaceConfirmedRequired));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const replacementFields = resolveCalendarReplacementFields(normalizedPayload, replaceConfirmed, replacementReason);
  const replacementReady = !previewReplaceConfirmedRequired || replacementFields.replaceConfirmed === true;

  useEffect(() => {
    if (!selectedSource) return;
    setSourceLabel(selectedSource.label);
    setSourceType(selectedSource.sourceType === "manual_ai_assisted" ? "manual_ai_assisted" : "official_source");
    setSourceUrl(selectedSource.suggestedSourceUrl ?? SUGGESTED_CALENDAR_SOURCE_URLS[marketCode] ?? "");
    setSourceEnabled(selectedSource.isActive ?? true);
  }, [marketCode, selectedSource]);

  async function runPreview() {
    setIsSubmitting(true);
    setPreviewMessage(null);
    try {
      const response = await previewMarketCalendarImport(marketCode, {
        sourceId: selectedSourceId || undefined,
        normalizedPayload: normalizedPayload.trim() || undefined,
        ...replacementFields,
      });
      setPreviewToken(response.preview.previewToken ?? null);
      setPreviewReplaceConfirmedRequired(Boolean(response.preview.replaceConfirmedRequired));
      const readyMessage = adminDict.calendarPreviewReady
        .replace("{added}", String(response.preview.added))
        .replace("{changed}", String(response.preview.changed))
        .replace("{removed}", String(response.preview.removed));
      const warningMessage = response.preview.warnings?.length
        ? ` ${adminDict.calendarPreviewWarnings.replace("{warnings}", response.preview.warnings.join(" · "))}`
        : "";
      setPreviewMessage(`${readyMessage}.${warningMessage}`);
    } catch (error) {
      setPreviewMessage(error instanceof Error ? error.message : adminDict.calendarPreviewFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runConfirm() {
    if (!previewToken) {
      setSubmitMessage(adminDict.calendarRunPreviewFirst);
      return;
    }
    setIsSubmitting(true);
    setSubmitMessage(null);
    try {
      const response = await confirmMarketCalendarImport(marketCode, {
        previewToken,
        ...replacementFields,
      });
      setSubmitMessage(adminDict.calendarImportStatus.replace("{status}", response.status).replace("{versionId}", response.versionId));
      router.refresh();
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : adminDict.calendarConfirmFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function setDefaultSource(sourceId: string) {
    setSelectedSourceId(sourceId);
    try {
      await updateMarketCalendarSource(marketCode, { defaultSourceId: sourceId });
      setSubmitMessage(adminDict.defaultSourceUpdated);
      router.refresh();
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : adminDict.defaultSourceUpdateFailed);
    }
  }

  async function saveSourceConfig() {
    if (!selectedSource) return;
    setIsSubmitting(true);
    setSubmitMessage(null);
    try {
      await updateMarketCalendarSourceConfig(marketCode, selectedSource.sourceId, {
        label: sourceLabel,
        sourceType,
        suggestedSourceUrl: sourceUrl.trim() || null,
        enabled: sourceEnabled,
        isDefault: selectedSource.isDefault ?? false,
      });
      setSubmitMessage(adminDict.calendarSourceSaved);
      router.refresh();
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : adminDict.calendarSourceSaveFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function invalidateYear(calendarYear: number) {
    try {
      await invalidateMarketCalendar(marketCode, { calendarYear, reason: adminDict.calendarInvalidationReason });
      setSubmitMessage(adminDict.calendarInvalidated.replace("{year}", String(calendarYear)));
      router.refresh();
    } catch (error) {
      setSubmitMessage(error instanceof Error ? error.message : adminDict.calendarInvalidationFailed);
    }
  }

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]" data-testid="market-data-calendar">
      <div className="min-w-0 space-y-4">
        <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">{adminDict.calendarTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {adminDict.calendarDescription}
            </p>
          </div>
          <div className="divide-y divide-border">
            {(calendar?.years ?? []).map((year) => (
              <div key={`${marketCode}:${year.calendarYear}`} className="grid min-w-0 gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{marketCode} {year.calendarYear}</p>
                  <p className="break-words text-sm text-muted-foreground">{year.note ?? year.sourceLabel ?? adminDict.calendarNoSourceDetail}</p>
                </div>
                <div className="min-w-0 text-sm text-muted-foreground">
                  <div>{adminDict.calendarStatus}: <span className="font-medium text-foreground">{year.status}</span></div>
                  <div>{adminDict.source}: <span className="break-words font-medium text-foreground">{year.sourceLabel ?? adminDict.unknown}</span></div>
                </div>
                <Button type="button" size="sm" variant="secondary" onClick={() => void invalidateYear(year.calendarYear)}>
                  {adminDict.calendarInvalidate}
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0" data-testid="calendar-active-viewer">
          <div className="border-b border-border px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">{adminDict.calendarActiveTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{adminDict.calendarActiveDescription}</p>
              </div>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm sm:w-48"
                value={activeExceptionFilter}
                onChange={(event) => setActiveExceptionFilter(event.target.value === "closed" || event.target.value === "open" ? event.target.value : "all")}
                data-testid="calendar-active-filter"
              >
                <option value="all">{adminDict.calendarExceptionFilterAll}</option>
                <option value="closed">{adminDict.calendarExceptionFilterClosed}</option>
                <option value="open">{adminDict.calendarExceptionFilterOpen}</option>
              </select>
            </div>
          </div>
          <div className="space-y-4 px-5 py-4">
            {(calendar?.activeCalendars ?? []).length === 0 ? (
              <p className="rounded-md border border-border/70 bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                {adminDict.calendarActiveEmpty}
              </p>
            ) : (
              calendar!.activeCalendars!.map((active) => {
                const visibleExceptions = active.exceptions.filter((exception) =>
                  activeExceptionFilter === "all" ? true : exception.status === activeExceptionFilter);
                return (
                  <section key={active.versionId} className="min-w-0 rounded-md border border-border/70" data-testid={`calendar-active-year-${active.calendarYear}`}>
                    <div className="space-y-3 border-b border-border/70 bg-muted/20 px-4 py-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{marketCode} {active.calendarYear}</p>
                          <p className="break-words text-sm text-muted-foreground">
                            {active.sourceLabel ?? adminDict.unknown} · {active.sourceType}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {adminDict.calendarActiveVersion.replace("{versionId}", active.versionId)}
                        </span>
                      </div>
                      <dl className="grid min-w-0 gap-2 text-sm sm:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{adminDict.calendarRetrievedAt}</dt>
                          <dd className="break-words text-foreground">{formatUtcTimestamp(active.retrievedAt)}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{adminDict.calendarConfirmedAt}</dt>
                          <dd className="break-words text-foreground">{active.confirmedAt ? formatUtcTimestamp(active.confirmedAt) : adminDict.unknown}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{adminDict.calendarTradingDays}</dt>
                          <dd className="text-foreground">{active.annualCounts.tradingDayCount}</dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{adminDict.calendarExceptionCount}</dt>
                          <dd className="text-foreground">{active.exceptions.length}</dd>
                        </div>
                      </dl>
                      {active.sourceUrl ? (
                        <p className="break-all text-xs text-muted-foreground">{active.sourceUrl}</p>
                      ) : null}
                    </div>
                    <div className="space-y-2 px-4 py-3">
                      {visibleExceptions.length === 0 ? (
                        <p className="rounded-md border border-border/70 bg-background px-3 py-3 text-sm text-muted-foreground">
                          {active.exceptions.length === 0
                            ? adminDict.calendarNoExceptions
                            : adminDict.calendarNoExceptionsForFilter}
                        </p>
                      ) : (
                        visibleExceptions.map((exception) => (
                          <article key={`${active.versionId}:${exception.date}`} className="min-w-0 rounded-md border border-border/70 bg-background px-3 py-3" data-testid={`calendar-exception-${exception.date}`}>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-medium text-foreground">{exception.date} · {exception.name}</p>
                                <p className="mt-1 break-words text-sm text-muted-foreground">{exception.evidence}</p>
                              </div>
                              <span className={cn(
                                "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium",
                                exception.status === "open"
                                  ? "border-success/40 bg-success/10 text-success"
                                  : "border-warning/40 bg-warning/10 text-warning-foreground",
                              )}>
                                {exception.status === "open" ? adminDict.calendarStatusOpen : adminDict.calendarStatusClosed}
                              </span>
                            </div>
                            <dl className="mt-3 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
                              <div className="min-w-0">
                                <dt className="text-xs text-muted-foreground">{adminDict.calendarOverrideReason}</dt>
                                <dd className="break-words text-foreground">{exception.overrideReason}</dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-xs text-muted-foreground">{adminDict.calendarNotes}</dt>
                                <dd className="break-words text-foreground">{exception.notes ?? "-"}</dd>
                              </div>
                            </dl>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">{adminDict.calendarSourcesTitle}</h2>
          </div>
          <div className="space-y-3 px-5 py-4">
            {(calendar?.sources ?? []).map((source) => (
              <button
                key={source.sourceId}
                type="button"
                onClick={() => void setDefaultSource(source.sourceId)}
                className={cn(
                  "flex w-full min-w-0 items-start justify-between gap-3 rounded-md border px-3 py-3 text-left",
                  source.sourceId === selectedSourceId ? "border-primary bg-primary/5" : "border-border bg-background",
                )}
              >
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{source.label}</span>
                  <span className="block break-all text-xs text-muted-foreground">{source.suggestedSourceUrl ?? SUGGESTED_CALENDAR_SOURCE_URLS[marketCode]}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{source.isDefault ? adminDict.calendarDefaultSource : adminDict.calendarAvailableSource}</span>
              </button>
            ))}
            {selectedSource ? (
              <div className="space-y-3 rounded-md border border-border/70 p-3" data-testid="calendar-source-editor">
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="calendar-source-label">{adminDict.calendarSourceLabel}</label>
                  <input
                    id="calendar-source-label"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={sourceLabel}
                    onChange={(event) => setSourceLabel(event.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground" htmlFor="calendar-source-type">{adminDict.calendarSourceType}</label>
                    <select
                      id="calendar-source-type"
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={sourceType}
                      onChange={(event) => setSourceType(event.target.value === "manual_ai_assisted" ? "manual_ai_assisted" : "official_source")}
                    >
                      <option value="official_source">{adminDict.calendarOfficialSource}</option>
                      <option value="manual_ai_assisted">{adminDict.calendarManualAiAssisted}</option>
                    </select>
                  </div>
                  <label className="flex items-end gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={sourceEnabled}
                      onChange={(event) => setSourceEnabled(event.target.checked)}
                    />
                    {adminDict.calendarEnabled}
                  </label>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="calendar-source-url">{adminDict.calendarSuggestedSourceUrl}</label>
                  <input
                    id="calendar-source-url"
                    className="mt-1 w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                  />
                </div>
                <Button type="button" size="sm" variant="secondary" disabled={isSubmitting || sourceLabel.trim().length === 0} onClick={() => void saveSourceConfig()}>
                  {adminDict.calendarSaveSource}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">{adminDict.calendarPasteJsonTitle}</h2>
          </div>
          <div className="space-y-3 px-5 py-4">
            <p className="text-sm text-muted-foreground">{adminDict.calendarPasteJsonHelp}</p>
            <textarea
              className="min-h-44 w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              value={normalizedPayload}
              onChange={(event) => setNormalizedPayload(event.target.value)}
              placeholder={CALENDAR_JSON_EXAMPLE}
              data-testid="calendar-json-input"
            />
            <div className="space-y-3 rounded-md border border-border/70 p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{adminDict.calendarReplacementTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">{adminDict.calendarReplacementHelp}</p>
              </div>
              <label className="flex items-start gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={replaceConfirmed}
                  onChange={(event) => setReplaceConfirmed(event.target.checked)}
                  data-testid="calendar-replace-confirmed-input"
                />
                <span>{adminDict.calendarReplaceConfirmed}</span>
              </label>
              <div>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="calendar-replacement-reason">{adminDict.calendarReplacementReason}</label>
                <input
                  id="calendar-replacement-reason"
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={replacementReason}
                  onChange={(event) => setReplacementReason(event.target.value)}
                  placeholder={adminDict.calendarReplacementReasonPlaceholder}
                  data-testid="calendar-replacement-reason-input"
                />
              </div>
              {previewReplaceConfirmedRequired && !replacementReady ? (
                <p className="text-xs text-warning-foreground">{adminDict.calendarReplacementRequired}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={isSubmitting} onClick={() => void runPreview()} data-testid="calendar-preview-button">
                {adminDict.calendarPreview}
              </Button>
              <Button type="button" size="sm" disabled={isSubmitting || !previewToken || !replacementReady} onClick={() => void runConfirm()} data-testid="calendar-confirm-button">
                {adminDict.calendarConfirmImport}
              </Button>
            </div>
            {previewMessage ? <p className="text-xs text-muted-foreground">{previewMessage}</p> : null}
            {submitMessage ? <p className="text-xs text-muted-foreground">{submitMessage}</p> : null}
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden p-0 hover:translate-y-0">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">{adminDict.calendarHistoryTitle}</h2>
          </div>
          <div className="space-y-3 px-5 py-4">
            {(calendar?.history ?? []).map((entry) => (
              <div key={entry.id} className="min-w-0 rounded-md border border-border/70 px-3 py-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{entry.calendarYear} · {entry.sourceLabel}</p>
                    <p className="text-xs text-muted-foreground">{formatUtcTimestamp(entry.importedAt)}</p>
                    {entry.importOperationId ? <p className="break-all text-xs text-muted-foreground">{adminDict.calendarImportOperation.replace("{operationId}", entry.importOperationId)}</p> : null}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{entry.status}</span>
                </div>
                {entry.note ? <p className="mt-2 break-words text-xs text-muted-foreground">{entry.note}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function ActivityFilterSelect({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: MarketActivityFilterOption[];
  value: string;
  onChange: (next: string) => void;
  testId: string;
}) {
  return (
    <label className="min-w-0 space-y-1 text-sm">
      <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
      <select
        className="w-full min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
      >
        {options.map((option) => (
          <option key={`${label}:${option.value}`} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function normalizeFilterOptions(
  options: MarketActivityFilterOption[] | undefined,
  fallbackValues: string[],
  labelForValue: (value: string) => string = friendlyLabel,
): MarketActivityFilterOption[] {
  if (options && options.length > 0) return options;
  return [...new Set(fallbackValues)]
    .filter((value) => value.length > 0)
    .map((value) => ({ value, label: labelForValue(value) }));
}

function friendlyLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function friendlyCategoryLabel(value: string, dict: ReturnType<typeof useAdminI18n>["marketData"]): string {
  switch (value) {
    case "intraday_price":
      return dict.categoryIntradayPrice;
    case "daily_close":
      return dict.categoryDailyClose;
    case "provider_operation":
      return dict.categoryProviderOperation;
    case "provider_error":
      return dict.categoryProviderError;
    case "calendar":
      return dict.categoryCalendar;
    case "instrument":
      return dict.categoryInstrument;
    case "system":
      return dict.categorySystem;
    default:
      return friendlyLabel(value);
  }
}

function friendlyResultLabel(value: string, dict: ReturnType<typeof useAdminI18n>["marketData"]): string {
  if (value === "rate_limited") return dict.resultRateLimited;
  if (value === "warning,error") return dict.problemsOnly;
  if (value === "warning") return dict.warnings;
  if (value === "error") return dict.errors;
  if (value === "skipped") return dict.skipped;
  if (value === "success") return dict.success;
  if (value === "all") return dict.allResults;
  return friendlyLabel(value);
}

function formatYahooSummaryDetail(summary: NonNullable<AdminMarketDataActivityResponse["yahooChartSummary"]>, dict: ReturnType<typeof useAdminI18n>["marketData"]): string {
  const parts = [];
  if (summary.lastRequestAt) parts.push(dict.activityLastRequest.replace("{time}", formatUtcTimestamp(summary.lastRequestAt)));
  if (summary.delayedCount !== null && summary.delayedCount !== undefined) parts.push(dict.activityDelayedBars.replace("{count}", String(summary.delayedCount)));
  if (summary.rateLimitedCount !== null && summary.rateLimitedCount !== undefined) parts.push(dict.activityRateLimited429.replace("{count}", String(summary.rateLimitedCount)));
  if (summary.budgetUsed !== null && summary.budgetUsed !== undefined && summary.budgetLimit) {
    parts.push(dict.activityBudget.replace("{used}", String(summary.budgetUsed)).replace("{limit}", String(summary.budgetLimit)));
  }
  return parts.join(" · ");
}

function ActivityBadge({ children, tone }: { children: string; tone: string }) {
  const className = tone === "error"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : tone === "warning" || tone === "calendar"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-border bg-secondary text-secondary-foreground";
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", className)}>{children}</span>;
}

function isTerminalBackfillPhase(phase: NonNullable<AdminMarketDataValuationRepairStatusResponse["operation"]>["phase"]): boolean {
  return phase === "completed" || phase === "failed" || phase === "cancelled";
}

function isValuationRepairComplete(status: AdminMarketDataValuationRepairStatusResponse): boolean {
  return status.summary.total > 0 && status.summary.completed === status.summary.total;
}

function backfillDateRangeRows(range: AdminMarketDataBackfillDateRangeDto): Array<[string, string]> {
  return [
    ["Requested start", range.requestedStartDate ?? "full history"],
    ["Requested end", range.requestedEndDate ?? "latest"],
    ["Effective start", range.effectiveStartDate],
    ["Effective end", range.effectiveEndDate ?? "latest"],
    ["Provider floor", range.providerStartDate],
    ["Provider floor clamp", range.clampedStartDate ? "yes" : "no"],
  ];
}

function repairReasonLabel(reason: AdminMarketDataValuationRepairStatusResponse["tickers"][number]["reasons"][number]): string {
  switch (reason) {
    case "ready":
      return "Ready for snapshot repair";
    case "market_closed":
      return "Market closed on target date";
    case "latest_bar_missing":
      return "Latest bar missing";
    case "latest_bar_before_target":
      return "Latest bar is before target";
    case "snapshot_ready":
      return "Snapshot already ready";
    case "snapshot_missing":
      return "Snapshot missing";
    case "snapshot_stale":
      return "Snapshot stale";
    case "instrument_not_found":
      return "Instrument not found";
    case "no_active_snapshot_scopes":
      return "No active snapshot scopes";
  }
}

function ValuationRepairStatusSummary({
  status,
  onQueueEligible,
  snapshotRepairRunning,
}: {
  status: AdminMarketDataValuationRepairStatusResponse;
  onQueueEligible: () => void;
  snapshotRepairRunning: boolean;
}) {
  const eligible = status.tickers.filter((ticker) => ticker.eligibleForSnapshotRepair);
  const complete = status.summary.total > 0 && status.summary.completed === status.summary.total;
  return (
    <div className={cn(
      "rounded border px-3 py-3",
      complete ? "border-emerald-200 bg-emerald-50" : status.summary.blocked > 0 ? "border-amber-300 bg-amber-50" : "border-border bg-muted/30",
    )}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">
            Repair status: {status.summary.completed}/{status.summary.total} complete
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Target {status.targetRepairDate}. {status.marketTradingDay ? "Market is open for the target date." : "Target date is not a trading day for this market."}
            {status.operation ? ` Backfill operation ${status.operation.operationId} is ${status.operation.phase}.` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={onQueueEligible}
          disabled={snapshotRepairRunning || eligible.length === 0}
          className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {snapshotRepairRunning ? "Repairing..." : `Queue ${eligible.length} eligible snapshot repair${eligible.length === 1 ? "" : "s"}`}
        </button>
      </div>
      <div className="mt-3 overflow-x-auto rounded border border-border bg-background">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Ticker</th>
              <th className="px-3 py-2">Latest bar</th>
              <th className="px-3 py-2">Latest snapshot</th>
              <th className="px-3 py-2">Scopes</th>
              <th className="px-3 py-2">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {status.tickers.map((ticker) => (
              <tr key={`${ticker.marketCode}:${ticker.ticker}`}>
                <td className="px-3 py-2 font-medium text-foreground">{ticker.ticker}</td>
                <td className="px-3 py-2 text-muted-foreground">{ticker.latestBarDate ?? "missing"}</td>
                <td className="px-3 py-2 text-muted-foreground">{ticker.latestSnapshotDate ?? "missing"}</td>
                <td className="px-3 py-2 text-muted-foreground">{ticker.scopeCount}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {ticker.reasons.map(repairReasonLabel).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
