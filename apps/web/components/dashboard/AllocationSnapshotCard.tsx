"use client";

import { Cell, Pie, PieChart } from "recharts";
import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { getAmountForAllocationBasis, type DashboardOverviewHoldingGroupDto, type HoldingAllocationBasis } from "../../features/portfolio/holdingGroups";
import { formatCurrencyAmount, formatPercent } from "../../lib/utils";
import { Card } from "../ui/Card";
import { ChartContainer, type ChartConfig } from "../ui/shadcn/chart";

const CHART_TOKEN_KEYS = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "chart-6",
] as const;

interface AllocationSnapshotCardProps {
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  dict: AppDictionary;
  allocationBasis: HoldingAllocationBasis;
}

interface Segment {
  label: string;
  amount: number;
  weight: number;
}

function buildChartConfig(segments: Segment[]): ChartConfig {
  return segments.reduce<ChartConfig>((acc, segment, index) => {
    const tokenKey = CHART_TOKEN_KEYS[index % CHART_TOKEN_KEYS.length];
    acc[segment.label] = {
      label: segment.label,
      color: `hsl(var(--${tokenKey}))`,
    };
    return acc;
  }, {});
}

function segmentColor(index: number): string {
  const tokenKey = CHART_TOKEN_KEYS[index % CHART_TOKEN_KEYS.length];
  return `hsl(var(--${tokenKey}))`;
}

export function AllocationSnapshotCard({ groups, locale, dict, allocationBasis }: AllocationSnapshotCardProps) {
  const segments = buildAllocationSegments(groups, dict, allocationBasis);
  const totalAmount = segments.reduce((sum, segment) => sum + segment.amount, 0);
  const currency = groups[0]?.reportingCurrency ?? groups[0]?.currency ?? "TWD";
  const chartConfig = buildChartConfig(segments);

  return (
    <Card className="border border-slate-200/80 bg-[rgba(255,255,255,0.96)]" data-testid="dashboard-allocation-card">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500/78">{dict.dashboardHome.allocationSnapshotTitle}</p>
      <h2 className="mt-2 text-2xl text-slate-950 sm:text-3xl">{dict.dashboardHome.allocationSnapshotTitle}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{dict.dashboardHome.allocationSnapshotDescription}</p>

      {segments.length === 0 ? (
        <div className="mt-6 rounded-[24px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-10 text-sm text-slate-600">
          {dict.dashboardHome.allocationEmpty}
        </div>
      ) : (
        <>
          <div className="mt-6 flex justify-center">
            <div className="relative h-56 w-56">
              <ChartContainer
                config={chartConfig}
                className="h-56 w-56 aspect-square shadow-[0_20px_50px_rgba(79,70,229,0.12)] rounded-full"
              >
                <PieChart>
                  <Pie
                    data={segments}
                    dataKey="amount"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius="62%"
                    outerRadius="100%"
                    paddingAngle={0}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {segments.map((_, index) => (
                      <Cell key={index} fill={segmentColor(index)} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
              <div
                className="pointer-events-none absolute inset-[22%] flex items-center justify-center rounded-full border border-slate-200 bg-white/95 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]"
                aria-hidden="true"
              >
                <div className="px-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {allocationBasis === "market_value" ? dict.dashboardHome.marketValueLabel : dict.dashboardHome.totalCostLabel}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{formatCurrencyAmount(totalAmount, currency, locale)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            {segments.map((segment, index) => (
              <div
                key={segment.label}
                className="flex items-center justify-between gap-3 rounded-[20px] border border-slate-200 bg-white/88 px-4 py-3"
              >
                <div className="min-w-0 flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: segmentColor(index) }}
                    aria-hidden="true"
                  />
                  <p className="truncate text-sm font-medium text-slate-900">{segment.label}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-950">{formatPercent(segment.weight, locale)}</p>
                  <p className="text-xs text-slate-500">{formatCurrencyAmount(segment.amount, currency, locale)}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function buildAllocationSegments(
  groups: DashboardOverviewHoldingGroupDto[],
  dict: AppDictionary,
  allocationBasis: HoldingAllocationBasis,
): Segment[] {
  const ranked = groups
    .map((group) => ({
      label: `${group.ticker} · ${group.marketCode}`,
      amount: getAmountForAllocationBasis(group, allocationBasis).amount,
    }))
    .filter((holding) => holding.amount > 0)
    .sort((left, right) => right.amount - left.amount);

  if (ranked.length === 0) {
    return [];
  }

  const top = ranked.slice(0, 5);
  const otherAmount = ranked.slice(5).reduce((sum, holding) => sum + holding.amount, 0);
  const totalAmount = ranked.reduce((sum, holding) => sum + holding.amount, 0);
  const resolved = otherAmount > 0
    ? [...top, { label: dict.dashboardHome.allocationOtherLabel, amount: otherAmount }]
    : top;

  return resolved.map((segment) => ({
    ...segment,
    weight: totalAmount > 0 ? (segment.amount / totalAmount) * 100 : 0,
  }));
}
