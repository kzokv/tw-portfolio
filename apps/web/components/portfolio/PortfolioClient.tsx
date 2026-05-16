"use client";

import { formatCurrencyAmount, formatNumber, formatPercent } from "../../lib/utils";
import { DashboardLoading } from "../dashboard/DashboardLoading";
import { DividendsSection } from "../dashboard/DividendsSection";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { RouteHeroPanel } from "../layout/SectionHeroPanels";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import { HoldingsTable } from "./HoldingsTable";

export function PortfolioClient() {
  const {
    dashboard,
    uiDict: dict,
    locale,
    isSharedContext,
    isBootstrapping,
    isI18nReady,
    mutations,
  } = useAppShellData();
  const resetCount = useCardLayoutResetCount("portfolio");

  if (isBootstrapping || !isI18nReady) {
    return (
      <>
        <div className="mb-5 h-2 w-full rounded skeleton-line" aria-hidden="true" />
        <DashboardLoading />
      </>
    );
  }

  const largestHolding = dashboard.holdings[0] ?? null;
  const quotedHoldingCount = dashboard.holdings.filter((holding) => holding.currentUnitPrice !== null).length;
  const quoteCoverageValue = dashboard.holdings.length === 0
    ? "-"
    : formatPercent((quotedHoldingCount / dashboard.holdings.length) * 100, locale);
  const quoteCoverageDetail = dashboard.holdings.length === 0
    ? dict.dashboardHome.holdingsEmpty
    : `${formatNumber(quotedHoldingCount, locale)} / ${formatNumber(dashboard.holdings.length, locale)}`;

  return (
    <div className="stagger grid min-w-0 gap-6">
      <RouteHeroPanel
        eyebrow={dict.navigation.portfolioLabel}
        title={dict.dashboardHome.holdingsTitle}
        description={dict.navigation.portfolioDescription}
        testId="portfolio-intro"
        metrics={[
          {
            label: dict.dashboardHome.largestPositionLabel,
            value: largestHolding?.ticker ?? "-",
            detail: largestHolding
              ? formatCurrencyAmount(largestHolding.costBasisAmount, largestHolding.currency, locale)
              : dict.dashboardHome.holdingsEmpty,
          },
          {
            label: dict.dashboardHome.concentrationLabel,
            value: largestHolding?.allocationPct !== null && largestHolding?.allocationPct !== undefined
              ? formatPercent(largestHolding.allocationPct, locale)
              : "-",
            detail: largestHolding ? largestHolding.accountId : dict.dashboardHome.holdingsEmpty,
          },
          {
            label: dict.dashboardHome.holdingCountLabel,
            value: formatNumber(dashboard.holdings.length, locale),
            detail: dict.holdings.entries.replace("{count}", String(dashboard.holdings.length)),
          },
          {
            label: dict.dashboardHome.quoteCoverageLabel,
            value: quoteCoverageValue,
            detail: quoteCoverageDetail,
          },
        ]}
      />
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
                  holdings={dashboard.holdings}
                  dict={dict}
                  locale={locale}
                  recomputingSymbols={mutations.recomputingSymbols}
                  showFreshnessBadge={!isSharedContext}
                />
              );
            case "dividends-section":
              return (
                <DividendsSection
                  upcoming={dashboard.dividends.upcoming}
                  recent={dashboard.dividends.recent}
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
