import type { DashboardOverviewHoldingDto, LocaleCode } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount, formatPercent } from "../../lib/utils";
import { Card } from "../ui/Card";

const DONUT_COLORS = ["#4f46e5", "#6366f1", "#3b82f6", "#14b8a6", "#f59e0b", "#94a3b8"];

interface AllocationSnapshotCardProps {
  holdings: DashboardOverviewHoldingDto[];
  locale: LocaleCode;
  dict: AppDictionary;
}

export function AllocationSnapshotCard({ holdings, locale, dict }: AllocationSnapshotCardProps) {
  const segments = buildAllocationSegments(holdings, dict);
  const totalAmount = segments.reduce((sum, segment) => sum + segment.amount, 0);
  const currency = holdings[0]?.currency ?? "TWD";

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
            <div
              className="relative h-56 w-56 rounded-full shadow-[0_20px_50px_rgba(79,70,229,0.12)]"
              style={{ background: buildConicGradient(segments) }}
              aria-hidden="true"
            >
              <div className="absolute inset-[22%] flex items-center justify-center rounded-full border border-slate-200 bg-white/95 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
                <div className="px-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{dict.dashboardHome.marketValueLabel}</p>
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
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: DONUT_COLORS[index % DONUT_COLORS.length] }} aria-hidden="true" />
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

function buildAllocationSegments(holdings: DashboardOverviewHoldingDto[], dict: AppDictionary) {
  const ranked = holdings
    .map((holding) => ({
      label: holding.symbol,
      amount: holding.marketValueAmount ?? holding.costBasisAmount,
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

function buildConicGradient(segments: Array<{ weight: number }>): string {
  let offset = 0;
  const stops = segments.map((segment, index) => {
    const start = offset;
    offset += segment.weight;
    return `${DONUT_COLORS[index % DONUT_COLORS.length]} ${start}% ${offset}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}
