// Phase 5d — focused above-the-fold hero per design §8 #7.
// Renders total portfolio value + day Δ in a tight two-card layout.
// Replaces the 7-tile maximalist SummarySection (deleted Phase 5d).

import type { DashboardOverviewSummaryDto, LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatPercent } from "../../lib/utils";
import { Card } from "../ui/Card";

interface DashboardHeroProps {
  summary: DashboardOverviewSummaryDto;
  locale: LocaleCode;
  dict: AppDictionary;
}

export function DashboardHero({ summary, locale, dict }: DashboardHeroProps) {
  const totalValue = summary.marketValueAmount !== null
    ? formatCurrencyAmount(summary.marketValueAmount, summary.reportingCurrency, locale)
    : dict.dashboardHome.noMarketValue;
  const dayDeltaValue = summary.dailyChangeAmount !== null
    ? formatCurrencyAmount(summary.dailyChangeAmount, summary.reportingCurrency, locale)
    : dict.dashboardHome.noMarketValue;
  const dayDeltaPercent = summary.dailyChangePercent !== null
    ? formatPercent(summary.dailyChangePercent, locale)
    : null;
  const deltaTone = summary.dailyChangeAmount === null
    ? "text-foreground"
    : summary.dailyChangeAmount > 0
      ? "text-emerald-600"
      : summary.dailyChangeAmount < 0
        ? "text-rose-600"
        : "text-foreground";

  return (
    <section
      className="grid gap-3 sm:grid-cols-2"
      data-testid="dashboard-hero"
    >
      <Card className="p-5" data-testid="dashboard-hero-total">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {dict.dashboardHome.marketValueLabel}
        </p>
        <p
          className="mt-2 font-mono text-3xl font-semibold tabular-nums text-foreground sm:text-4xl"
          data-testid="dashboard-hero-total-value"
        >
          {totalValue}
        </p>
      </Card>

      <Card className="p-5" data-testid="dashboard-hero-day-delta">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {dict.dashboardHome.dailyChangeLabel}
        </p>
        <p
          className={cn(
            "mt-2 font-mono text-3xl font-semibold tabular-nums sm:text-4xl",
            deltaTone,
          )}
          data-testid="dashboard-hero-day-delta-value"
        >
          {dayDeltaValue}
        </p>
        {dayDeltaPercent ? (
          <p
            className={cn("mt-1 text-sm font-medium", deltaTone)}
            data-testid="dashboard-hero-day-delta-percent"
          >
            {dayDeltaPercent}
          </p>
        ) : null}
      </Card>
    </section>
  );
}
