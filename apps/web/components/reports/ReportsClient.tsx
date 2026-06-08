"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  REPORT_CURRENCY_MODES,
  REPORT_SCOPES,
  type AccountDefaultCurrency,
  type AllocationBucketDto,
  type DailyReviewReportDto,
  type DashboardPerformanceDto,
  type LocaleCode,
  type MarketReportDto,
  type PortfolioReportDto,
  type ReportDataHealthDto,
  type ReportFxStatusDto,
  type ReportHoldingRowDto,
  type ReportHoldingRowsPageDto,
  type ReportSummaryTotalsDto,
} from "@vakwen/shared-types";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { RefreshCw } from "lucide-react";
import { useAppShellData } from "../layout/AppShellDataContext";
import { Button } from "../ui/Button";
import { Badge } from "../ui/shadcn/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/shadcn/card";
import { ChartContainer, type ChartConfig } from "../ui/shadcn/chart";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/shadcn/sheet";
import { Skeleton } from "../ui/shadcn/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/shadcn/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/shadcn/table";
import { useReportData } from "../../features/reports/hooks/useReportData";
import {
  parseReportRouteState,
  reportRouteStateToSearchParams,
  type ReportRouteState,
  type ReportTab,
} from "../../features/reports/reportState";
import type { AnyReportDto } from "../../features/reports/services/reportService";
import { cn, formatCompactCurrencyAmount, formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";

const TAB_LABELS: Record<ReportTab, string> = {
  "daily-review": "Daily Review",
  portfolio: "Portfolio Report",
  market: "Market Report",
};

const PERFORMANCE_CHART_CONFIG = {
  marketValueAmount: {
    label: "Market value",
    color: "hsl(var(--chart-primary))",
  },
  totalCostAmount: {
    label: "Cost basis",
    color: "hsl(var(--chart-muted))",
  },
  totalReturnAmount: {
    label: "Total return",
    color: "hsl(var(--chart-positive))",
  },
} satisfies ChartConfig;

const ALLOCATION_CHART_CONFIG = {
  amount: {
    label: "Amount",
    color: "hsl(var(--chart-primary))",
  },
} satisfies ChartConfig;

export function ReportsClient({
  initialReport,
  initialState,
}: {
  initialReport: AnyReportDto | null;
  initialState: ReportRouteState;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, uiDict } = useAppShellData();
  const [state, setState] = useState(() => parseReportRouteState(searchParams ?? reportRouteStateToSearchParams(initialState)));
  const report = useReportData({ initialReport, locale, state });

  function updateState(patch: Partial<ReportRouteState>) {
    const next = { ...state, ...patch };
    setState(next);
    router.replace(`/reports?${reportRouteStateToSearchParams(next).toString()}`, { scroll: false });
  }

  const restoredLabel = report.restoredAt
    ? new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(report.restoredAt))
    : null;

  return (
    <div className="stagger flex min-w-0 flex-col gap-6" data-testid="reports-page">
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <CardDescription className="text-xs font-semibold uppercase text-primary/80">{uiDict.navigation.reportsLabel}</CardDescription>
              <CardTitle className="mt-2 text-2xl sm:text-3xl">{uiDict.navigation.reportsLabel}</CardTitle>
              <CardDescription className="mt-2 max-w-3xl leading-6">{uiDict.navigation.reportsDescription}</CardDescription>
            </div>
            <ReportControls state={state} onChange={updateState} />
          </div>
        </CardHeader>
        <CardContent>
          <FreshnessStrip
            isRefreshing={report.isRefreshing}
            restoredFromCache={report.restoredFromCache}
            restoredLabel={restoredLabel}
            onRefresh={() => { void report.refresh({ bypassCache: true }); }}
          />
        </CardContent>
      </Card>

      <Tabs
        value={state.tab}
        onValueChange={(value) => updateState({ tab: value as ReportTab })}
        data-testid="reports-tabs"
      >
        <TabsList className="h-auto w-full flex-wrap justify-start">
          {Object.entries(TAB_LABELS).map(([value, label]) => (
            <TabsTrigger key={value} value={value} data-testid={`reports-tab-${value}`}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="daily-review" className="mt-5">
          <ReportBody
            data={report.data}
            errorMessage={report.errorMessage}
            isBootstrapping={report.isBootstrapping}
            isRefreshing={report.isRefreshing}
            locale={locale}
            onRefresh={() => { void report.refresh({ bypassCache: true }); }}
            tab="daily-review"
          />
        </TabsContent>
        <TabsContent value="portfolio" className="mt-5">
          <ReportBody
            data={report.data}
            errorMessage={report.errorMessage}
            isBootstrapping={report.isBootstrapping}
            isRefreshing={report.isRefreshing}
            locale={locale}
            onRefresh={() => { void report.refresh({ bypassCache: true }); }}
            tab="portfolio"
          />
        </TabsContent>
        <TabsContent value="market" className="mt-5">
          <ReportBody
            data={report.data}
            errorMessage={report.errorMessage}
            isBootstrapping={report.isBootstrapping}
            isRefreshing={report.isRefreshing}
            locale={locale}
            onRefresh={() => { void report.refresh({ bypassCache: true }); }}
            tab="market"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ReportControls({
  state,
  onChange,
}: {
  state: ReportRouteState;
  onChange: (patch: Partial<ReportRouteState>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="reports-controls">
      <ControlSelect label="Scope" value={state.scope} onValueChange={(scope) => onChange({ scope: scope as ReportRouteState["scope"] })}>
        {REPORT_SCOPES.map((scope) => <SelectItem key={scope} value={scope}>{scope === "all" ? "All markets" : scope}</SelectItem>)}
      </ControlSelect>
      <ControlSelect label="Currency mode" value={state.currencyMode} onValueChange={(currencyMode) => onChange({ currencyMode: currencyMode as ReportRouteState["currencyMode"] })}>
        {REPORT_CURRENCY_MODES.map((mode) => <SelectItem key={mode} value={mode}>{mode === "auto" ? "Auto" : "Specified"}</SelectItem>)}
      </ControlSelect>
      <ControlSelect
        label="Currency"
        value={state.currency}
        onValueChange={(currency) => onChange({ currency: currency as AccountDefaultCurrency, currencyMode: "specified" })}
      >
        {ACCOUNT_DEFAULT_CURRENCIES.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
      </ControlSelect>
      <ControlSelect label="Range" value={state.range} onValueChange={(range) => onChange({ range })}>
        {["1M", "3M", "YTD", "1Y", "5Y"].map((range) => <SelectItem key={range} value={range}>{range}</SelectItem>)}
      </ControlSelect>
    </div>
  );
}

function ControlSelect({
  children,
  label,
  onValueChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full bg-background" data-testid={`reports-control-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {children}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}

function FreshnessStrip({
  isRefreshing,
  onRefresh,
  restoredFromCache,
  restoredLabel,
}: {
  isRefreshing: boolean;
  onRefresh: () => void;
  restoredFromCache: boolean;
  restoredLabel: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        {restoredFromCache && restoredLabel ? (
          <span data-testid="reports-cache-restore-label">Restored from cache at {restoredLabel}</span>
        ) : (
          <span>Report content stays visible while fresh data loads.</span>
        )}
        {isRefreshing ? <Badge variant="secondary">Refreshing</Badge> : null}
      </div>
      <Button size="sm" variant="secondary" onClick={onRefresh} disabled={isRefreshing} data-testid="reports-refresh-button">
        <RefreshCw data-icon="inline-start" />
        Refresh
      </Button>
    </div>
  );
}

function ReportBody({
  data,
  errorMessage,
  isBootstrapping,
  isRefreshing,
  locale,
  onRefresh,
  tab,
}: {
  data: AnyReportDto | null;
  errorMessage: string;
  isBootstrapping: boolean;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  tab: ReportTab;
}) {
  if (isBootstrapping) return <ReportSkeleton />;
  if (errorMessage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Report unavailable</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No report data</CardTitle>
          <CardDescription>Run refresh after the portfolio read model is available.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!reportDataMatchesTab(data, tab)) return <ReportSkeleton />;

  return (
    <div className="flex flex-col gap-6" data-testid={`reports-${tab}-content`}>
      <ReportMeta data={data} locale={locale} />
      <SummaryGrid summary={data.summary} currency={data.query.reportingCurrency} locale={locale} />
      <div className="grid gap-4 lg:grid-cols-2">
        <FxStatusCard fxStatus={data.fxStatus} />
        <DataHealthCard dataHealth={data.dataHealth} />
      </div>
      {tab === "daily-review" ? <DailyReviewView data={data as DailyReviewReportDto} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} /> : null}
      {tab === "portfolio" ? <PortfolioReportView data={data as PortfolioReportDto} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} /> : null}
      {tab === "market" ? <MarketReportView data={data as MarketReportDto} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} /> : null}
    </div>
  );
}

function reportDataMatchesTab(data: AnyReportDto, tab: ReportTab): boolean {
  if (tab === "daily-review") return "suggestions" in data && "topMovers" in data && "holdings" in data;
  if (tab === "portfolio") return "performance" in data && "allocation" in data && "income" in data;
  return "performance" in data && "marketSummary" in data && "detail" in data;
}

function ReportMeta({ data, locale }: { data: AnyReportDto; locale: LocaleCode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="reports-meta">
      <Badge variant="outline">{data.query.scope === "all" ? "All markets" : data.query.scope}</Badge>
      <Badge variant="outline">{data.query.reportingCurrency}</Badge>
      <Badge variant={data.fxStatus.status === "complete" ? "secondary" : "outline"}>FX {data.fxStatus.status}</Badge>
      <span>{formatDateLabel(data.query.asOf, locale)}</span>
    </div>
  );
}

function SummaryGrid({
  currency,
  locale,
  summary,
}: {
  currency: AccountDefaultCurrency;
  locale: LocaleCode;
  summary: ReportSummaryTotalsDto;
}) {
  const items = [
    { label: "Market value", value: summary.marketValueAmount },
    { label: "Cost basis", value: summary.costBasisAmount },
    { label: "Unrealized P&L", value: summary.unrealizedPnlAmount },
    { label: "Realized P&L", value: summary.realizedPnlAmount },
    { label: "Daily change", value: summary.dailyChangeAmount, detail: summary.dailyChangePercent !== null ? formatPercent(summary.dailyChangePercent, locale) : "-" },
    { label: "Income", value: summary.incomeAmount },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="reports-summary-grid">
      {items.map((item) => (
        <Card key={item.label}>
          <CardHeader className="p-4 pb-2">
            <CardDescription>{item.label}</CardDescription>
            <CardTitle
              className="font-mono text-2xl tabular-nums"
              title={item.value === null ? undefined : formatCurrencyAmount(item.value, currency, locale)}
            >
              {item.value === null ? "-" : formatCompactCurrencyAmount(item.value, currency, locale)}
            </CardTitle>
          </CardHeader>
          {item.detail ? <CardContent className="px-4 pb-4 pt-0 text-sm text-muted-foreground">{item.detail}</CardContent> : null}
        </Card>
      ))}
    </div>
  );
}

function FxStatusCard({ fxStatus }: { fxStatus: ReportFxStatusDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>FX status</CardTitle>
        <CardDescription>{fxStatus.nativeCurrencies.join(", ") || fxStatus.reportingCurrency} to {fxStatus.reportingCurrency}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Badge variant={fxStatus.status === "complete" ? "secondary" : "outline"} className="w-fit">{fxStatus.status}</Badge>
        {fxStatus.missingRatePairs.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {fxStatus.missingRatePairs.map((pair) => <Badge key={`${pair.from}-${pair.to}`} variant="outline">{pair.from} to {pair.to}</Badge>)}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DataHealthCard({ dataHealth }: { dataHealth: ReportDataHealthDto }) {
  const rows = [
    ["Holdings", dataHealth.holdingCount],
    ["Missing quotes", dataHealth.missingQuoteCount],
    ["Provisional quotes", dataHealth.provisionalQuoteCount],
    ["Missing FX", dataHealth.missingFxCount],
    ["Stale quotes", dataHealth.staleQuoteCount],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data health</CardTitle>
        <CardDescription>Quote, FX, and freshness coverage for the selected scope.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="font-mono text-sm font-semibold tabular-nums">{value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DailyReviewView({
  data,
  isRefreshing,
  locale,
  onRefresh,
}: {
  data: DailyReviewReportDto;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
}) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Today</CardTitle>
              <CardDescription>Deterministic observations from the report data.</CardDescription>
            </div>
            <SectionRefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} testId="reports-today-refresh" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.suggestions.length === 0 ? <p className="text-sm text-muted-foreground">No observations for this scope.</p> : null}
            {data.suggestions.map((item) => (
              <div key={item.code} className="rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{item.title}</p>
                  <Badge variant={item.severity === "critical" ? "destructive" : "secondary"}>{item.severity}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <HoldingsCard
          title="Top movers"
          rows={{ total: data.topMovers.length, limit: data.topMovers.length, offset: 0, rows: data.topMovers }}
          isRefreshing={isRefreshing}
          locale={locale}
          onRefresh={onRefresh}
        />
      </div>
      <HoldingsCard title="Holdings detail" rows={data.holdings} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} stickyFirstColumn />
    </>
  );
}

function PortfolioReportView({
  data,
  isRefreshing,
  locale,
  onRefresh,
}: {
  data: PortfolioReportDto;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
}) {
  return (
    <>
      <PerformanceChart performance={data.performance} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} />
      <div className="grid gap-4 lg:grid-cols-2">
        <AllocationChart title="Allocation by market" buckets={data.allocation.byMarket} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} />
        <AllocationChart title="Allocation by account" buckets={data.allocation.byAccount} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
        <Card>
          <CardHeader>
            <CardTitle>Income</CardTitle>
            <CardDescription>{formatNumber(data.income.recentDividendCount, locale)} posted dividend rows</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatCompactCurrencyAmount(data.income.trailingDividendAmount, data.query.reportingCurrency, locale)}
            </p>
          </CardContent>
        </Card>
        <HoldingsCard
          title="Concentration"
          rows={{ total: data.concentration.topHoldings.length, limit: data.concentration.topHoldings.length, offset: 0, rows: data.concentration.topHoldings }}
          isRefreshing={isRefreshing}
          locale={locale}
          onRefresh={onRefresh}
        />
      </div>
      <HoldingsCard title="Holdings detail" rows={data.holdings} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} stickyFirstColumn />
    </>
  );
}

function MarketReportView({
  data,
  isRefreshing,
  locale,
  onRefresh,
}: {
  data: MarketReportDto;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
}) {
  return (
    <>
      <PerformanceChart performance={data.performance} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
        <AllocationChart title="Market summary" buckets={data.marketSummary} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} />
        <HoldingsCard
          title="Top holdings"
          rows={{ total: data.topHoldings.length, limit: data.topHoldings.length, offset: 0, rows: data.topHoldings }}
          isRefreshing={isRefreshing}
          locale={locale}
          onRefresh={onRefresh}
        />
      </div>
      <HoldingsCard title="Market detail" rows={data.detail} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} stickyFirstColumn />
    </>
  );
}

function PerformanceChart({
  isRefreshing,
  locale,
  onRefresh,
  performance,
}: {
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  performance: DashboardPerformanceDto;
}) {
  const points = performance.points;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Performance trend</CardTitle>
          <CardDescription>{performance.range} · {performance.reportingCurrency} · FX {performance.fxStatus}</CardDescription>
        </div>
        <SectionRefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} testId="reports-performance-refresh" />
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">No server snapshot series is available for this scope.</div>
        ) : (
          <ChartContainer config={PERFORMANCE_CHART_CONFIG} className="h-72 w-full aspect-auto" data-testid="reports-performance-chart">
            <LineChart data={points} margin={{ top: 12, right: 20, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="4 6" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(value: string) => formatShortDate(value, locale)} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tickFormatter={(value: number) => formatCompactCurrencyAmount(value, performance.reportingCurrency, locale)} tickLine={false} axisLine={false} width={74} />
              <Tooltip
                formatter={(value: number | string) => typeof value === "number" ? formatCurrencyAmount(value, performance.reportingCurrency, locale) : value}
                labelFormatter={(value: string) => formatDateLabel(value, locale)}
              />
              <Line dataKey="marketValueAmount" type="monotone" stroke="var(--color-marketValueAmount)" strokeWidth={3} dot={false} connectNulls />
              <Line dataKey="totalCostAmount" type="monotone" stroke="var(--color-totalCostAmount)" strokeWidth={2} dot={false} connectNulls />
              <Line dataKey="totalReturnAmount" type="monotone" stroke="var(--color-totalReturnAmount)" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function AllocationChart({
  buckets,
  isRefreshing,
  locale,
  onRefresh,
  title,
}: {
  buckets: AllocationBucketDto[];
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  title: string;
}) {
  const visible = buckets.filter((bucket) => bucket.amount !== null).slice(0, 8);
  const currency = visible[0]?.reportingCurrency ?? "TWD";
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{formatNumber(buckets.length, locale)} bucket(s)</CardDescription>
        </div>
        <SectionRefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} testId={`reports-${title.toLowerCase().replace(/\s+/g, "-")}-refresh`} />
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">No allocation buckets for this scope.</div>
        ) : (
          <ChartContainer config={ALLOCATION_CHART_CONFIG} className="h-64 w-full aspect-auto" data-testid={`reports-${title.toLowerCase().replace(/\s+/g, "-")}-chart`}>
            <BarChart data={visible} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid strokeDasharray="4 6" horizontal={false} />
              <XAxis type="number" tickFormatter={(value: number) => formatCompactCurrencyAmount(value, currency, locale)} tickLine={false} axisLine={false} />
              <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={84} />
              <Tooltip formatter={(value: number | string) => typeof value === "number" ? formatCurrencyAmount(value, currency, locale) : value} />
              <Bar dataKey="amount" fill="var(--color-amount)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function HoldingsCard({
  locale,
  isRefreshing,
  onRefresh,
  rows,
  stickyFirstColumn = false,
  title,
}: {
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  rows: ReportHoldingRowsPageDto;
  stickyFirstColumn?: boolean;
  title: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{formatNumber(rows.total, locale)} total row(s)</CardDescription>
        </div>
        <SectionRefreshButton isRefreshing={isRefreshing} onRefresh={onRefresh} testId={`reports-${title.toLowerCase().replace(/\s+/g, "-")}-refresh`} />
      </CardHeader>
      <CardContent>
        <HoldingsMobileList rows={rows.rows} locale={locale} />
        <div className="hidden max-h-[32rem] overflow-auto rounded-md border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={cn("sticky top-0 z-20 bg-card", stickyFirstColumn && "left-0 z-30")}>Ticker</TableHead>
                <TableHead className="sticky top-0 z-20 bg-card">Market</TableHead>
                <TableHead className="sticky top-0 z-20 bg-card text-right">Market value</TableHead>
                <TableHead className="sticky top-0 z-20 bg-card text-right">Cost basis</TableHead>
                <TableHead className="sticky top-0 z-20 bg-card text-right">Unrealized</TableHead>
                <TableHead className="sticky top-0 z-20 bg-card text-right">Daily</TableHead>
                <TableHead className="sticky top-0 z-20 bg-card text-right">Weight</TableHead>
                <TableHead className="sticky top-0 z-20 bg-card">Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.rows.map((row) => (
                <TableRow key={`${row.ticker}-${row.marketCode}`}>
                  <TableCell className={cn("font-medium", stickyFirstColumn && "sticky left-0 z-10 bg-card")}>{row.ticker}</TableCell>
                  <TableCell>{row.marketCode}</TableCell>
                  <MoneyCell value={row.reportingMarketValueAmount} currency={row.reportingCurrency} locale={locale} />
                  <MoneyCell value={row.reportingCostBasisAmount} currency={row.reportingCurrency} locale={locale} />
                  <MoneyCell value={row.reportingUnrealizedPnlAmount} currency={row.reportingCurrency} locale={locale} />
                  <MoneyCell value={row.dailyChangeAmount} currency={row.reportingCurrency} locale={locale} />
                  <TableCell className="text-right">{row.reportingAllocationPercent === null ? "-" : formatPercent(row.reportingAllocationPercent, locale)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline">{row.quoteStatus}</Badge>
                      <Badge variant={row.fxStatus === "complete" ? "secondary" : "outline"}>FX {row.fxStatus}</Badge>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionRefreshButton({
  isRefreshing,
  onRefresh,
  testId,
}: {
  isRefreshing: boolean;
  onRefresh: () => void;
  testId: string;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onRefresh}
      disabled={isRefreshing}
      data-testid={testId}
    >
      <RefreshCw data-icon="inline-start" />
      Refresh
    </Button>
  );
}

function MoneyCell({ currency, locale, value }: { currency: AccountDefaultCurrency; locale: LocaleCode; value: number | null }) {
  return (
    <TableCell className="text-right font-mono tabular-nums">
      {value === null ? "-" : formatCurrencyAmount(value, currency, locale)}
    </TableCell>
  );
}

function HoldingsMobileList({ locale, rows }: { locale: LocaleCode; rows: ReportHoldingRowDto[] }) {
  const [selected, setSelected] = useState<ReportHoldingRowDto | null>(null);
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {rows.map((row) => (
        <button
          key={`${row.ticker}-${row.marketCode}`}
          type="button"
          className="rounded-md border border-border bg-background p-4 text-left"
          onClick={() => setSelected(row)}
          data-testid={`reports-mobile-row-${row.ticker}-${row.marketCode}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-foreground">{row.ticker}</p>
              <p className="mt-1 text-xs text-muted-foreground">{row.marketCode} · {formatNumber(row.quantity, locale, 2)} units</p>
            </div>
            <p className="font-mono text-sm font-semibold tabular-nums">
              {row.reportingMarketValueAmount === null ? "-" : formatCompactCurrencyAmount(row.reportingMarketValueAmount, row.reportingCurrency, locale)}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">{row.quoteStatus}</Badge>
            <Badge variant={row.fxStatus === "complete" ? "secondary" : "outline"}>FX {row.fxStatus}</Badge>
          </div>
        </button>
      ))}
      <Sheet open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected ? `${selected.ticker} · ${selected.marketCode}` : "Holding detail"}</SheetTitle>
            <SheetDescription>Exact report values for the selected holding row.</SheetDescription>
          </SheetHeader>
          {selected ? <HoldingDetail row={selected} locale={locale} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function HoldingDetail({ locale, row }: { locale: LocaleCode; row: ReportHoldingRowDto }) {
  const values = [
    ["Market value", row.reportingMarketValueAmount],
    ["Cost basis", row.reportingCostBasisAmount],
    ["Unrealized P&L", row.reportingUnrealizedPnlAmount],
    ["Daily change", row.dailyChangeAmount],
  ] as const;
  return (
    <div className="mt-5 flex flex-col gap-3">
      {values.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className="font-mono text-sm font-semibold tabular-nums">{value === null ? "-" : formatCurrencyAmount(value, row.reportingCurrency, locale)}</span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <span className="text-sm text-muted-foreground">Allocation</span>
        <span className="font-mono text-sm font-semibold tabular-nums">{row.reportingAllocationPercent === null ? "-" : formatPercent(row.reportingAllocationPercent, locale)}</span>
      </div>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true" data-testid="reports-loading-skeleton">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
      </div>
      <Skeleton className="h-80" />
      <Skeleton className="h-96" />
    </div>
  );
}

function formatShortDate(value: string, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
