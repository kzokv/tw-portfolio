"use client";

import type { DashboardPerformanceDto, DashboardPerformancePointDto, LocaleCode } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { Card } from "../ui/Card";

interface ReturnPercentCardProps {
  data: DashboardPerformanceDto | null;
  locale: LocaleCode;
  dict: AppDictionary;
  isLoading: boolean;
  errorMessage: string;
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
  const hasProvisional = points.some(
    (point) => point.totalReturnPercent == null && point.totalCostAmount > 0,
  );

  const { linePath, yLabels, xLabels } = buildReturnGeometry(points, locale);

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
              <span className="h-2.5 w-2.5 rounded-full bg-violet-500" aria-hidden="true" />
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
          <svg
            viewBox="0 0 760 260"
            className="h-[16rem] w-full"
            role="img"
            aria-label={dict.dashboardHome.snapshotsReturnPercentTitle}
            data-testid="dashboard-return-percent-chart"
          >
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
                <text key={`${label.index}-${label.label}`} x={label.x} y="248" fill="#64748b" fontSize="11" textAnchor="middle">
                  {label.label}
                </text>
              ))}
            </g>

            <path d={linePath} fill="none" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

            {latestReturnPoint?.totalReturnPercent != null ? (
              <circle
                cx={resolveLastPointX(points)}
                cy={resolveReturnPointY(latestReturnPoint.totalReturnPercent, points)}
                r="5"
                fill="#8b5cf6"
              />
            ) : null}
          </svg>
        </div>
      )}
    </Card>
  );
}

function buildReturnGeometry(points: DashboardPerformancePointDto[], locale: LocaleCode) {
  const returnPoints = points.filter((point) => point.totalReturnPercent != null);

  if (returnPoints.length === 0) {
    return {
      linePath: "",
      yLabels: [] as Array<{ y: number; label: string; value: number }>,
      xLabels: [] as Array<{ x: number; label: string; index: number }>,
    };
  }

  const chartLeft = 68;
  const chartTop = 20;
  const chartWidth = 660;
  const chartHeight = 196;

  const values = returnPoints.map((point) => point.totalReturnPercent!);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 0);
  const range = maxValue - minValue;
  const paddedMin = minValue - range * 0.1;
  const paddedMax = maxValue + range * 0.1;

  const scaleX = (index: number) => chartLeft + ((chartWidth * index) / Math.max(points.length - 1, 1));
  const scaleY = (value: number) =>
    chartTop + chartHeight - ((value - paddedMin) / Math.max(paddedMax - paddedMin, 1)) * chartHeight;

  let linePath = "";
  for (let i = 0; i < points.length; i++) {
    const val = points[i].totalReturnPercent;
    if (val == null) continue;
    const command = linePath ? "L" : "M";
    linePath += `${command} ${scaleX(i)} ${scaleY(val)} `;
  }
  linePath = linePath.trim();

  const yLabels = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const value = paddedMax - (paddedMax - paddedMin) * ratio;
    return {
      y: chartTop + chartHeight * ratio,
      value,
      label: `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`,
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

  return { linePath, yLabels, xLabels };
}

function resolveLastPointX(points: DashboardPerformancePointDto[]): number {
  const chartLeft = 68;
  const chartWidth = 660;
  return chartLeft + ((chartWidth * Math.max(points.length - 1, 0)) / Math.max(points.length - 1, 1));
}

function resolveReturnPointY(value: number, points: DashboardPerformancePointDto[]): number {
  const values = points
    .filter((point) => point.totalReturnPercent != null)
    .map((point) => point.totalReturnPercent!);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 0);
  const range = maxValue - minValue;
  const paddedMin = minValue - range * 0.1;
  const paddedMax = maxValue + range * 0.1;
  const chartTop = 20;
  const chartHeight = 196;

  return chartTop + chartHeight - ((value - paddedMin) / Math.max(paddedMax - paddedMin, 1)) * chartHeight;
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
