"use client";

import Link from "next/link";
import {
  type CurrencyCode,
  type DashboardPerformanceDto,
  type DashboardPerformanceRange,
  type LocaleCode,
  type ValuationHealthDto,
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
import { Badge } from "../ui/shadcn/badge";
import { ChartContainer, type ChartConfig } from "../ui/shadcn/chart";
import { cn } from "../../lib/utils";
import { ToggleGroup, ToggleGroupItem } from "../ui/shadcn/toggle-group";
import { buildTimelineAxis, type TimelineMode } from "../../lib/timelineAxis";
import { ValuationHealthPanel } from "../valuation/ValuationHealthPanel";
import { getValuationHealthAdminRepairHref } from "../valuation/valuationHealthAdminLink";
import { financeGainDotClass, financeLossDotClass, holdingsFinanceToneClass } from "../holdings/holdingsStyle";

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
  showAdminActions?: boolean;
  tickerRepairReturnTo?: string | null;
  timelineMode: TimelineMode;
  onTimelineModeChange: (mode: TimelineMode) => void;
  valuationHealth?: ValuationHealthDto | null;
  dataHealthHref?: string;
  // KZO-161 (158C): optional click handler for the "Customize ranges" gear
  // icon. When omitted, the gear is hidden entirely so this card stays
  // usable in non-dashboard contexts (e.g. the shared-portfolio view).
  onOpenCustomize?: () => void;
}

interface ChartPoint {
  date: string;
  dateMs: number;
  totalCost: number | null;
  marketValue: number | null;
  totalReturn: number | null;
  isPartialMarketData?: boolean;
}

function buildChartConfig(dict: AppDictionary, totalReturnAmount: number | null): ChartConfig {
  const totalReturnColor = totalReturnAmount != null && totalReturnAmount < 0
    ? "hsl(var(--chart-direction-negative))"
    : "hsl(var(--chart-direction-positive))";
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
      color: totalReturnColor,
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
  showAdminActions = false,
  tickerRepairReturnTo = null,
  timelineMode,
  onTimelineModeChange,
  valuationHealth,
  dataHealthHref = "/reports?tab=portfolio&scope=all&health=1",
  onOpenCustomize,
}: PortfolioTrendCardProps) {
  const rangeItems = ranges && ranges.length > 0 ? ranges : RANGE_ITEMS;
  const points = data?.points ?? [];
  const latestPoint = points.at(-1) ?? null;
  const latestMarketValuePoint = [...points].reverse().find((point) => point.marketValueAmount !== null) ?? null;
  const latestTotalReturnPoint = [...points].reverse().find((point) => point.totalReturnAmount != null) ?? null;
  const lastReliableDate = data?.lastReliableDate ?? findLastReliablePointDate(points);
  const marketDataStaleSince = data?.marketDataStaleSince ?? null;
  const expectedLatestValuationDate = data?.diagnostics?.expectedLatestValuationDate ?? data?.requestedAsOf ?? null;
  const latestMarketValueDate = latestMarketValuePoint?.date ?? data?.diagnostics?.latestReliableValuationDate ?? lastReliableDate;
  const latestComparableDate = data?.diagnostics?.latestComparableSnapshotDate ?? null;
  const latestPartialDate = data?.diagnostics?.latestPartialSnapshotDate ?? null;
  const partialMarketPoints = points.filter((point) => point.isPartialMarketData && point.marketValueAmount !== null);
  const marketValueUsesLatestAvailableSnapshot = Boolean(
    latestMarketValueDate
      && expectedLatestValuationDate
      && latestMarketValueDate !== expectedLatestValuationDate,
  );
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
    dateMs: dateToUtcMs(point.date),
    totalCost: point.totalCostAmount,
    marketValue: point.marketValueAmount,
    totalReturn: point.totalReturnAmount ?? null,
    isPartialMarketData: point.isPartialMarketData,
  }));

  const chartConfig = buildChartConfig(dict, latestTotalReturnPoint?.totalReturnAmount ?? null);
  const chartAxis = resolveTimelineAxis(data, locale, range, timelineMode);
  const lastIndex = points.length - 1;
  const lastDate = points[lastIndex]?.date;
  const emptyStateMessage = resolveSnapshotEmptyStateMessage(data, dict, dict.dashboardHome.performanceEmpty);
  const adminRepairHref = showAdminActions
    ? getValuationHealthAdminRepairHref(valuationHealth)
    : null;

  return (
    <Card className="border border-slate-200/80 bg-[rgba(255,255,255,0.96)]" data-testid="dashboard-performance-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500/78">{dict.dashboardHome.performanceTitle}</p>
          <h2 className="mt-2 text-2xl text-slate-950 sm:text-3xl">{dict.dashboardHome.performanceTitle}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{dict.dashboardHome.performanceDescription}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
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
              aria-label={dict.settings.customizeRangesTitle}
              data-testid="timeframe-gear-btn"
              className="hidden h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 lg:inline-flex"
            >
              <span aria-hidden="true" className="text-sm leading-none">⚙</span>
            </button>
          ) : null}
          <ToggleGroup
            type="single"
            aria-label={dict.tickerHistory.chartTimelineLabel}
            value={timelineMode}
            onValueChange={(value) => {
              if (value === "auto" || value === "day" || value === "week" || value === "month" || value === "year") {
                onTimelineModeChange(value);
              }
            }}
            className="flex-wrap justify-end"
            data-testid="dashboard-performance-timeline"
          >
            {(["auto", "day", "week", "month", "year"] as const).map((mode) => (
              <ToggleGroupItem key={mode} value={mode}>
                {resolveTimelineLabel(dict, mode)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
          meta={formatMetricDateMeta(dict, locale, latestMarketValueDate, expectedLatestValuationDate)}
          badgeLabel={marketValueUsesLatestAvailableSnapshot ? dict.dashboardHome.latestAvailableSnapshot : undefined}
          metaTestId="dashboard-performance-market-value-meta"
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
            valueClassName={holdingsFinanceToneClass(latestTotalReturnPoint?.totalReturnAmount ?? null, "text-foreground")}
            swatchClassName={latestTotalReturnPoint?.totalReturnAmount != null && latestTotalReturnPoint.totalReturnAmount < 0 ? financeLossDotClass : financeGainDotClass}
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
          {latestPartialDate ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-warning"
              data-testid="dashboard-performance-partial-marker"
            >
              {dict.dashboardHome.performancePartialMarkerLabel}
              <TooltipInfo
                label={dict.dashboardHome.performancePartialMarkerLabel}
                content={formatPartialMarketTooltip(dict, latestPartialDate, latestComparableDate, locale)}
                triggerTestId="dashboard-performance-partial-tooltip-trigger"
                contentTestId="dashboard-performance-partial-tooltip-content"
              />
            </span>
          ) : null}
        </div>
      ) : null}

      {marketDataStaleSince ? (
        <div
          className="mt-3 rounded-[18px] border border-warning/60 bg-warning/10 px-4 py-3 text-sm text-warning"
          data-testid="dashboard-performance-stale-warning"
        >
          <p>{formatStaleDataWarning(dict, marketDataStaleSince, locale)}</p>
          <Link
            href={dataHealthHref}
            className="mt-2 inline-flex font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary/80"
            data-testid="dashboard-performance-stale-data-health-link"
          >
            {dict.reports.viewDataHealth}
          </Link>
        </div>
      ) : null}

      {valuationHealth ? (
        <ValuationHealthPanel
          adminRepairHref={adminRepairHref}
          className="mt-4"
          copy={dict.valuationHealth}
          locale={locale}
          showAdminActions={showAdminActions}
          tickerRepairReturnTo={tickerRepairReturnTo}
          valuationHealth={valuationHealth}
        />
      ) : null}
      {valuationHealth && valuationHealth.status !== "healthy" ? (
        <Link
          href={dataHealthHref}
          className="mt-3 inline-flex text-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary/80"
          data-testid="dashboard-performance-valuation-data-health-link"
        >
          {dict.reports.viewDataHealth}
        </Link>
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
      ) : !hasPoints || !hasMarketValue ? (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-[28px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-12 text-sm text-slate-600">
          <span>{emptyStateMessage}</span>
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
                dataKey="dateMs"
                type="number"
                scale="time"
                domain={chartAxis.domain}
                ticks={chartAxis.ticks}
                tick={{ fontSize: 11 }}
                tickFormatter={chartAxis.tickFormatter}
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
                labelFormatter={(value: number | string) =>
                  typeof value === "number" ? formatAxisDateLabel(msToIsoDate(value), locale) : value
                }
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
                  x={dateToUtcMs(lastDate)}
                  y={latestPoint.totalCostAmount}
                  r={5}
                  fill="var(--color-totalCost)"
                  stroke="none"
                  isFront
                />
              ) : null}
              {latestMarketValuePoint && latestMarketValuePoint.marketValueAmount !== null ? (
                <ReferenceDot
                  x={dateToUtcMs(latestMarketValuePoint.date)}
                  y={latestMarketValuePoint.marketValueAmount}
                  r={6}
                  fill="var(--color-marketValue)"
                  stroke="none"
                  isFront
                />
              ) : null}
              {latestTotalReturnPoint?.totalReturnAmount != null && latestTotalReturnPoint.date ? (
                <ReferenceDot
                  x={dateToUtcMs(latestTotalReturnPoint.date)}
                  y={latestTotalReturnPoint.totalReturnAmount}
                  r={5}
                  fill="var(--color-totalReturn)"
                  stroke="none"
                  isFront
                />
              ) : null}
              {partialMarketPoints.map((point) => (
                <ReferenceDot
                  key={`partial-${point.date}`}
                  x={dateToUtcMs(point.date)}
                  y={point.marketValueAmount ?? 0}
                  r={7}
                  fill="transparent"
                  stroke="hsl(var(--warning))"
                  strokeWidth={3}
                  isFront
                />
              ))}
            </ComposedChart>
          </ChartContainer>
        </div>
      )}
    </Card>
  );
}

function LegendMetric({
  label,
  value,
  meta,
  metaTestId,
  badgeLabel,
  swatchClassName,
  valueClassName,
}: {
  label: string;
  value: string;
  meta?: string | null;
  metaTestId?: string;
  badgeLabel?: string;
  swatchClassName: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-[22px] border border-border bg-card px-4 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", swatchClassName)} aria-hidden="true" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        {badgeLabel ? <Badge variant="outline" className="font-medium">{badgeLabel}</Badge> : null}
      </div>
      <p className={cn("mt-3 text-lg font-semibold text-foreground", valueClassName)}>{value}</p>
      {meta ? (
        <p className="mt-2 text-xs text-muted-foreground" data-testid={metaTestId}>
          {meta}
        </p>
      ) : null}
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

function resolveRangeStartDate(
  range: DashboardPerformanceRange,
  endDate: string,
  firstPointDate?: string,
): string {
  const end = utcDateFromIso(endDate);
  const match = /^(\d+)([MY])$/.exec(range);
  if (range === "YTD") {
    end.setUTCMonth(0, 1);
    return toIsoDate(end);
  }
  if (range === "ALL") {
    return firstPointDate ?? endDate;
  }
  if (match) {
    const amount = Number(match[1]);
    if (match[2] === "M") {
      end.setUTCMonth(end.getUTCMonth() - amount);
      return toIsoDate(end);
    }
    end.setUTCFullYear(end.getUTCFullYear() - amount);
    return toIsoDate(end);
  }
  return firstPointDate ?? endDate;
}

function resolveTimelineAxis(
  data: DashboardPerformanceDto | null,
  locale: LocaleCode,
  range: DashboardPerformanceRange,
  mode: TimelineMode,
) {
  const points = data?.points ?? [];
  const fallbackEndDate = points.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const endDate = data?.rangeEndDate ?? data?.requestedAsOf ?? fallbackEndDate;
  const startDate = data?.rangeStartDate ?? resolveRangeStartDate(range, endDate, points.at(0)?.date);
  return buildTimelineAxis({
    endDate,
    locale,
    mode,
    pointDates: points.map((point) => point.date),
    startDate,
  });
}

function dateToUtcMs(value: string): number {
  return utcDateFromIso(value).getTime();
}

function msToIsoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function resolveSnapshotEmptyStateMessage(
  data: DashboardPerformanceDto | null,
  dict: AppDictionary,
  fallback: string,
): string {
  const reasons = data?.diagnostics?.knownGapReasons ?? [];
  if (reasons.includes("missing_fx")) return dict.dashboardHome.snapshotsEmptyMissingFx;
  if (reasons.includes("stale_snapshot") || data?.diagnostics?.staleSinceDate || data?.marketDataStaleSince) {
    return dict.dashboardHome.snapshotsEmptyStaleSnapshot;
  }
  if (reasons.includes("missing_snapshot")) return dict.dashboardHome.snapshotsEmptyMissingSnapshot;
  return fallback;
}

function utcDateFromIso(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
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

function formatPartialMarketTooltip(
  dict: AppDictionary,
  partialDate: string,
  comparableDate: string | null,
  locale: LocaleCode,
): string {
  return dict.dashboardHome.performancePartialMarkerTooltip
    .replace("{partialDate}", formatAxisDateLabel(partialDate, locale))
    .replace(
      "{comparableDate}",
      comparableDate ? formatAxisDateLabel(comparableDate, locale) : dict.dashboardHome.noMarketValue,
    );
}

function formatMetricDateMeta(
  dict: AppDictionary,
  locale: LocaleCode,
  actualDate: string | null,
  requestedDate: string | null,
): string | null {
  const parts: string[] = [];
  if (actualDate) {
    parts.push(`${dict.dashboardHome.asOfLabel} ${formatAxisDateLabel(actualDate, locale)}`);
  }
  if (requestedDate && requestedDate !== actualDate) {
    parts.push(
      dict.dashboardHome.requestedAsOfLabel.replace("{date}", formatAxisDateLabel(requestedDate, locale)),
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
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

function resolveTimelineLabel(dict: AppDictionary, mode: TimelineMode) {
  if (mode === "auto") return dict.reports.timelineAuto;
  if (mode === "day") return dict.reports.timelineDay;
  if (mode === "week") return dict.reports.timelineWeek;
  if (mode === "month") return dict.reports.timelineMonth;
  return dict.reports.timelineYear;
}
