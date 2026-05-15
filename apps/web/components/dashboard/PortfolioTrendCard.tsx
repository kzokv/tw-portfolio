"use client";

import {
  type CurrencyCode,
  type DashboardPerformanceDto,
  type DashboardPerformancePointDto,
  type DashboardPerformanceRange,
  type LocaleCode,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
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
  const hasPoints = points.length > 0;
  const hasMarketValue = points.some((point) => point.marketValueAmount !== null);
  const hasTotalReturn = points.some((point) => point.totalReturnAmount != null);
  // KZO-180: `totalCostAmount` is nullable when `fxAvailable === false`.
  // Treat null as "not partial" since the partial-quote warning is about a
  // missing market quote against a known cost basis, not a missing FX rate.
  const hasPartialQuotes = points.some(
    (point) => point.totalCostAmount !== null && point.totalCostAmount > 0 && point.marketValueAmount === null,
  );

  const { totalCostPath, marketValuePath, totalReturnPath, marketValueArea, yLabels, xLabels } = buildChartGeometry(points, locale);

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
        <div className="mt-5 rounded-[20px] border border-[rgba(251,113,133,0.24)] bg-[rgba(254,226,226,0.92)] px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <LegendMetric
          label={dict.dashboardHome.performanceMarketValueSeriesLabel}
          value={latestMarketValuePoint?.marketValueAmount !== null && latestMarketValuePoint?.marketValueAmount !== undefined
            ? formatCurrencyAmount(latestMarketValuePoint.marketValueAmount, currency, locale)
            : dict.dashboardHome.noMarketValue}
          swatchClassName="bg-indigo-500"
        />
        <LegendMetric
          label={dict.dashboardHome.performanceTotalCostSeriesLabel}
          value={latestPoint && latestPoint.totalCostAmount !== null
            ? formatCurrencyAmount(latestPoint.totalCostAmount, currency, locale)
            : dict.dashboardHome.noMarketValue}
          swatchClassName="bg-slate-400"
        />
        {hasTotalReturn ? (
          <LegendMetric
            label={dict.dashboardHome.snapshotsTotalReturnSeriesLabel}
            value={latestTotalReturnPoint?.totalReturnAmount != null
              ? formatCurrencyAmount(latestTotalReturnPoint.totalReturnAmount, currency, locale)
              : dict.dashboardHome.noMarketValue}
            swatchClassName="bg-emerald-500"
          />
        ) : null}
      </div>

      {hasPartialQuotes ? (
        <p
          className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
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
        <div className="mt-6 rounded-[28px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-12 text-sm text-slate-600">
          {dict.dashboardHome.performanceEmpty}
        </div>
      ) : (
        <div className="mt-6 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] sm:p-5">
          <svg
            viewBox="0 0 760 320"
            className="h-[20rem] w-full"
            role="img"
            aria-label={dict.dashboardHome.performanceTitle}
            data-testid="dashboard-performance-chart"
          >
            <defs>
              <linearGradient id="portfolio-trend-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.04" />
              </linearGradient>
            </defs>

            <g>
              {yLabels.map((label) => (
                <g key={label.value}>
                  <line x1="68" x2="728" y1={label.y} y2={label.y} stroke="rgba(148,163,184,0.22)" strokeDasharray="4 6" />
                  <text x="12" y={label.y + 4} fill="#64748b" fontSize="11">
                    {label.label}
                  </text>
                </g>
              ))}
              {xLabels.map((label) => (
                <text key={`${label.index}-${label.label}`} x={label.x} y="302" fill="#64748b" fontSize="11" textAnchor="middle">
                  {label.label}
                </text>
              ))}
            </g>

            {marketValueArea ? <path d={marketValueArea} fill="url(#portfolio-trend-fill)" /> : null}
            <path d={totalCostPath} fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            {hasMarketValue ? (
              <path d={marketValuePath} fill="none" stroke="#4f46e5" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            ) : null}
            {hasTotalReturn ? (
              <path d={totalReturnPath} fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="8 4" />
            ) : null}

            {latestPoint ? (
              <g>
                {latestPoint.totalCostAmount !== null ? (
                  <circle cx={resolvePointX(points)} cy={resolvePointY(latestPoint.totalCostAmount, points)} r="5" fill="#94a3b8" />
                ) : null}
                {latestPoint.marketValueAmount !== null ? (
                  <circle cx={resolvePointX(points)} cy={resolvePointY(latestPoint.marketValueAmount, points)} r="6" fill="#4f46e5" />
                ) : null}
                {latestTotalReturnPoint?.totalReturnAmount != null ? (
                  <circle cx={resolvePointX(points)} cy={resolvePointY(latestTotalReturnPoint.totalReturnAmount, points)} r="5" fill="#10b981" />
                ) : null}
              </g>
            ) : null}
          </svg>
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

function buildChartGeometry(points: DashboardPerformancePointDto[], locale: LocaleCode) {
  if (points.length === 0) {
    return {
      totalCostPath: "",
      marketValuePath: "",
      totalReturnPath: "",
      marketValueArea: "",
      yLabels: [] as Array<{ y: number; label: string; value: number }>,
      xLabels: [] as Array<{ x: number; label: string; index: number }>,
    };
  }

  const chartLeft = 68;
  const chartTop = 24;
  const chartWidth = 660;
  const chartHeight = 244;
  // KZO-180: filter out null values (`fxAvailable === false`) before scaling.
  const values = points.flatMap((point) => {
    const cost = point.totalCostAmount;
    const mv = point.marketValueAmount ?? cost;
    const out: number[] = [];
    if (cost !== null) out.push(cost);
    if (mv !== null) out.push(mv);
    if (point.totalReturnAmount != null) out.push(point.totalReturnAmount);
    return out;
  });
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values, 1) : 1;
  const paddedMin = minValue - Math.abs(minValue) * 0.08;
  const paddedMax = maxValue * 1.06;
  const scaleX = (index: number) => chartLeft + ((chartWidth * index) / Math.max(points.length - 1, 1));
  const scaleY = (value: number) => chartTop + chartHeight - ((value - paddedMin) / Math.max(paddedMax - paddedMin, 1)) * chartHeight;

  const totalCostPath = buildLinePath(points, scaleX, scaleY, (point) => point.totalCostAmount);
  const marketValuePath = buildLinePath(points, scaleX, scaleY, (point) => point.marketValueAmount);
  const totalReturnPath = buildLinePath(points, scaleX, scaleY, (point) => point.totalReturnAmount ?? null);
  const areaPoints = points.filter((point) => point.marketValueAmount !== null);
  const marketValueArea = areaPoints.length === points.length
    ? `${marketValuePath} L ${scaleX(points.length - 1)} ${chartTop + chartHeight} L ${scaleX(0)} ${chartTop + chartHeight} Z`
    : "";

  const yLabels = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const value = paddedMax - (paddedMax - paddedMin) * ratio;
    return {
      y: chartTop + chartHeight * ratio,
      value,
      label: formatCompactCurrency(value, locale),
    };
  });

  const xLabelIndexes = Array.from(new Set([
    0,
    Math.floor((points.length - 1) / 3),
    Math.floor(((points.length - 1) * 2) / 3),
    points.length - 1,
  ]));
  const xLabels = xLabelIndexes.map((index) => ({
    index,
    x: scaleX(index),
    label: formatAxisDateLabel(points[index].date, locale),
  }));

  return {
    totalCostPath,
    marketValuePath,
    totalReturnPath,
    marketValueArea,
    yLabels,
    xLabels,
  };
}

function buildLinePath(
  points: DashboardPerformancePointDto[],
  scaleX: (index: number) => number,
  scaleY: (value: number) => number,
  valueResolver: (point: DashboardPerformancePointDto) => number | null,
): string {
  return points.reduce((path, point, index) => {
    const value = valueResolver(point);
    if (value === null) {
      return path;
    }

    const command = path ? "L" : "M";
    return `${path}${command} ${scaleX(index)} ${scaleY(value)} `;
  }, "").trim();
}

function resolvePointY(value: number, points: DashboardPerformancePointDto[]): number {
  // KZO-180: filter null values (`fxAvailable === false`) before scaling.
  const values = points.flatMap((point) => {
    const cost = point.totalCostAmount;
    const mv = point.marketValueAmount ?? cost;
    const out: number[] = [];
    if (cost !== null) out.push(cost);
    if (mv !== null) out.push(mv);
    if (point.totalReturnAmount != null) out.push(point.totalReturnAmount);
    return out;
  });
  const minValue = values.length > 0 ? Math.min(...values) : 0;
  const maxValue = values.length > 0 ? Math.max(...values, 1) : 1;
  const paddedMin = minValue - Math.abs(minValue) * 0.08;
  const paddedMax = maxValue * 1.06;
  const chartTop = 24;
  const chartHeight = 244;

  return chartTop + chartHeight - ((value - paddedMin) / Math.max(paddedMax - paddedMin, 1)) * chartHeight;
}

function resolvePointX(points: DashboardPerformancePointDto[]): number {
  const chartLeft = 68;
  const chartWidth = 660;
  return chartLeft + ((chartWidth * Math.max(points.length - 1, 0)) / Math.max(points.length - 1, 1));
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
