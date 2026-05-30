"use client";

import React, { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { DashboardOverviewHoldingDto, LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { Card } from "../ui/Card";
import { fieldClassName } from "../ui/fieldStyles";

interface HoldingsTableProps {
  holdings: DashboardOverviewHoldingDto[];
  dict: AppDictionary;
  locale: LocaleCode;
  recomputingSymbols?: Set<string>;
  showFreshnessBadge?: boolean;
  variant?: "default" | "compact";
}

export function HoldingsTable({
  holdings,
  dict,
  locale,
  recomputingSymbols,
  showFreshnessBadge = true,
  variant = "default",
}: HoldingsTableProps) {
  const [query, setQuery] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState<string>("ALL");
  const deferredQuery = useDeferredValue(query);
  const isCompact = variant === "compact";

  const currencyOptions = useMemo(() => {
    const seen = new Set<string>();
    const options = [{ value: "ALL", label: locale === "zh-TW" ? "全部幣別" : "All currencies" }];
    for (const holding of holdings) {
      if (seen.has(holding.currency)) continue;
      seen.add(holding.currency);
      options.push({ value: holding.currency, label: holding.currency });
    }
    return options;
  }, [holdings, locale]);

  const filteredHoldings = useMemo(() => {
    const normalized = deferredQuery.trim().toUpperCase();
    const byCurrency = currencyFilter === "ALL"
      ? holdings
      : holdings.filter((holding) => holding.currency === currencyFilter);
    if (!normalized) return byCurrency;

    return byCurrency.filter((holding) =>
      holding.ticker.toUpperCase().includes(normalized) || holding.accountId.toUpperCase().includes(normalized)
    );
  }, [currencyFilter, deferredQuery, holdings]);

  const largestHolding = holdings[0] ?? null;
  const topWeight = largestHolding?.allocationPct ?? null;
  const filteredCountDetail = query || currencyFilter !== "ALL"
    ? `${formatNumber(filteredHoldings.length, locale)} / ${formatNumber(holdings.length, locale)}`
    : dict.holdings.entries.replace("{count}", String(holdings.length));

  return (
    <Tooltip.Provider delayDuration={150}>
    <Card data-testid="dashboard-holdings-section">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">{dict.dashboardHome.holdingsTitle}</p>
          <h2 className={cn("mt-2 text-2xl text-foreground", isCompact ? "sm:text-2xl" : "sm:text-3xl")}>
            {dict.dashboardHome.holdingsTitle}
          </h2>
          <p className={cn("max-w-2xl text-sm leading-6 text-muted-foreground", isCompact ? "mt-2" : "mt-3")}>
            {dict.dashboardHome.holdingsDescription}
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 lg:max-w-2xl lg:items-end">
          <label className="block w-full lg:max-w-sm">
            <span className="sr-only">{dict.dashboardHome.holdingsSearchPlaceholder}</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={dict.dashboardHome.holdingsSearchPlaceholder}
              className={fieldClassName}
              data-testid="holdings-filter-input"
            />
          </label>
          <div className="flex flex-wrap gap-2" data-testid="holdings-currency-filters">
            {currencyOptions.map((option) => {
              const active = currencyFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCurrencyFilter(option.value)}
                  className={cn(
                    "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition",
                    active
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={cn("mt-5 grid gap-3", isCompact ? "xl:grid-cols-4 md:grid-cols-2" : "md:grid-cols-3")}>
        <SummaryTile
          label={dict.dashboardHome.largestPositionLabel}
          value={largestHolding ? largestHolding.ticker : "-"}
          detail={largestHolding ? formatCurrencyAmount(largestHolding.costBasisAmount, largestHolding.currency, locale) : dict.dashboardHome.holdingsEmpty}
        />
        <SummaryTile
          label={dict.dashboardHome.concentrationLabel}
          value={topWeight !== null ? formatPercent(topWeight, locale) : "-"}
          detail={largestHolding ? dict.dashboardHome.allocationLabel : dict.dashboardHome.holdingsEmpty}
        />
        <SummaryTile
          label={dict.dashboardHome.holdingCountLabel}
          value={formatNumber(holdings.length, locale)}
          detail={filteredCountDetail}
        />
	        {isCompact ? (
	          <SummaryTile
	            label={dict.holdings.visibleRowsLabel}
	            value={`${formatNumber(filteredHoldings.length, locale)}`}
	            detail={currencyFilter === "ALL"
	              ? dict.holdings.visibleRowsDetail
	              : dict.holdings.visibleRowsCurrencyDetail.replace("{currency}", currencyFilter)}
	          />
	        ) : null}
      </div>

      {/* Phase 4 — single-DOM table (drops legacy `lg:hidden` mobile cards).
          Scroll + sticky-ticker first column at narrow viewports per scope-grill
          (dense numerics — users zoom/scroll on phones). */}
      {filteredHoldings.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8 text-sm text-muted-foreground">
          {dict.dashboardHome.holdingsEmpty}
        </div>
      ) : (
        <div
          className="mt-6 overflow-x-auto overflow-y-hidden rounded-xl border border-border bg-card"
        >
          <table className="min-w-[1120px] border-collapse text-sm text-muted-foreground" data-testid="holdings-table">
            <thead>
              <tr className="bg-muted/50 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <th className="sticky left-0 z-10 bg-muted/50 border-r border-border md:static md:bg-transparent md:border-r-0 px-4 py-3 text-left font-medium">{dict.holdings.tickerTerm}</th>
                <th className="px-4 py-3 text-left font-medium">
                  {isCompact
                    ? `${dict.holdings.accountTerm} / ${dict.transactions.currencyTerm}`
                    : dict.holdings.accountTerm}
                </th>
                <th className="px-4 py-3 text-right font-medium">{dict.holdings.quantityTerm}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.averageCostLabel}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.currentPriceLabel}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.dailyChangeLabel}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.marketValueLabel}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.unrealizedPnlLabel}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.holdings.totalCostTerm}</th>
                <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.allocationLabel}</th>
                <th className="px-4 py-3 text-left font-medium">{dict.dashboardHome.nextDividendLabel}</th>
                <th className="px-4 py-3 text-left font-medium">{dict.dashboardHome.lastDividendLabel}</th>
              </tr>
            </thead>
            <tbody>
              {filteredHoldings.map((holding) => (
                <tr key={`${holding.accountId}-${holding.ticker}`} className={cn("border-b border-border last:border-0", recomputingSymbols?.has(`${holding.accountId}:${holding.ticker}`) && "animate-pulse opacity-40")}>
                  <td className="sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0 px-4 py-4 font-semibold tracking-[0.12em] text-foreground">
                    <HoldingHistoryLink holding={holding}>{holding.ticker}</HoldingHistoryLink>
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {isCompact ? (
                      <div className="flex min-w-[9rem] flex-col items-start gap-1">
                        <span className="font-medium text-foreground">{holding.accountId}</span>
                        <span className="inline-flex rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {holding.currency}
                        </span>
                      </div>
                    ) : holding.accountId}
                  </td>
                  <td className="px-4 py-4 text-right">{formatNumber(holding.quantity, locale)}</td>
                  <td className="px-4 py-4 text-right">{formatCurrencyAmount(holding.averageCostPerShare, holding.currency, locale)}</td>
                  <td className={cn("px-4 py-4 text-right font-medium", getCurrentPriceTone(holding))}>
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {holding.currentUnitPrice === null
                        ? "-"
                        : formatCurrencyAmount(holding.currentUnitPrice, holding.currency, locale)}
                      {showFreshnessBadge && holding.freshness !== "current" && (
                        <FreshnessBadge holding={holding} />
                      )}
                    </span>
                  </td>
                  <td className={cn("px-4 py-4 text-right font-medium", getDailyChangeTone(holding.change))}>
                    {holding.quoteStatus === "missing" ? (
                      <span className="text-amber-600">{dict.dashboardHome.quoteStatusMissing}</span>
                    ) : holding.change !== null ? (
                      <span>
                        {formatCurrencyAmount(holding.change, holding.currency, locale)}
                        {holding.changePercent !== null && (
                          <span className="ml-1 text-xs">({formatPercent(holding.changePercent, locale)})</span>
                        )}
                        {holding.quoteStatus === "provisional" && <span className="ml-1 text-muted-foreground" title={dict.dashboardHome.quoteStatusProvisional}>⏱</span>}
                      </span>
                    ) : "-"}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {holding.marketValueAmount === null ? "-" : formatCurrencyAmount(holding.marketValueAmount, holding.currency, locale)}
                  </td>
                  <td className={cn("px-4 py-4 text-right font-medium", getUnrealizedPnlTone(holding.unrealizedPnlAmount))}>
                    {holding.unrealizedPnlAmount === null ? "-" : formatCurrencyAmount(holding.unrealizedPnlAmount, holding.currency, locale)}
                  </td>
                  <td className="px-4 py-4 text-right">{formatCurrencyAmount(holding.costBasisAmount, holding.currency, locale)}</td>
                  <td className="px-4 py-4 text-right">{holding.allocationPct !== null ? formatPercent(holding.allocationPct, locale) : "-"}</td>
                  <td className="px-4 py-4">{holding.nextDividendDate ? formatDateLabel(holding.nextDividendDate, locale) : "-"}</td>
                  <td className="px-4 py-4">{holding.lastDividendPostedDate ? formatDateLabel(holding.lastDividendPostedDate, locale) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
    </Tooltip.Provider>
  );
}

function HoldingHistoryLink({
  holding,
  children,
}: {
  holding: DashboardOverviewHoldingDto;
  children: string;
}) {
  return (
    <Link
      href={`/tickers/${encodeURIComponent(holding.ticker)}?accountId=${encodeURIComponent(holding.accountId)}`}
      className="underline decoration-indigo-200 underline-offset-4 transition hover:text-indigo-600 hover:decoration-indigo-400"
      data-testid={`holding-history-link-${holding.accountId}-${holding.ticker}`}
    >
      {children}
    </Link>
  );
}

function getCurrentPriceTone(holding: DashboardOverviewHoldingDto): string {
  if (holding.currentUnitPrice === null) {
    return "text-slate-500";
  }
  if (holding.currentUnitPrice > holding.averageCostPerShare) {
    return "text-emerald-600";
  }
  if (holding.currentUnitPrice < holding.averageCostPerShare) {
    return "text-rose-600";
  }
  return "text-slate-950";
}

function getDailyChangeTone(value: number | null): string {
  if (value === null) return "text-slate-500";
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-rose-600";
  return "text-slate-950";
}

function getUnrealizedPnlTone(value: number | null): string {
  if (value === null) {
    return "text-slate-500";
  }
  if (value > 0) {
    return "text-emerald-600";
  }
  if (value < 0) {
    return "text-rose-600";
  }
  return "text-slate-900";
}

function SummaryTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-semibold text-foreground">{value}</p>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function FreshnessBadge({ holding }: { holding: DashboardOverviewHoldingDto }) {
  if (!holding.freshnessTooltip) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          className={cn(
            "ml-2 inline-flex h-2 w-2 rounded-full",
            holding.freshness === "stale_amber" && "bg-amber-500",
            holding.freshness === "stale_red" && "bg-rose-500",
          )}
          data-testid={`holdings-freshness-badge-${holding.accountId}-${holding.ticker}`}
          aria-label={holding.freshnessTooltip}
        />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={4}
          className="z-50 max-w-xs rounded-md bg-slate-900 px-3 py-1.5 text-xs text-white shadow"
        >
          {holding.freshnessTooltip}
          <Tooltip.Arrow className="fill-slate-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
