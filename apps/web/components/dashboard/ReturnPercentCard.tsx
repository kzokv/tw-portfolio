"use client";

import type { DashboardPerformanceDto, LocaleCode } from "@vakwen/shared-types";
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
  // KZO-180: `totalCostAmount` is nullable when `fxAvailable === false`.
  // Treat null as "not provisional" since the provisional warning is about a
  // pending market quote against a known cost basis, not a missing FX rate.
  const hasProvisional = points.some(
    (point) => point.totalReturnPercent == null && point.totalCostAmount !== null && point.totalCostAmount > 0,
  );

  const chartData: ChartPoint[] = points.map((point) => ({
    date: point.date,
    totalReturnPercent: point.totalReturnPercent ?? null,
  }));

  const chartConfig = buildChartConfig(dict);

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
        <div className="mt-5 rounded-[20px] border border-[rgba(251,113,133,0.24)] bg-[rgba(254,226,226,0.92)] px-4 py-3 text-sm text-rose-700">
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
          className="mt-4 rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          data-testid="dashboard-return-percent-provisional-warning"
        >
          {dict.dashboardHome.snapshotsProvisionalWarning}
        </p>
      ) : null}

      {isLoading ? (
        <div className="mt-6 h-[18rem] rounded-[28px] border border-slate-200 bg-slate-50/85 p-5" aria-hidden="true">
          <div className="skeleton-line h-4 w-36 rounded" />
          <div className="skeleton-line skeleton-line--delay mt-6 h-[12rem] w-full rounded-[24px]" />
        </div>
      ) : !hasPoints || !hasReturnPercent ? (
        <div className="mt-6 rounded-[28px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-12 text-sm text-slate-600">
          {dict.dashboardHome.snapshotsEmpty}
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
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(value: string) => formatAxisDateLabel(value, locale)}
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
                labelFormatter={(value: string) => formatAxisDateLabel(value, locale)}
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
                  x={latestReturnPoint.date}
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
