"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatCurrencyAmount, formatNumber, formatPercent } from "../../lib/utils";
import { DashboardLoading } from "../dashboard/DashboardLoading";
import { DashboardHoldingsPreview } from "../dashboard/DashboardHoldingsPreview";
import { DividendsSection } from "../dashboard/DividendsSection";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import { HoldingsTable } from "./HoldingsTable";
import { resolveHoldingGroups } from "../../features/portfolio/holdingGroups";
import { useHoldingAllocationBasis } from "../../features/portfolio/hooks/useHoldingAllocationBasis";
import { usePortfolioPrimaryData } from "../../features/portfolio/hooks/usePortfolioPageData";
import { buildRouteDtoCacheKey, getRouteDtoContextScope } from "../../lib/routeDtoCache";
import type { PortfolioPageData } from "../../features/portfolio/services/portfolioService";
import { Button } from "../ui/Button";
import { ToggleGroup, ToggleGroupItem } from "../ui/shadcn/toggle-group";

export function PortfolioClient({
  initialPrimaryData = null,
}: {
  initialPrimaryData?: PortfolioPageData | null;
}) {
  const {
    uiDict: dict,
    locale,
    routeCachePolicy,
    sessionUserId,
    isSharedContext,
    mutations,
    contextRefreshSignal,
    canUseGlobalQuickActions,
    openQuickActions,
    reportingCurrency,
  } = useAppShellData();
  const cacheKey = buildRouteDtoCacheKey("portfolio-primary", getRouteDtoContextScope(sessionUserId), locale, reportingCurrency);
  const portfolio = usePortfolioPrimaryData(initialPrimaryData, cacheKey, routeCachePolicy);
  const resetCount = useCardLayoutResetCount("portfolio");
  const { allocationBasis, setAllocationBasis } = useHoldingAllocationBasis();
  const [holdingsTableStyle, setHoldingsTableStyle] = useState<"dashboard" | "portfolio">("portfolio");
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
  const largestHoldingCostBasis = largestHolding
    ? largestHolding.reportingCostBasisAmount ?? (
        largestHolding.reportingCurrency === largestHolding.currency
          ? largestHolding.costBasisAmount
          : null
      )
    : null;
  const largestHoldingCurrency = largestHolding?.reportingCurrency ?? reportingCurrency;
  const restoredLabel = portfolio.restoredAt
    ? new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(portfolio.restoredAt))
    : null;

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
              {formatPortfolioMessage(dict.dashboardHome.positionsCount, { count: formatNumber(holdingGroups.length, locale) })}
              {" · "}
              {formatPortfolioMessage(dict.dashboardHome.marketsCount, { count: formatNumber(marketCount, locale) })}
              {" · "}
              <Link href="/dividends" className="font-medium text-primary underline-offset-4 hover:underline">
                {dict.dividends.viewAllLink}
              </Link>
            </p>
          </div>
          <div className="flex max-w-2xl flex-col items-start gap-2 text-sm leading-6 text-muted-foreground lg:items-end">
            <p>{dict.navigation.portfolioDescription}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">
                {dict.commandPalette.actionChangeReportingCurrency}: {reportingCurrency}
              </span>
              {canUseGlobalQuickActions ? (
                <Button type="button" size="sm" variant="secondary" onClick={openQuickActions}>
                  {dict.commandPalette.quickActionsTitle}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CompactMetric
            label={dict.dashboardHome.largestPositionLabel}
            value={largestHolding?.ticker ?? "-"}
            detail={largestHolding
              ? largestHoldingCostBasis == null
                ? "-"
                : formatCurrencyAmount(largestHoldingCostBasis, largestHoldingCurrency, locale)
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
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
        data-testid="portfolio-primary-refresh-strip"
      >
        <div className="flex flex-wrap items-center gap-2">
          {portfolio.restoredFromCache && restoredLabel ? (
            <span data-testid="portfolio-cache-restore-label">
              {formatPortfolioMessage(dict.dashboardHome.restoredFromCacheAt, { time: restoredLabel })}
            </span>
          ) : (
            <span>{dict.dashboardHome.portfolioSnapshotMountedDuringRefresh}</span>
          )}
          {portfolio.isRefreshing ? (
            <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              {dict.dashboardHome.refreshingLabel}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => { void portfolio.refresh(); }}
          disabled={portfolio.isRefreshing}
          data-testid="portfolio-refresh-button"
        >
          {dict.dashboardHome.refreshLabel}
        </Button>
      </div>
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
                <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3 overflow-hidden" data-testid="portfolio-holdings-style-shell">
                  <div className="flex w-full min-w-0 max-w-full flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-medium text-muted-foreground">{dict.holdings.layoutStyleLabel}</span>
                    <ToggleGroup
                      type="single"
                      aria-label={dict.holdings.layoutStyleLabel}
                      value={holdingsTableStyle}
                      onValueChange={(value) => {
                        if (value === "dashboard" || value === "portfolio") setHoldingsTableStyle(value);
                      }}
                      className="w-full flex-wrap justify-start sm:w-auto"
                      data-testid="portfolio-holdings-style-control"
                    >
                      <ToggleGroupItem value="dashboard" data-testid="portfolio-holdings-style-dashboard">
                        {dict.holdings.layoutStyleCompact}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="portfolio" data-testid="portfolio-holdings-style-portfolio">
                        {dict.holdings.layoutStyleDetailed}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  {holdingsTableStyle === "dashboard" ? (
                    <DashboardHoldingsPreview
                      fxRates={portfolio.data.fxRates ?? []}
                      groups={holdingGroups}
                      locale={locale}
                      reportingCurrency={reportingCurrency}
                      settingsContextKey="portfolio.topHoldings"
                    />
                  ) : (
                    <HoldingsTable
                      holdings={portfolio.data.holdings}
                      holdingGroups={holdingGroups}
                      instruments={portfolio.data.instruments}
                      accounts={portfolio.data.accounts}
                      dict={dict}
                      locale={locale}
                      recomputingSymbols={mutations.recomputingSymbols}
                      showFreshnessBadge={!isSharedContext}
                      allocationBasis={allocationBasis}
                      onAllocationBasisChange={setAllocationBasis}
                    />
                  )}
                </div>
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

function formatPortfolioMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, value), template);
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
