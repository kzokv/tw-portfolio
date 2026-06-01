"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { formatCurrencyAmount, formatNumber, formatPercent } from "../../lib/utils";
import { DashboardLoading } from "../dashboard/DashboardLoading";
import { DividendsSection } from "../dashboard/DividendsSection";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import { HoldingsTable } from "./HoldingsTable";
import { resolveHoldingGroups } from "../../features/portfolio/holdingGroups";
import { useHoldingAllocationBasis } from "../../features/portfolio/hooks/useHoldingAllocationBasis";
import { usePortfolioPageData } from "../../features/portfolio/hooks/usePortfolioPageData";

export function PortfolioClient() {
  const {
    uiDict: dict,
    locale,
    isSharedContext,
    mutations,
    contextRefreshSignal,
  } = useAppShellData();
  const portfolio = usePortfolioPageData();
  const resetCount = useCardLayoutResetCount("portfolio");
  const { allocationBasis, setAllocationBasis } = useHoldingAllocationBasis();
  const firstSignalRef = useRef(true);
  const refreshPortfolioRef = useRef(portfolio.refresh);
  refreshPortfolioRef.current = portfolio.refresh;

  useEffect(() => {
    if (firstSignalRef.current) {
      firstSignalRef.current = false;
      return;
    }
    void refreshPortfolioRef.current();
  }, [contextRefreshSignal]);

  if (portfolio.isBootstrapping) {
    return (
      <>
        <div className="mb-5 h-2 w-full rounded skeleton-line" aria-hidden="true" />
        <DashboardLoading />
      </>
    );
  }

  const holdingGroups = resolveHoldingGroups({
    holdings: portfolio.data.holdings,
    holdingGroups: portfolio.data.holdingGroups,
    instruments: portfolio.data.instruments,
    accounts: portfolio.data.accounts,
  });
  const largestHolding = holdingGroups[0] ?? null;
  const quotedHoldingCount = holdingGroups.filter((holding) => holding.currentUnitPrice !== null).length;
  const marketCount = new Set(holdingGroups.map((holding) => holding.marketCode)).size;
  const quoteCoverageValue = holdingGroups.length === 0
    ? "-"
    : formatPercent((quotedHoldingCount / holdingGroups.length) * 100, locale);
  const quoteCoverageDetail = holdingGroups.length === 0
    ? dict.dashboardHome.holdingsEmpty
    : `${formatNumber(quotedHoldingCount, locale)} / ${formatNumber(holdingGroups.length, locale)}`;

  return (
    <div className="stagger grid min-w-0 gap-6">
      <section
        className="grid gap-4 rounded-xl border border-border bg-card px-5 py-5 shadow-sm sm:px-6"
        data-testid="portfolio-intro"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary/78">{dict.navigation.portfolioLabel}</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{dict.navigation.portfolioLabel}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {`${formatNumber(holdingGroups.length, locale)} positions`}
              {" · "}
              {`${formatNumber(marketCount, locale)} markets`}
              {" · "}
              <Link href="/dividends" className="font-medium text-primary underline-offset-4 hover:underline">
                {dict.dividends.viewAllLink}
              </Link>
            </p>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{dict.navigation.portfolioDescription}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CompactMetric
            label={dict.dashboardHome.largestPositionLabel}
            value={largestHolding?.ticker ?? "-"}
            detail={largestHolding
              ? formatCurrencyAmount(largestHolding.costBasisAmount, largestHolding.reportingCurrency ?? largestHolding.currency, locale)
              : dict.dashboardHome.holdingsEmpty}
          />
          <CompactMetric
            label={dict.dashboardHome.concentrationLabel}
            value={largestHolding?.allocationPct !== null && largestHolding?.allocationPct !== undefined
              ? formatPercent(largestHolding.allocationPct, locale)
              : "-"}
            detail={largestHolding ? dict.dashboardHome.allocationLabel : dict.dashboardHome.holdingsEmpty}
          />
          <CompactMetric
            label={dict.dashboardHome.holdingCountLabel}
            value={formatNumber(holdingGroups.length, locale)}
            detail={dict.holdings.entries.replace("{count}", String(holdingGroups.length))}
          />
          <CompactMetric
            label={dict.dashboardHome.quoteCoverageLabel}
            value={quoteCoverageValue}
            detail={quoteCoverageDetail}
          />
        </div>
      </section>
      {/*
        KZO-162 — Portfolio cards rendered as a SortableCardGrid. Slugs
        `holdings-table` and `dividends-section` are intentionally reused
        from `DASHBOARD_CARDS` — same components, different `cardOrder.{key}`
        namespace, so dashboard reorder and portfolio reorder are isolated.
        To add a card here, append a `{slug, fullWidth}` entry AND add a
        `case` to the switch below.
      */}
      <SortableCardGrid
        key={`card-grid-portfolio-${resetCount}`}
        orderKey="portfolio"
        cards={[
          { slug: "holdings-table", fullWidth: true },
          { slug: "dividends-section", fullWidth: true },
        ]}
      >
        {(slug) => {
          switch (slug) {
            case "holdings-table":
              return (
                <HoldingsTable
                  holdings={portfolio.data.holdings}
                  holdingGroups={holdingGroups}
                  instruments={portfolio.data.instruments}
                  accounts={portfolio.data.accounts}
                  dict={dict}
                  locale={locale}
                  recomputingSymbols={mutations.recomputingSymbols}
                  showFreshnessBadge={!isSharedContext}
                  variant="compact"
                  allocationBasis={allocationBasis}
                  onAllocationBasisChange={setAllocationBasis}
                />
              );
            case "dividends-section":
              return (
                <DividendsSection
                  upcoming={portfolio.data.dividends.upcoming}
                  recent={portfolio.data.dividends.recent}
                  dict={dict}
                  locale={locale}
                />
              );
            default:
              return null;
          }
        }}
      </SortableCardGrid>
    </div>
  );
}

function CompactMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
