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
}

export function HoldingsTable({ holdings, dict, locale, recomputingSymbols, showFreshnessBadge = true }: HoldingsTableProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const filteredHoldings = useMemo(() => {
    const normalized = deferredQuery.trim().toUpperCase();
    if (!normalized) return holdings;

    return holdings.filter((holding) =>
      holding.ticker.toUpperCase().includes(normalized) || holding.accountId.toUpperCase().includes(normalized)
    );
  }, [deferredQuery, holdings]);

  const largestHolding = holdings[0] ?? null;
  const topWeight = largestHolding?.allocationPct ?? null;

  return (
    <Tooltip.Provider delayDuration={150}>
    <Card data-testid="dashboard-holdings-section">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.22em] text-indigo-500/78">{dict.dashboardHome.holdingsTitle}</p>
          <h2 className="mt-2 text-2xl text-slate-950 sm:text-3xl">{dict.dashboardHome.holdingsTitle}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">{dict.dashboardHome.holdingsDescription}</p>
        </div>
        <label className="block w-full max-w-sm">
          <span className="sr-only">{dict.dashboardHome.holdingsSearchPlaceholder}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={dict.dashboardHome.holdingsSearchPlaceholder}
            className={fieldClassName}
            data-testid="holdings-filter-input"
          />
        </label>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <SummaryTile
          label={dict.dashboardHome.largestPositionLabel}
          value={largestHolding ? largestHolding.ticker : "-"}
          detail={largestHolding ? formatCurrencyAmount(largestHolding.costBasisAmount, largestHolding.currency, locale) : dict.dashboardHome.holdingsEmpty}
        />
        <SummaryTile
          label={dict.dashboardHome.concentrationLabel}
          value={topWeight !== null ? formatPercent(topWeight, locale) : "-"}
          detail={largestHolding ? `${largestHolding.accountId} / ${largestHolding.ticker}` : dict.dashboardHome.holdingsEmpty}
        />
        <SummaryTile
          label={dict.dashboardHome.holdingCountLabel}
          value={formatNumber(holdings.length, locale)}
          detail={query ? formatNumber(filteredHoldings.length, locale) : dict.holdings.entries.replace("{count}", String(holdings.length))}
        />
      </div>

      {filteredHoldings.length === 0 ? (
        <div className="mt-6 rounded-[22px] border border-dashed border-slate-300 bg-slate-50/90 px-5 py-8 text-sm text-slate-600">
          {dict.dashboardHome.holdingsEmpty}
        </div>
      ) : (
        <>
          <div
            className="mt-6 hidden overflow-x-auto overflow-y-hidden rounded-[22px] border border-slate-200 bg-white/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] lg:block"
            data-testid="holdings-table-scroll"
          >
            <table className="min-w-[1120px] border-collapse text-sm text-slate-700" data-testid="holdings-table">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  <th className="px-4 py-3 text-left font-medium">{dict.holdings.tickerTerm}</th>
                  <th className="px-4 py-3 text-left font-medium">{dict.holdings.accountTerm}</th>
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
                  <tr key={`${holding.accountId}-${holding.ticker}`} className={cn("border-b border-slate-200 last:border-0", recomputingSymbols?.has(`${holding.accountId}:${holding.ticker}`) && "animate-pulse opacity-40")}>
                    <td className="px-4 py-4 font-semibold tracking-[0.12em] text-slate-950">
                      <HoldingHistoryLink holding={holding}>{holding.ticker}</HoldingHistoryLink>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{holding.accountId}</td>
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
                          {holding.quoteStatus === "provisional" && <span className="ml-1 text-slate-400" title={dict.dashboardHome.quoteStatusProvisional}>⏱</span>}
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

          <div className="mt-6 grid gap-3 lg:hidden">
            {filteredHoldings.map((holding) => (
              <article
                key={`${holding.accountId}-${holding.ticker}`}
                className={cn("rounded-[22px] border border-slate-200 bg-white/92 p-4 shadow-[0_16px_30px_rgba(148,163,184,0.12)]", recomputingSymbols?.has(`${holding.accountId}:${holding.ticker}`) && "animate-pulse opacity-40")}
                data-testid="holding-mobile-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold tracking-[0.14em] text-slate-950">
                      <HoldingHistoryLink holding={holding}>{holding.ticker}</HoldingHistoryLink>
                    </p>
                    <p className="mt-1 text-sm text-slate-500">{holding.accountId}</p>
                  </div>
                  <p className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-600">
                    {holding.allocationPct !== null ? formatPercent(holding.allocationPct, locale) : "-"}
                  </p>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <HoldingDetail label={dict.holdings.quantityTerm} value={formatNumber(holding.quantity, locale)} />
                  <HoldingDetail
                    label={dict.dashboardHome.averageCostLabel}
                    value={formatCurrencyAmount(holding.averageCostPerShare, holding.currency, locale)}
                  />
                  <HoldingDetail
                    label={dict.dashboardHome.currentPriceLabel}
                    value={holding.currentUnitPrice === null ? "-" : formatCurrencyAmount(holding.currentUnitPrice, holding.currency, locale)}
                    valueClassName={getCurrentPriceTone(holding)}
                    badge={showFreshnessBadge && holding.freshness !== "current" ? <FreshnessBadge holding={holding} /> : null}
                  />
                  <HoldingDetail
                    label={dict.dashboardHome.dailyChangeLabel}
                    value={holding.quoteStatus === "missing"
                      ? dict.dashboardHome.quoteStatusMissing
                      : holding.change !== null
                        ? `${formatCurrencyAmount(holding.change, holding.currency, locale)}${holding.changePercent !== null ? ` (${formatPercent(holding.changePercent, locale)})` : ""}${holding.quoteStatus === "provisional" ? " ⏱" : ""}`
                        : "-"}
                    valueClassName={holding.quoteStatus === "missing" ? "text-amber-600" : getDailyChangeTone(holding.change)}
                  />
                  <HoldingDetail
                    label={dict.holdings.totalCostTerm}
                    value={formatCurrencyAmount(holding.costBasisAmount, holding.currency, locale)}
                  />
                  <HoldingDetail
                    label={dict.dashboardHome.marketValueLabel}
                    value={holding.marketValueAmount === null ? "-" : formatCurrencyAmount(holding.marketValueAmount, holding.currency, locale)}
                  />
                  <HoldingDetail
                    label={dict.dashboardHome.unrealizedPnlLabel}
                    value={holding.unrealizedPnlAmount === null ? "-" : formatCurrencyAmount(holding.unrealizedPnlAmount, holding.currency, locale)}
                    valueClassName={getUnrealizedPnlTone(holding.unrealizedPnlAmount)}
                  />
                  <HoldingDetail
                    label={dict.dashboardHome.nextDividendLabel}
                    value={holding.nextDividendDate ? formatDateLabel(holding.nextDividendDate, locale) : "-"}
                  />
                </dl>
              </article>
            ))}
          </div>
        </>
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
    <div className="glass-inset rounded-[22px] p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{detail}</p>
    </div>
  );
}

function HoldingDetail({
  label,
  value,
  valueClassName,
  badge,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className={cn("mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-900", valueClassName)}>
        <span>{value}</span>
        {badge}
      </dd>
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
