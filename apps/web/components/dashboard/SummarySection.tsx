import React from "react";
import type { DashboardOverviewSummaryDto, LocaleCode } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";

interface SummarySectionProps {
  summary: DashboardOverviewSummaryDto;
  dict: AppDictionary;
  locale: LocaleCode;
}

export function SummarySection({ summary, dict, locale }: SummarySectionProps) {
  const marketValue = summary.marketValueAmount !== null
    ? formatCurrencyAmount(summary.marketValueAmount, summary.totalCostCurrency, locale)
    : dict.dashboardHome.noMarketValue;
  const unrealizedPnl = summary.unrealizedPnlAmount !== null
    ? formatCurrencyAmount(summary.unrealizedPnlAmount, summary.totalCostCurrency, locale)
    : dict.dashboardHome.noMarketValue;

  return (
    <section
      className="glass-panel rounded-[30px] px-5 py-6 shadow-glass sm:px-6 sm:py-7 md:px-8"
      data-testid="dashboard-summary-section"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.28em] text-indigo-500/78">{dict.dashboardHome.summaryEyebrow}</p>
          <h2 className="mt-3 max-w-4xl text-2xl leading-tight text-slate-950 sm:text-3xl md:text-4xl" data-testid="dashboard-summary-title">
            {dict.dashboardHome.summaryTitle}
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">{dict.dashboardHome.summaryDescription}</p>
        </div>
        <div className="rounded-full border border-slate-200 bg-white/85 px-4 py-2 text-sm text-slate-700 shadow-[0_12px_24px_rgba(148,163,184,0.08)]">
          <span className="text-slate-500">{dict.dashboardHome.asOfLabel}</span>{" "}
          {summary.asOf ? formatDateLabel(summary.asOf, locale) : "-"}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label={dict.dashboardHome.marketValueLabel} value={marketValue} subdued={summary.marketValueAmount === null} />
        <MetricCard label={dict.dashboardHome.unrealizedPnlLabel} value={unrealizedPnl} subdued={summary.unrealizedPnlAmount === null} />
        <MetricCard
          label={dict.dashboardHome.upcomingDividendLabel}
          value={summary.upcomingDividendAmount !== null
            ? formatCurrencyAmount(summary.upcomingDividendAmount, summary.totalCostCurrency, locale)
            : formatNumber(summary.upcomingDividendCount, locale)}
        />
        <MetricCard
          label={dict.dashboardHome.totalCostLabel}
          value={formatCurrencyAmount(summary.totalCostAmount, summary.totalCostCurrency, locale)}
        />
        <MetricCard label={dict.dashboardHome.holdingCountLabel} value={formatNumber(summary.holdingCount, locale)} />
        <MetricCard label={dict.dashboardHome.accountCountLabel} value={formatNumber(summary.accountCount, locale)} />
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  subdued = false,
}: {
  label: string;
  value: string;
  detail?: string;
  subdued?: boolean;
}) {
  return (
    <div className="glass-inset rounded-[22px] p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-semibold ${subdued ? "text-slate-400" : "text-slate-950"}`}>{value}</p>
      {detail ? <p className="mt-2 text-sm text-slate-500">{detail}</p> : null}
    </div>
  );
}
