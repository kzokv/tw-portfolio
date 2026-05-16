"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { useDashboardPerformance } from "../../features/dashboard/hooks/useDashboardPerformance";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { RouteHeroPanel } from "../layout/SectionHeroPanels";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import { HoldingsTable } from "../portfolio/HoldingsTable";
import { ActionCenterSection } from "./ActionCenterSection";
import { AllocationSnapshotCard } from "./AllocationSnapshotCard";
import { DASHBOARD_CARDS } from "./cards";
import { DashboardLoading } from "./DashboardLoading";
import { DividendsSection } from "./DividendsSection";
import { PortfolioTrendCard } from "./PortfolioTrendCard";
import { ReturnPercentCard } from "./ReturnPercentCard";
import { CustomizeRangesPopover } from "../settings/CustomizeRangesPopover";

export function DashboardClient() {
  const router = useRouter();
  const {
    dashboard,
    uiDict: dict,
    locale,
    isSharedContext,
    isBootstrapping,
    isI18nReady,
    recomputeAction,
    mutations,
    performanceRange,
    setPerformanceRange,
    effectiveRanges,
    refetchEffectiveRanges,
    customizeRangesOpen,
    setCustomizeRangesOpen,
    generateSnapshots,
    isGeneratingSnapshots,
    contextRefreshSignal,
  } = useAppShellData();
  const resetCount = useCardLayoutResetCount("dashboard");
  // DashboardClient only mounts on /dashboard; enabled unconditionally true.
  const performance = useDashboardPerformance({ range: performanceRange, enabled: true });

  // Re-fetch performance series when AppShell signals a context/data change
  // (shared-context switch, trade mutation, recompute confirm, reporting-currency
  // save, snapshot generation, retry click). Initial mount skipped — the hook
  // performs its own first-load fetch.
  //
  // Phase 3d iter 2 §4.2 (architect-identified React #185 candidate) —
  // capture `performance.refresh` in a ref so the effect depends ONLY on
  // `contextRefreshSignal`. The previous form depended on `performance.refresh`
  // directly; if its identity ever shifted on a re-render triggered by
  // the refresh itself, the effect re-fired and looped (Maximum update
  // depth exceeded). The ref form is cycle-safe even if `useDashboardPerformance`
  // later changes its memoization shape.
  const firstSignalRef = useRef(true);
  const refreshPerformanceRef = useRef(performance.refresh);
  refreshPerformanceRef.current = performance.refresh;
  useEffect(() => {
    if (firstSignalRef.current) {
      firstSignalRef.current = false;
      return;
    }
    void refreshPerformanceRef.current();
  }, [contextRefreshSignal]);

  if (isBootstrapping || !isI18nReady) {
    return (
      <>
        <div className="mb-5 h-2 w-full rounded skeleton-line" aria-hidden="true" />
        <DashboardLoading />
      </>
    );
  }

  const largestHolding = dashboard.holdings[0] ?? null;

  return (
    <div className="stagger grid min-w-0 gap-6">
      <RouteHeroPanel
        eyebrow={dict.navigation.dashboardLabel}
        title={dict.dashboardHome.summaryTitle}
        description={dict.dashboardHome.summaryDescription}
        testId="dashboard-intro"
        metrics={[
          {
            label: dict.dashboardHome.marketValueLabel,
            value: dashboard.summary.marketValueAmount !== null
              ? formatCurrencyAmount(dashboard.summary.marketValueAmount, dashboard.summary.reportingCurrency, locale)
              : dict.dashboardHome.noMarketValue,
            detail: dashboard.summary.asOf ? formatDateLabel(dashboard.summary.asOf, locale) : dict.dashboardHome.asOfLabel,
          },
          {
            label: dict.dashboardHome.concentrationLabel,
            value: largestHolding?.allocationPct !== null && largestHolding?.allocationPct !== undefined
              ? formatPercent(largestHolding.allocationPct, locale)
              : "-",
            detail: largestHolding ? `${largestHolding.accountId} / ${largestHolding.ticker}` : dict.dashboardHome.holdingsEmpty,
          },
          {
            label: dict.dashboardHome.unrealizedPnlLabel,
            value: dashboard.summary.unrealizedPnlAmount !== null
              ? formatCurrencyAmount(dashboard.summary.unrealizedPnlAmount, dashboard.summary.reportingCurrency, locale)
              : dict.dashboardHome.noMarketValue,
            detail: formatCurrencyAmount(dashboard.summary.totalCostAmount, dashboard.summary.reportingCurrency, locale),
          },
          {
            label: dict.dashboardHome.dailyChangeLabel,
            value: dashboard.summary.dailyChangeAmount !== null
              ? formatCurrencyAmount(dashboard.summary.dailyChangeAmount, dashboard.summary.reportingCurrency, locale)
              : dict.dashboardHome.noMarketValue,
            detail: dashboard.summary.dailyChangePercent !== null
              ? formatPercent(dashboard.summary.dailyChangePercent, locale)
              : "-",
          },
          {
            label: dict.dashboardHome.issueCountLabel,
            value: formatNumber(dashboard.summary.openIssueCount, locale),
            detail: dashboard.summary.openIssueCount > 0 ? dict.dialogs.integrityTitle : dict.dashboardHome.actionHealthyTitle,
          },
        ]}
        // KZO-161 (158C) F4: hero pill row removed — `PortfolioTrendCard` is
        // now the sole pill surface. `actions` stays typed for future use.
      />

      {/*
        KZO-161 (158C) F5: dashboard cards rendered as one flat
        `<SortableCardGrid>`. Render order is canonical ⋈ user-preference
        `cardOrder.dashboard` (unknown slugs dropped, new slugs appended).
        `ActionCenterSection` is also draggable (full-width slot at end of
        canonical list). `key` bumps on Reset Layout to re-fetch.
      */}
      <SortableCardGrid
        key={`card-grid-dashboard-${resetCount}`}
        cards={DASHBOARD_CARDS}
        orderKey="dashboard"
      >
        {(slug) => {
          switch (slug) {
            case "portfolio-trend":
              return (
                <PortfolioTrendCard
                  data={performance.data}
                  range={performanceRange}
                  ranges={effectiveRanges}
                  currency={dashboard.summary.reportingCurrency}
                  locale={locale}
                  dict={dict}
                  isLoading={performance.isLoading}
                  errorMessage={performance.errorMessage}
                  onRangeChange={setPerformanceRange}
                  onOpenCustomize={() => setCustomizeRangesOpen(true)}
                />
              );
            case "allocation-snapshot":
              return (
                <AllocationSnapshotCard
                  holdings={dashboard.holdings}
                  locale={locale}
                  dict={dict}
                />
              );
            case "return-percent":
              return (
                <ReturnPercentCard
                  data={performance.data}
                  locale={locale}
                  dict={dict}
                  isLoading={performance.isLoading}
                  errorMessage={performance.errorMessage}
                />
              );
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
            case "action-center":
              return (
                <ActionCenterSection
                  locale={locale}
                  settings={dashboard.settings}
                  integrityIssue={dashboard.actions.integrityIssue}
                  pending={recomputeAction.isRunning}
                  onRecompute={recomputeAction.runRecompute}
                  onGenerateSnapshots={generateSnapshots}
                  isGeneratingSnapshots={isGeneratingSnapshots}
                  onOpenSettings={() => router.push("/settings")}
                  dict={dict}
                  readOnly={isSharedContext}
                  readOnlyMessage={dict.switcher.readonlyDescription}
                />
              );
            default:
              return null;
          }
        }}
      </SortableCardGrid>

      {customizeRangesOpen ? (
        <CustomizeRangesPopover
          variant="popover"
          onClose={() => setCustomizeRangesOpen(false)}
          onSaved={refetchEffectiveRanges}
          copy={{
            title: dict.settings.customizeRangesTitle,
            activeSectionLabel: dict.settings.customizeRangesActiveLabel,
            addCustomLabel: dict.settings.customizeRangesAddCustomLabel,
            addCustomPlaceholder: dict.settings.customizeRangesAddPlaceholder,
            addCustomHint: dict.settings.customizeRangesAddHint,
            saveLabel: dict.settings.customizeRangesSaveLabel,
            savingLabel: dict.settings.customizeRangesSavingLabel,
            resetLabel: dict.settings.customizeRangesResetLabel,
            saveSuccess: dict.settings.customizeRangesSaveSuccess,
            saveError: dict.settings.customizeRangesSaveError,
            closeLabel: dict.settings.customizeRangesCloseLabel,
            toggleOnLabel: (range) =>
              dict.settings.customizeRangesToggleOnLabel.replace("{range}", range),
            toggleOffLabel: (range) =>
              dict.settings.customizeRangesToggleOffLabel.replace("{range}", range),
          }}
        />
      ) : null}
    </div>
  );
}
