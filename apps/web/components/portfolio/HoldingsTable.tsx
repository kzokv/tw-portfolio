"use client";

import React, { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import type { DashboardOverviewHoldingDto, LocaleCode } from "@tw-portfolio/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { Card } from "../ui/Card";
import { fieldClassName } from "../ui/fieldStyles";

interface HoldingsTableProps {
  holdings: DashboardOverviewHoldingDto[];
  dict: AppDictionary;
  locale: LocaleCode;
}

export function HoldingsTable({ holdings, dict, locale }: HoldingsTableProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const filteredHoldings = useMemo(() => {
    const normalized = deferredQuery.trim().toUpperCase();
    if (!normalized) return holdings;

    return holdings.filter((holding) =>
      holding.symbol.toUpperCase().includes(normalized) || holding.accountId.toUpperCase().includes(normalized)
    );
  }, [deferredQuery, holdings]);

  const largestHolding = holdings[0] ?? null;
  const topWeight = largestHolding?.allocationPct ?? null;

  return (
    <Card data-testid="dashboard-holdings-section">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{dict.dashboardHome.holdingsTitle}</p>
          <h2 className="mt-2 text-2xl text-ink sm:text-3xl">{dict.dashboardHome.holdingsTitle}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{dict.dashboardHome.holdingsDescription}</p>
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
          value={largestHolding ? largestHolding.symbol : "-"}
          detail={largestHolding ? formatCurrencyAmount(largestHolding.costBasisAmount, largestHolding.currency, locale) : dict.dashboardHome.holdingsEmpty}
        />
        <SummaryTile
          label={dict.dashboardHome.concentrationLabel}
          value={topWeight !== null ? formatPercent(topWeight, locale) : "-"}
          detail={largestHolding ? `${largestHolding.accountId} / ${largestHolding.symbol}` : dict.dashboardHome.holdingsEmpty}
        />
        <SummaryTile
          label={dict.dashboardHome.holdingCountLabel}
          value={formatNumber(holdings.length, locale)}
          detail={query ? formatNumber(filteredHoldings.length, locale) : dict.holdings.entries(holdings.length)}
        />
      </div>

      {filteredHoldings.length === 0 ? (
        <div className="mt-6 rounded-[22px] border border-dashed border-white/15 bg-slate-950/30 px-5 py-8 text-sm text-slate-300">
          {dict.dashboardHome.holdingsEmpty}
        </div>
      ) : (
        <>
          <div
            className="mt-6 hidden overflow-x-auto overflow-y-hidden rounded-[22px] border border-white/10 bg-slate-950/35 lg:block"
            data-testid="holdings-table-scroll"
          >
            <table className="min-w-[1120px] border-collapse text-sm text-slate-200" data-testid="holdings-table">
              <thead>
                <tr className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  <th className="px-4 py-3 text-left font-medium">{dict.holdings.symbolTerm}</th>
                  <th className="px-4 py-3 text-left font-medium">{dict.holdings.accountTerm}</th>
                  <th className="px-4 py-3 text-right font-medium">{dict.holdings.quantityTerm}</th>
                  <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.averageCostLabel}</th>
                  <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.currentPriceLabel}</th>
                  <th className="px-4 py-3 text-right font-medium">{dict.holdings.totalCostTerm}</th>
                  <th className="px-4 py-3 text-right font-medium">{dict.dashboardHome.allocationLabel}</th>
                  <th className="px-4 py-3 text-left font-medium">{dict.dashboardHome.nextDividendLabel}</th>
                  <th className="px-4 py-3 text-left font-medium">{dict.dashboardHome.lastDividendLabel}</th>
                </tr>
              </thead>
              <tbody>
                {filteredHoldings.map((holding) => (
                  <tr key={`${holding.accountId}-${holding.symbol}`} className="border-b border-white/8 last:border-0">
                    <td className="px-4 py-4 font-semibold tracking-[0.12em] text-slate-50">
                      <HoldingHistoryLink holding={holding}>{holding.symbol}</HoldingHistoryLink>
                    </td>
                    <td className="px-4 py-4 text-slate-300">{holding.accountId}</td>
                    <td className="px-4 py-4 text-right">{formatNumber(holding.quantity, locale)}</td>
                    <td className="px-4 py-4 text-right">{formatCurrencyAmount(holding.averageCostPerShare, holding.currency, locale)}</td>
                    <td className={cn("px-4 py-4 text-right font-medium", getCurrentPriceTone(holding))}>
                      {holding.currentUnitPrice === null
                        ? "-"
                        : formatCurrencyAmount(holding.currentUnitPrice, holding.currency, locale)}
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
                key={`${holding.accountId}-${holding.symbol}`}
                className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4"
                data-testid="holding-mobile-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold tracking-[0.14em] text-slate-50">
                      <HoldingHistoryLink holding={holding}>{holding.symbol}</HoldingHistoryLink>
                    </p>
                    <p className="mt-1 text-sm text-slate-400">{holding.accountId}</p>
                  </div>
                  <p className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.16em] text-slate-300">
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
                  />
                  <HoldingDetail
                    label={dict.holdings.totalCostTerm}
                    value={formatCurrencyAmount(holding.costBasisAmount, holding.currency, locale)}
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
      href={`/symbols/${encodeURIComponent(holding.symbol)}?accountId=${encodeURIComponent(holding.accountId)}`}
      className="underline decoration-white/20 underline-offset-4 transition hover:text-sky-200 hover:decoration-sky-300/80"
      data-testid={`holding-history-link-${holding.accountId}-${holding.symbol}`}
    >
      {children}
    </Link>
  );
}

function getCurrentPriceTone(holding: DashboardOverviewHoldingDto): string {
  if (holding.currentUnitPrice === null) {
    return "text-slate-300";
  }
  if (holding.currentUnitPrice > holding.averageCostPerShare) {
    return "text-emerald-300";
  }
  if (holding.currentUnitPrice < holding.averageCostPerShare) {
    return "text-rose-300";
  }
  return "text-slate-100";
}

function SummaryTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="glass-inset rounded-[22px] p-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 text-xl font-semibold text-ink">{value}</p>
      <p className="mt-2 text-sm text-slate-300">{detail}</p>
    </div>
  );
}

function HoldingDetail({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</dt>
      <dd className={cn("mt-1 text-sm font-medium text-slate-100", valueClassName)}>{value}</dd>
    </div>
  );
}
