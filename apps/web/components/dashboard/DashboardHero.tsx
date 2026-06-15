// Phase 5d — focused above-the-fold hero per design §8 #7.
// Renders total portfolio value + day Δ in a tight two-card layout.
// Replaces the 7-tile maximalist SummarySection (deleted Phase 5d).

import Link from "next/link";
import {
  type DashboardOverviewMarketValueDto,
  type DashboardOverviewSummaryDto,
  type FxConversionRateDto,
  type LocaleCode,
  type ValuationHealthDto,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCompactCurrencyAmount, formatCurrencyAmount, formatDateLabel, formatPercent } from "../../lib/utils";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Badge } from "../ui/shadcn/badge";
import { ValuationHealthPanel } from "../valuation/ValuationHealthPanel";
import { getValuationHealthAdminRepairHref } from "../valuation/valuationHealthAdminLink";

interface DashboardHeroProps {
  fxRates?: FxConversionRateDto[];
  holdingCount: number;
  marketValues: DashboardOverviewMarketValueDto[];
  summary: DashboardOverviewSummaryDto;
  locale: LocaleCode;
  dict: AppDictionary;
  canOpenQuickActions?: boolean;
  onOpenQuickActions?: () => void;
  showAdminActions?: boolean;
  valuationHealth?: ValuationHealthDto | null;
}

export function DashboardHero({
  fxRates = [],
  holdingCount,
  marketValues,
  summary,
  locale,
  dict,
  canOpenQuickActions = false,
  onOpenQuickActions,
  showAdminActions = false,
  valuationHealth,
}: DashboardHeroProps) {
  const totalValue = summary.marketValueAmount !== null
    ? formatCompactCurrencyAmount(summary.marketValueAmount, summary.reportingCurrency, locale)
    : dict.dashboardHome.noMarketValue;
  const totalExactValue = summary.marketValueAmount !== null
    ? formatCurrencyAmount(summary.marketValueAmount, summary.reportingCurrency, locale)
    : null;
  const dayDeltaValue = summary.dailyChangeAmount !== null
    ? formatCompactCurrencyAmount(summary.dailyChangeAmount, summary.reportingCurrency, locale)
    : dict.dashboardHome.noMarketValue;
  const dayDeltaExactValue = summary.dailyChangeAmount !== null
    ? formatCurrencyAmount(summary.dailyChangeAmount, summary.reportingCurrency, locale)
    : null;
  const dayDeltaPercent = summary.dailyChangePercent !== null
    ? formatPercent(summary.dailyChangePercent, locale)
    : null;
  const adminRepairHref = showAdminActions
    ? getValuationHealthAdminRepairHref(valuationHealth)
    : null;
  const deltaTone = summary.dailyChangeAmount === null
    ? "text-foreground"
    : summary.dailyChangeAmount > 0
      ? "text-success"
      : summary.dailyChangeAmount < 0
        ? "text-destructive"
        : "text-foreground";
  return (
    <section
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_0.9fr]"
      data-testid="dashboard-hero"
    >
      <Card className="p-5" data-testid="dashboard-hero-total">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
          {dict.dashboardHome.marketValueLabel}
        </p>
        <p
          className="mt-2 font-mono text-3xl font-semibold tabular-nums text-foreground sm:text-4xl"
          data-testid="dashboard-hero-total-value"
        >
          {totalValue}
        </p>
        {totalExactValue ? (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="dashboard-hero-total-exact">
            {formatHeroMessage(dict.dashboardHome.exactAmountInline, { amount: totalExactValue })}
          </p>
        ) : null}
      </Card>

      <Card className="p-5" data-testid="dashboard-hero-day-delta">
        <p className="text-xs font-semibold uppercase text-muted-foreground">
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
        {dayDeltaExactValue ? (
          <p className={cn("mt-1 text-sm", deltaTone)} data-testid="dashboard-hero-day-delta-exact">
            {formatHeroMessage(dict.dashboardHome.exactAmountInline, { amount: dayDeltaExactValue })}
          </p>
        ) : null}
        {dayDeltaPercent ? (
          <p
            className={cn("mt-1 text-sm font-medium", deltaTone)}
            data-testid="dashboard-hero-day-delta-percent"
          >
            {dayDeltaPercent}
          </p>
        ) : null}
      </Card>

      <Card className="p-5 sm:col-span-2 xl:col-span-1" data-testid="dashboard-hero-currency">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {dict.dashboardHome.reportingCurrencyTitle}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatHeroMessage(dict.dashboardHome.reportingCurrencyBaseline, { currency: summary.reportingCurrency })}
            </p>
          </div>
          {canOpenQuickActions ? (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={onOpenQuickActions}
              data-testid="dashboard-hero-open-quick-actions"
            >
              {dict.reports.changeInQuickActions}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              {dict.reports.reportingCurrencyQuickActionsOnly}
            </p>
          )}
          <div className="flex flex-col gap-2" data-testid="dashboard-hero-fx-rates">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase text-muted-foreground">{dict.reports.fxStatusTitle}</span>
              <Badge variant={summary.fxStatus === "complete" ? "secondary" : "outline"}>{summary.fxStatus}</Badge>
            </div>
            {fxRates.length > 0 ? (
              <div className="grid gap-1.5">
                {fxRates.map((rate) => (
                  <div key={`${rate.fromCurrency}-${rate.toCurrency}-${rate.asOf ?? "latest"}`} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {formatHeroMessage(dict.dashboardHome.fxPairLabel, {
                        from: rate.fromCurrency,
                        to: rate.toCurrency,
                      })}
                      {rate.asOf ? ` · ${formatDateLabel(rate.asOf, locale)}` : ""}
                    </span>
                    <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
                      {formatFxRate(rate.rate)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {summary.fxStatus === "complete"
                  ? dict.dashboardHome.fxStatusCompleteDescription
                  : dict.dashboardHome.fxStatusMissingDescription}
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:col-span-2 xl:col-span-3" data-testid="dashboard-hero-market-strip">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {formatHeroMessage(dict.dashboardHome.marketValuesInCurrency, { currency: summary.reportingCurrency })}
            </p>
            <Link
              href="/reports?tab=market&scope=all&range=1Y"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {dict.dashboardHome.reportsLinkLabel}
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {marketValues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {holdingCount === 0 ? dict.dashboardHome.holdingsEmpty : dict.dashboardHome.noMarketValue}
              </p>
            ) : marketValues.map((market) => (
              <Link
                key={market.marketCode}
                href={`/reports?tab=market&scope=${market.marketCode}&range=1Y`}
                className="rounded-md border border-border bg-muted/30 px-3 py-2 transition hover:bg-muted"
                data-testid={`dashboard-hero-market-${market.marketCode}`}
              >
                <span className="text-xs font-medium text-muted-foreground">{market.marketCode}</span>
                <span className="mt-1 block font-mono text-lg font-semibold tabular-nums text-foreground">
                  {formatCompactCurrencyAmount(market.value, summary.reportingCurrency, locale)}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {formatHeroMessage(dict.dashboardHome.exactAmountInline, {
                    amount: formatCurrencyAmount(market.value, summary.reportingCurrency, locale),
                  })}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </Card>

      {valuationHealth ? (
        <ValuationHealthPanel
          adminRepairHref={adminRepairHref}
          className="sm:col-span-2 xl:col-span-3"
          copy={dict.valuationHealth}
          locale={locale}
          showAdminActions={showAdminActions}
          valuationHealth={valuationHealth}
        />
      ) : null}
    </section>
  );
}

function formatHeroMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, value), template);
}

function formatFxRate(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(value);
}
