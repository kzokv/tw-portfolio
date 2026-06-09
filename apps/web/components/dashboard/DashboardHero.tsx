// Phase 5d — focused above-the-fold hero per design §8 #7.
// Renders total portfolio value + day Δ in a tight two-card layout.
// Replaces the 7-tile maximalist SummarySection (deleted Phase 5d).

import Link from "next/link";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  type AccountDefaultCurrency,
  type DashboardOverviewHoldingGroupDto,
  type DashboardOverviewSummaryDto,
  type FxConversionRateDto,
  type LocaleCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCompactCurrencyAmount, formatDateLabel, formatPercent } from "../../lib/utils";
import { Card } from "../ui/Card";
import { Badge } from "../ui/shadcn/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";

interface DashboardHeroProps {
  currencyError?: string;
  fxRates?: FxConversionRateDto[];
  holdingGroups: DashboardOverviewHoldingGroupDto[];
  isCurrencySaving?: boolean;
  isCurrencyReadOnly?: boolean;
  summary: DashboardOverviewSummaryDto;
  locale: LocaleCode;
  dict: AppDictionary;
  onCurrencyChange: (currency: AccountDefaultCurrency) => void;
}

export function DashboardHero({
  currencyError = "",
  fxRates = [],
  holdingGroups,
  isCurrencySaving = false,
  isCurrencyReadOnly = false,
  summary,
  locale,
  dict,
  onCurrencyChange,
}: DashboardHeroProps) {
  const totalValue = summary.marketValueAmount !== null
    ? formatCompactCurrencyAmount(summary.marketValueAmount, summary.reportingCurrency, locale)
    : dict.dashboardHome.noMarketValue;
  const dayDeltaValue = summary.dailyChangeAmount !== null
    ? formatCompactCurrencyAmount(summary.dailyChangeAmount, summary.reportingCurrency, locale)
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
  const marketValues = buildMarketValues(holdingGroups);

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
              Reporting currency
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Current report baseline is {summary.reportingCurrency}.
            </p>
          </div>
          <Select
            value={summary.reportingCurrency}
            onValueChange={(value) => {
              if (isCurrencyReadOnly) return;
              if ((ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(value)) {
                onCurrencyChange(value as AccountDefaultCurrency);
              }
            }}
            disabled={isCurrencySaving || isCurrencyReadOnly}
          >
            <SelectTrigger data-testid="dashboard-hero-currency-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ACCOUNT_DEFAULT_CURRENCIES.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {currencyError ? (
            <p className="text-sm text-destructive" role="alert">{currencyError}</p>
          ) : null}
          <div className="flex flex-col gap-2" data-testid="dashboard-hero-fx-rates">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase text-muted-foreground">FX status</span>
              <Badge variant={summary.fxStatus === "complete" ? "secondary" : "outline"}>{summary.fxStatus}</Badge>
            </div>
            {fxRates.length > 0 ? (
              <div className="grid gap-1.5">
                {fxRates.map((rate) => (
                  <div key={`${rate.fromCurrency}-${rate.toCurrency}-${rate.asOf ?? "latest"}`} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {rate.fromCurrency} to {rate.toCurrency}
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
                  ? "No cross-currency conversion required for visible values."
                  : "FX rates are missing for one or more visible currencies."}
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:col-span-2 xl:col-span-3" data-testid="dashboard-hero-market-strip">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Market values in {summary.reportingCurrency}
            </p>
            <Link
              href={`/reports?tab=market&scope=all&currencyMode=specified&currency=${summary.reportingCurrency}&range=1Y`}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Reports
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {marketValues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {holdingGroups.length === 0 ? dict.dashboardHome.holdingsEmpty : dict.dashboardHome.noMarketValue}
              </p>
            ) : marketValues.map((market) => (
              <Link
                key={market.marketCode}
                href={`/reports?tab=market&scope=${market.marketCode}&currencyMode=specified&currency=${summary.reportingCurrency}&range=1Y`}
                className="rounded-md border border-border bg-muted/30 px-3 py-2 transition hover:bg-muted"
                data-testid={`dashboard-hero-market-${market.marketCode}`}
              >
                <span className="text-xs font-medium text-muted-foreground">{market.marketCode}</span>
                <span className="mt-1 block font-mono text-lg font-semibold tabular-nums text-foreground">
                  {formatCompactCurrencyAmount(market.value, summary.reportingCurrency, locale)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </Card>
    </section>
  );
}

function formatFxRate(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(value);
}

function buildMarketValues(
  groups: DashboardOverviewHoldingGroupDto[],
): Array<{ marketCode: string; value: number }> {
  const values = new Map<string, number>();
  for (const group of groups) {
    const amount = group.reportingMarketValueAmount;
    if (amount === null) continue;
    values.set(group.marketCode, (values.get(group.marketCode) ?? 0) + amount);
  }
  return [...values.entries()]
    .map(([marketCode, value]) => ({ marketCode, value }))
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value);
}
