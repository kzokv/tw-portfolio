"use client";

import {
  type CurrencyCode,
  type DashboardPerformanceDto,
  type DashboardPerformanceRange,
  type LocaleCode,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
} from "@vakwen/shared-types";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TooltipInfo } from "../ui/TooltipInfo";
import { ChartContainer, type ChartConfig } from "../ui/shadcn/chart";
import { cn } from "../../lib/utils";

const RANGE_ITEMS: DashboardPerformanceRange[] = [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES];

interface PortfolioTrendCardProps {
  data: DashboardPerformanceDto | null;
  range: DashboardPerformanceRange;
  // KZO-159 (158A): optional override list resolved through the 3-tier
  // user → admin → default precedence. When omitted, falls back to the
  // hardcoded DEFAULT_DASHBOARD_PERFORMANCE_RANGES so older callers and
  // tests keep working.
  ranges?: DashboardPerformanceRange[];
  currency: CurrencyCode;
  locale: LocaleCode;
  dict: AppDictionary;
  isLoading: boolean;
  errorMessage: string;
  onRangeChange: (range: DashboardPerformanceRange) => void;
  // KZO-161 (158C): optional click handler for the "Customize ranges" gear
  // icon. When omitted, the gear is hidden entirely so this card stays
  // usable in non-dashboard contexts (e.g. the shared-portfolio view).
  onOpenCustomize?: () => void;
}

interface ChartPoint {
  date: string;
  totalCost: number | null;
  marketValue: number | null;
  totalReturn: number | null;
}

function buildChartConfig(dict: AppDictionary): ChartConfig {
  return {
    marketValue: {
      label: dict.dashboardHome.performanceMarketValueSeriesLabel,
      color: "hsl(var(--chart-primary))",
    },
    totalCost: {
      label: dict.dashboardHome.performanceTotalCostSeriesLabel,
      color: "hsl(var(--chart-muted))",
    },
    totalReturn: {
      label: dict.dashboardHome.snapshotsTotalReturnSeriesLabel,
      color: "hsl(var(--chart-positive))",
    },
  };
}

export function PortfolioTrendCard({
  data,
  range,
  ranges,
  currency,
  locale,
  dict,
  isLoading,
  errorMessage,
  onRangeChange,
  onOpenCustomize,
}: PortfolioTrendCardProps) {
  const rangeItems = ranges && ranges.length > 0 ? ranges : RANGE_ITEMS;
  const points = data?.points ?? [];
  const latestPoint = points.at(-1) ?? null;
  const latestMarketValuePoint = [...points].reverse().find((point) => point.marketValueAmount !== null) ?? null;
  const latestTotalReturnPoint = [...points].reverse().find((point) => point.totalReturnAmount != null) ?? null;
  const lastReliableDate = data?.lastReliableDate ?? findLastReliablePointDate(points);
  const marketDataStaleSince = data?.marketDataStaleSince ?? null;
  const hasPoints = points.length > 0;
  const hasMarketValue = points.some((point) => point.marketValueAmount !== null);
  const hasTotalReturn = points.some((point) => point.totalReturnAmount != null);
  // KZO-180: `totalCostAmount` is nullable when `fxAvailable === false`.
  // Treat null as "not partial" since the partial-quote warning is about a
  // missing market quote against a known cost basis, not a missing FX rate.
  const hasPartialQuotes = points.some(
    (point) => point.totalCostAmount !== null && point.totalCostAmount > 0 && point.marketValueAmount === null,
  );
  // Show the gradient area only when EVERY point has a market value
  // (matches pre-Phase-6 buildChartGeometry behavior: areaPoints.length === points.length).
  // NB: this is NOT the same as `!hasPartialQuotes` — a point with
  // `totalCostAmount === null` or `totalCostAmount === 0` and
  // `marketValueAmount === null` is "missing" for area purposes but does NOT
  // trigger the partial-quote warning (which gates on a positive cost basis).
  const showArea = hasPoints && points.every((point) => point.marketValueAmount !== null);

  const chartData: ChartPoint[] = points.map((point) => ({
    date: point.date,
    totalCost: point.totalCostAmount,
    marketValue: point.marketValueAmount,
    totalReturn: point.totalReturnAmount ?? null,
  }));

  const chartConfig = buildChartConfig(dict);
  const lastIndex = points.length - 1;
  const lastDate = points[lastIndex]?.date;

  return (
    <Card className="border border-slate-200/80 bg-[rgba(255,255,255,0.96)]" data-testid="dashboard-performance-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500/78">{dict.dashboardHome.performanceTitle}</p>
          <h2 className="mt-2 text-2xl text-slate-950 sm:text-3xl">{dict.dashboardHome.performanceTitle}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{dict.dashboardHome.performanceDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 p-1 shadow-[0_12px_24px_rgba(148,163,184,0.08)]">
            {rangeItems.map((item) => (
              <Button
                key={item}
                variant={item === range ? "default" : "secondary"}
                size="sm"
                className={cn(
                  "rounded-full border-transparent px-3 text-[11px] font-semibold uppercase tracking-[0.16em]",
                  item !== range && "bg-transparent shadow-none",
                )}
                data-testid={`dashboard-performance-range-${item.toLowerCase()}`}
                onClick={() => onRangeChange(item)}
                aria-pressed={item === range}
              >
                {resolveRangeLabel(dict, item)}
              </Button>
            ))}
          </div>
          {onOpenCustomize ? (
            <button
              type="button"
              onClick={onOpenCustomize}
              aria-label={dict.settings.customizeRangesTitle ?? "Customize timeframes"}
              data-testid="timeframe-gear-btn"
              className="hidden h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 lg:inline-flex"
            >
              <span aria-hidden="true" className="text-sm leading-none">⚙</span>
            </button>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-5 rounded-[20px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <LegendMetric
          label={dict.dashboardHome.performanceMarketValueSeriesLabel}
          value={latestMarketValuePoint?.marketValueAmount !== null && latestMarketValuePoint?.marketValueAmount !== undefined
            ? formatCurrencyAmount(latestMarketValuePoint.marketValueAmount, currency, locale)
            : dict.dashboardHome.noMarketValue}
          swatchClassName="bg-[hsl(var(--chart-primary))]"
        />
        <LegendMetric
          label={dict.dashboardHome.performanceTotalCostSeriesLabel}
          value={latestPoint && latestPoint.totalCostAmount !== null
            ? formatCurrencyAmount(latestPoint.totalCostAmount, currency, locale)
            : dict.dashboardHome.noMarketValue}
          swatchClassName="bg-[hsl(var(--chart-muted))]"
        />
        {hasTotalReturn ? (
          <LegendMetric
            label={dict.dashboardHome.snapshotsTotalReturnSeriesLabel}
            value={latestTotalReturnPoint?.totalReturnAmount != null
              ? formatCurrencyAmount(latestTotalReturnPoint.totalReturnAmount, currency, locale)
              : dict.dashboardHome.noMarketValue}
            swatchClassName="bg-[hsl(var(--chart-positive))]"
          />
        ) : null}
      </div>

      {lastReliableDate ? (
        <div
          className="mt-4 flex flex-wrap items-center gap-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-500"
          data-testid="dashboard-performance-as-of"
        >
          <span>{dict.dashboardHome.asOfLabel} {formatAxisDateLabel(lastReliableDate, locale)}</span>
          <TooltipInfo
            label={dict.dashboardHome.performanceTitle}
            content={formatSnapshotAsOfTooltip(dict, lastReliableDate, locale)}
            triggerTestId="dashboard-performance-as-of-tooltip-trigger"
            contentTestId="dashboard-performance-as-of-tooltip-content"
          />
        </div>
      ) : null}

      {marketDataStaleSince ? (
        <p
          className="mt-3 rounded-[18px] border border-warning/60 bg-warning/10 px-4 py-3 text-sm text-warning"
          data-testid="dashboard-performance-stale-warning"
        >
          {formatStaleDataWarning(dict, marketDataStaleSince, locale)}
        </p>
      ) : null}

      {hasPartialQuotes ? (
        <p
          className="mt-4 rounded-[18px] border border-warning/60 bg-warning/10 px-4 py-3 text-sm text-warning"
          data-testid="dashboard-performance-partial-warning"
        >
          {dict.dashboardHome.performancePartialQuoteWarning}
        </p>
      ) : null}

      {isLoading ? (
        <div className="mt-6 h-[22rem] rounded-[28px] border border-slate-200 bg-slate-50/85 p-5" aria-hidden="true">
          <div className="skeleton-line h-4 w-36 rounded" />
          <div className="skeleton-line skeleton-line--delay mt-6 h-[16rem] w-full rounded-[24px]" />
        </div>
      ) : !hasPoints ? (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-[28px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-12 text-sm text-slate-600">
          <span>{dict.dashboardHome.performanceEmpty}</span>
          <TooltipInfo
            label={dict.dashboardHome.performanceTitle}
            content={dict.dashboardHome.performanceSnapshotOnlyTooltip}
            triggerTestId="dashboard-performance-empty-tooltip-trigger"
            contentTestId="dashboard-performance-empty-tooltip-content"
          />
        </div>
      ) : (
        <div className="mt-6 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] sm:p-5">
          <ChartContainer
            config={chartConfig}
            className="h-[20rem] w-full aspect-auto"
            role="img"
            aria-label={dict.dashboardHome.performanceTitle}
            data-testid="dashboard-performance-chart"
          >
            <ComposedChart data={chartData} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
              <defs>
                <linearGradient id="portfolio-trend-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-marketValue)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-marketValue)" stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 6" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(value: string) => formatAxisDateLabel(value, locale)}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(value: number) => formatCompactCurrency(value, locale)}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                formatter={(value: number | string) =>
                  typeof value === "number"
                    ? formatCurrencyAmount(value, currency, locale)
                    : value
                }
                labelFormatter={(value: string) => formatAxisDateLabel(value, locale)}
              />
              {showArea ? (
                <Area
                  type="monotone"
                  dataKey="marketValue"
                  stroke="var(--color-marketValue)"
                  strokeWidth={4}
                  fill="url(#portfolio-trend-fill)"
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : hasMarketValue ? (
                <Line
                  type="monotone"
                  dataKey="marketValue"
                  stroke="var(--color-marketValue)"
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : null}
              <Line
                type="monotone"
                dataKey="totalCost"
                stroke="var(--color-totalCost)"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              {hasTotalReturn ? (
                <Line
                  type="monotone"
                  dataKey="totalReturn"
                  stroke="var(--color-totalReturn)"
                  strokeWidth={3}
                  strokeDasharray="8 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : null}
              {/* Latest-point markers (one per series at the rightmost data point). */}
              {latestPoint && latestPoint.totalCostAmount !== null && lastDate ? (
                <ReferenceDot
                  x={lastDate}
                  y={latestPoint.totalCostAmount}
                  r={5}
                  fill="var(--color-totalCost)"
                  stroke="none"
                  isFront
                />
              ) : null}
              {latestPoint && latestPoint.marketValueAmount !== null && lastDate ? (
                <ReferenceDot
                  x={lastDate}
                  y={latestPoint.marketValueAmount}
                  r={6}
                  fill="var(--color-marketValue)"
                  stroke="none"
                  isFront
                />
              ) : null}
              {latestTotalReturnPoint?.totalReturnAmount != null && latestTotalReturnPoint.date ? (
                <ReferenceDot
                  x={latestTotalReturnPoint.date}
                  y={latestTotalReturnPoint.totalReturnAmount}
                  r={5}
                  fill="var(--color-totalReturn)"
                  stroke="none"
                  isFront
                />
              ) : null}
            </ComposedChart>
          </ChartContainer>
        </div>
      )}
    </Card>
  );
}

function LegendMetric({ label, value, swatchClassName }: { label: string; value: string; swatchClassName: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200 bg-white/88 px-4 py-4 shadow-[0_12px_24px_rgba(148,163,184,0.08)]">
      <div className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", swatchClassName)} aria-hidden="true" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      </div>
      <p className="mt-3 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function formatCompactCurrency(value: number, locale: LocaleCode): string {
  const intlLocale = locale === "zh-TW" ? "zh-TW" : "en-US";
  return new Intl.NumberFormat(intlLocale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatAxisDateLabel(value: string, locale: LocaleCode): string {
  const intlLocale = locale === "zh-TW" ? "zh-TW" : "en-US";
  return new Intl.DateTimeFormat(intlLocale, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatStaleDataWarning(dict: AppDictionary, date: string, locale: LocaleCode): string {
  return dict.dashboardHome.performanceStaleDataWarning.replace(
    "{date}",
    formatAxisDateLabel(date, locale),
  );
}

function formatSnapshotAsOfTooltip(dict: AppDictionary, date: string, locale: LocaleCode): string {
  return dict.dashboardHome.performanceSnapshotAsOfTooltip.replace(
    "{date}",
    formatAxisDateLabel(date, locale),
  );
}

function findLastReliablePointDate(points: DashboardPerformanceDto["points"]): string | null {
  return [...points].reverse().find((point) =>
    point.fxAvailable && point.marketValueAmount !== null && point.totalCostAmount !== null,
  )?.date ?? null;
}

function resolveRangeLabel(dict: AppDictionary, range: DashboardPerformanceRange): string {
  if (range === "1M") return dict.dashboardHome.range1MLabel;
  if (range === "3M") return dict.dashboardHome.range3MLabel;
  if (range === "YTD") return dict.dashboardHome.rangeYtdLabel;
  if (range === "1Y") return dict.dashboardHome.range1YLabel;
  // KZO-159 (158A): for admin/user-extended ranges (e.g. 5Y, 10Y, 18M)
  // there is no localized i18n key — render the raw range token. This
  // keeps the four hardcoded labels intact while making the broader
  // chip palette readable.
  return range;
}
