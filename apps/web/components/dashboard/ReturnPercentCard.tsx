"use client";

import type { DashboardPerformanceDto, DashboardPerformanceRange, LocaleCode } from "@vakwen/shared-types";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AppDictionary } from "../../lib/i18n";
import { Card } from "../ui/Card";
import { TooltipInfo } from "../ui/TooltipInfo";
import { ChartContainer, type ChartConfig } from "../ui/shadcn/chart";

interface ReturnPercentCardProps {
  data: DashboardPerformanceDto | null;
  locale: LocaleCode;
  dict: AppDictionary;
  isLoading: boolean;
  errorMessage: string;
}

interface ChartPoint {
  date: string;
  dateMs: number;
  totalReturnPercent: number | null;
}

function buildChartConfig(dict: AppDictionary): ChartConfig {
  return {
    totalReturnPercent: {
      label: dict.dashboardHome.snapshotsReturnPercentSeriesLabel,
      color: "hsl(var(--chart-primary))",
    },
  };
}

export function ReturnPercentCard({
  data,
  locale,
  dict,
  isLoading,
  errorMessage,
}: ReturnPercentCardProps) {
  const points = data?.points ?? [];
  const hasPoints = points.length > 0;
  const hasReturnPercent = points.some((point) => point.totalReturnPercent != null);
  const latestReturnPoint = [...points].reverse().find((point) => point.totalReturnPercent != null) ?? null;
  const lastReliableDate = data?.lastReliableDate ?? findLastReliablePointDate(points);
  const marketDataStaleSince = data?.marketDataStaleSince ?? null;
  // KZO-180: `totalCostAmount` is nullable when `fxAvailable === false`.
  // Treat null as "not provisional" since the provisional warning is about a
  // pending market quote against a known cost basis, not a missing FX rate.
  const hasProvisional = points.some(
    (point) => point.totalReturnPercent == null && point.totalCostAmount !== null && point.totalCostAmount > 0,
  );

  const chartData: ChartPoint[] = points.map((point) => ({
    date: point.date,
    dateMs: dateToUtcMs(point.date),
    totalReturnPercent: point.totalReturnPercent ?? null,
  }));

  const chartConfig = buildChartConfig(dict);
  const chartDomain = resolvePerformanceChartDomain(data);
  const chartTicks = buildTimeAxisTicks(chartDomain);

  return (
    <Card className="border border-slate-200/80 bg-[rgba(255,255,255,0.96)]" data-testid="dashboard-return-percent-card">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500/78">
          {dict.dashboardHome.snapshotsReturnPercentTitle}
        </p>
        <h2 className="mt-2 text-2xl text-slate-950 sm:text-3xl">
          {dict.dashboardHome.snapshotsReturnPercentTitle}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          {dict.dashboardHome.snapshotsReturnPercentDescription}
        </p>
      </div>

      {errorMessage ? (
        <div className="mt-5 rounded-[20px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      ) : null}

      {hasReturnPercent && latestReturnPoint?.totalReturnPercent != null ? (
        <div className="mt-6">
          <div className="rounded-[22px] border border-slate-200 bg-white/88 px-4 py-4 shadow-[0_12px_24px_rgba(148,163,184,0.08)]">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--chart-primary))]"
                aria-hidden="true"
              />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {dict.dashboardHome.snapshotsReturnPercentSeriesLabel}
              </p>
            </div>
            <p className="mt-3 text-lg font-semibold text-slate-950">
              {formatPercent(latestReturnPoint.totalReturnPercent, locale)}
            </p>
          </div>
        </div>
      ) : null}

      {hasProvisional ? (
        <p
          className="mt-4 rounded-[18px] border border-warning/60 bg-warning/10 px-4 py-3 text-sm text-warning"
          data-testid="dashboard-return-percent-provisional-warning"
        >
          {dict.dashboardHome.snapshotsProvisionalWarning}
        </p>
      ) : null}

      {lastReliableDate ? (
        <div
          className="mt-4 flex flex-wrap items-center gap-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-500"
          data-testid="dashboard-return-percent-as-of"
        >
          <span>{dict.dashboardHome.asOfLabel} {formatAxisDateLabel(lastReliableDate, locale)}</span>
          <TooltipInfo
            label={dict.dashboardHome.snapshotsReturnPercentTitle}
            content={formatSnapshotAsOfTooltip(dict, lastReliableDate, locale)}
            triggerTestId="dashboard-return-percent-as-of-tooltip-trigger"
            contentTestId="dashboard-return-percent-as-of-tooltip-content"
          />
        </div>
      ) : null}

      {marketDataStaleSince ? (
        <p
          className="mt-3 rounded-[18px] border border-warning/60 bg-warning/10 px-4 py-3 text-sm text-warning"
          data-testid="dashboard-return-percent-stale-warning"
        >
          {formatStaleDataWarning(dict, marketDataStaleSince, locale)}
        </p>
      ) : null}

      {isLoading ? (
        <div className="mt-6 h-[18rem] rounded-[28px] border border-slate-200 bg-slate-50/85 p-5" aria-hidden="true">
          <div className="skeleton-line h-4 w-36 rounded" />
          <div className="skeleton-line skeleton-line--delay mt-6 h-[12rem] w-full rounded-[24px]" />
        </div>
      ) : !hasPoints || !hasReturnPercent ? (
        <div className="mt-6 flex items-center justify-center gap-2 rounded-[28px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-12 text-sm text-slate-600">
          <span>{dict.dashboardHome.snapshotsEmpty}</span>
          <TooltipInfo
            label={dict.dashboardHome.snapshotsReturnPercentTitle}
            content={dict.dashboardHome.performanceSnapshotOnlyTooltip}
            triggerTestId="dashboard-return-percent-empty-tooltip-trigger"
            contentTestId="dashboard-return-percent-empty-tooltip-content"
          />
        </div>
      ) : (
        <div className="mt-6 rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.96))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] sm:p-5">
          <ChartContainer
            config={chartConfig}
            className="h-[16rem] w-full aspect-auto"
            role="img"
            aria-label={dict.dashboardHome.snapshotsReturnPercentTitle}
            data-testid="dashboard-return-percent-chart"
          >
            <LineChart data={chartData} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="4 6" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="dateMs"
                type="number"
                scale="time"
                domain={chartDomain}
                ticks={chartTicks}
                tick={{ fontSize: 11 }}
                tickFormatter={(value: number) => formatAxisDateLabel(msToIsoDate(value), locale)}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                formatter={(value: number | string) =>
                  typeof value === "number" ? formatPercent(value, locale) : value
                }
                labelFormatter={(value: number | string) =>
                  typeof value === "number" ? formatAxisDateLabel(msToIsoDate(value), locale) : value
                }
              />
              <Line
                type="monotone"
                dataKey="totalReturnPercent"
                stroke="var(--color-totalReturnPercent)"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
              {latestReturnPoint?.totalReturnPercent != null ? (
                <ReferenceDot
                  x={dateToUtcMs(latestReturnPoint.date)}
                  y={latestReturnPoint.totalReturnPercent}
                  r={5}
                  fill="var(--color-totalReturnPercent)"
                  stroke="none"
                  isFront
                />
              ) : null}
            </LineChart>
          </ChartContainer>
        </div>
      )}
    </Card>
  );
}

function formatPercent(value: number, locale: LocaleCode): string {
  const intlLocale = locale === "zh-TW" ? "zh-TW" : "en-US";
  return new Intl.NumberFormat(intlLocale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value / 100);
}

function formatAxisDateLabel(value: string, locale: LocaleCode): string {
  const intlLocale = locale === "zh-TW" ? "zh-TW" : "en-US";
  return new Intl.DateTimeFormat(intlLocale, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function resolvePerformanceChartDomain(data: DashboardPerformanceDto | null): [number, number] {
  const points = data?.points ?? [];
  const fallbackEndDate = points.at(-1)?.date ?? new Date().toISOString().slice(0, 10);
  const endDate = data?.rangeEndDate ?? data?.requestedAsOf ?? fallbackEndDate;
  const startDate = data?.rangeStartDate ?? resolveRangeStartDate(data?.range ?? "ALL", endDate, points.at(0)?.date);
  return [dateToUtcMs(startDate), dateToUtcMs(endDate)];
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

function buildTimeAxisTicks([start, end]: [number, number]): number[] {
  if (end <= start) return [start];
  const tickCount = 8;
  const step = (end - start) / (tickCount - 1);
  return Array.from({ length: tickCount }, (_, index) => Math.round(start + (step * index)));
}

function dateToUtcMs(value: string): number {
  return utcDateFromIso(value).getTime();
}

function msToIsoDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
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

function findLastReliablePointDate(points: DashboardPerformanceDto["points"]): string | null {
  return [...points].reverse().find((point) =>
    point.fxAvailable && point.marketValueAmount !== null && point.totalCostAmount !== null,
  )?.date ?? null;
}
