"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AccountDefaultCurrency, DashboardPerformanceRange, LocaleCode } from "@vakwen/shared-types";
import { formatCompactCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { patchJson } from "../../lib/api";
import { useDashboardPrimaryData } from "../../features/dashboard/hooks/useDashboardData";
import { useDashboardPerformance } from "../../features/dashboard/hooks/useDashboardPerformance";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { AllocationSnapshotCard } from "./AllocationSnapshotCard";
import { BiggestMoversCard } from "./BiggestMoversCard";
import { DashboardHero } from "./DashboardHero";
import { DashboardHoldingsPreview } from "./DashboardHoldingsPreview";
import { Alert, AlertDescription, AlertTitle } from "../ui/shadcn/alert";
import { Button } from "../ui/Button";
import { DASHBOARD_CARDS } from "./cards";
import { DashboardLoading } from "./DashboardLoading";
import { DividendsSection } from "./DividendsSection";
import { PortfolioTrendCard } from "./PortfolioTrendCard";
import { ReturnPercentCard } from "./ReturnPercentCard";
import { CustomizeRangesPopover } from "../settings/CustomizeRangesPopover";
import { resolveHoldingGroups, type DashboardOverviewHoldingGroupDto } from "../../features/portfolio/holdingGroups";
import { useHoldingAllocationBasis } from "../../features/portfolio/hooks/useHoldingAllocationBasis";
import { useEffectiveRanges } from "../../hooks/useEffectiveRanges";
import { buildRouteDtoCacheKey, clearRouteDtoCacheByPrefix, getRouteDtoCachePrefix, getRouteDtoContextScope } from "../../lib/routeDtoCache";
import { Badge } from "../ui/shadcn/badge";
import {
  Card as ShadcnCard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/shadcn/card";
import type { DashboardSnapshot } from "../../features/dashboard/types";

const DEFAULT_TRANSACTION = {
  accountId: "",
  ticker: "",
  marketCode: null,
  quantity: 1000,
  unitPrice: 100,
  priceCurrency: "TWD" as const,
  tradeDate: new Date().toISOString().slice(0, 10),
  type: "BUY" as const,
  isDayTrade: false,
};

export function DashboardClient({
  initialPrimaryData = null,
  expectedReportingCurrency,
}: {
  expectedReportingCurrency?: AccountDefaultCurrency | null;
  initialPrimaryData?: DashboardSnapshot | null;
}) {
  const {
    uiDict: dict,
    locale,
    sessionUserId,
    isSharedContext,
    recomputeAction,
    openRecomputeConfirm,
    contextRefreshSignal,
  } = useAppShellData();
  const cacheKey = buildRouteDtoCacheKey("dashboard-primary", getRouteDtoContextScope(sessionUserId), locale);
  const dashboard = useDashboardPrimaryData({
    cacheKey,
    expectedReportingCurrency,
    initialTransaction: DEFAULT_TRANSACTION,
    initialPrimaryData,
  });
  const resetCount = useCardLayoutResetCount("dashboard");
  const { allocationBasis } = useHoldingAllocationBasis();
  const [performanceRange, setPerformanceRange] = useState<DashboardPerformanceRange>("1M");
  const [currencySaving, setCurrencySaving] = useState(false);
  const [currencyError, setCurrencyError] = useState("");
  const { effectiveRanges, refetch: refetchEffectiveRanges } = useEffectiveRanges();
  const [customizeRangesOpen, setCustomizeRangesOpen] = useState(false);
  // DashboardClient only mounts on /dashboard; enabled unconditionally true.
  const performance = useDashboardPerformance({ range: performanceRange, enabled: true });

  async function handleHeroCurrencyChange(next: AccountDefaultCurrency) {
    if (next === dashboard.summary.reportingCurrency || currencySaving) return;
    setCurrencySaving(true);
    setCurrencyError("");
    try {
      await patchJson("/user-preferences", { reportingCurrency: next });
      clearRouteDtoCacheByPrefix(getRouteDtoCachePrefix());
      await dashboard.refresh();
      await performance.refresh();
    } catch (error) {
      setCurrencyError(error instanceof Error ? error.message : String(error));
    } finally {
      setCurrencySaving(false);
    }
  }

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
  const refreshDashboardRef = useRef(dashboard.refresh);
  refreshDashboardRef.current = dashboard.refresh;
  const refreshPerformanceRef = useRef(performance.refresh);
  refreshPerformanceRef.current = performance.refresh;
  useEffect(() => {
    if (firstSignalRef.current) {
      firstSignalRef.current = false;
      return;
    }
    void refreshDashboardRef.current();
    void refreshPerformanceRef.current();
  }, [contextRefreshSignal]);

  useEffect(() => {
    if (effectiveRanges.length === 0) return;
    if (!effectiveRanges.includes(performanceRange)) {
      setPerformanceRange(effectiveRanges[0]);
    }
  }, [effectiveRanges, performanceRange]);

  if (dashboard.isBootstrapping) {
    return (
      <>
        <div className="mb-5 h-2 w-full rounded skeleton-line" aria-hidden="true" />
        <DashboardLoading />
      </>
    );
  }

  const holdingGroups = resolveHoldingGroups({
    holdings: dashboard.holdings,
    holdingGroups: dashboard.holdingGroups,
    instruments: dashboard.instruments,
    accounts: dashboard.accounts,
  });
  const restoredLabel = dashboard.restoredAt
    ? new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(dashboard.restoredAt))
    : null;

  return (
    <div className="stagger grid min-w-0 gap-6">
      {/* Phase 5e — persistent integrity Alert above hero when an
          integrity issue is present. Not dismissible; clears when
          `integrityIssue` resolves on next dashboard fetch. */}
      {dashboard.actions.integrityIssue ? (
        <Alert variant="destructive" data-testid="dashboard-integrity-alert">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>{dict.dialogs.integrityTitle}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{dashboard.actions.integrityIssue.message}</span>
            <Button
              asChild
              size="sm"
              variant="secondary"
              className="self-start"
              data-testid="dashboard-integrity-alert-fix-cta"
            >
              <Link href="/settings">Fix in Settings</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Phase 5d — above-the-fold hero: total + day Δ + biggest movers.
          Hero block is non-draggable and fixed above the SortableCardGrid. */}
      <section
        className="grid gap-3 lg:grid-cols-[2fr_1fr]"
        data-testid="dashboard-hero-block"
      >
        <DashboardHero
          currencyError={currencyError}
          holdingGroups={holdingGroups}
          fxRates={dashboard.fxRates ?? []}
          isCurrencySaving={currencySaving}
          isCurrencyReadOnly={isSharedContext}
          summary={dashboard.summary}
          locale={locale}
          dict={dict}
          onCurrencyChange={(currency) => { void handleHeroCurrencyChange(currency); }}
        />
        <BiggestMoversCard groups={holdingGroups} locale={locale} dict={dict} />
      </section>

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
        data-testid="dashboard-primary-refresh-strip"
      >
        <div className="flex flex-wrap items-center gap-2">
          {dashboard.restoredFromCache && restoredLabel ? (
            <span data-testid="dashboard-cache-restore-label">Restored from cache at {restoredLabel}</span>
          ) : (
            <span>Primary data stays mounted during refresh.</span>
          )}
          {dashboard.isRefreshing ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Silent refresh running
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => { void dashboard.refresh(); }}
          disabled={dashboard.isRefreshing}
          data-testid="dashboard-refresh-button"
        >
          Refresh
        </Button>
        {!isSharedContext ? (
          <Button
            type="button"
            size="sm"
            onClick={openRecomputeConfirm}
            disabled={recomputeAction.isRunning}
            data-testid="recompute-button"
          >
            <RotateCw data-icon="inline-start" aria-hidden="true" />
            {recomputeAction.isRunning ? dict.actions.recomputing : dict.actions.recomputeHistory}
          </Button>
        ) : null}
      </div>

      <DashboardCommandModules
        groups={holdingGroups}
        locale={locale}
        summary={dashboard.summary}
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
                  groups={holdingGroups}
                  locale={locale}
                  dict={dict}
                  allocationBasis={allocationBasis}
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
                <DashboardHoldingsPreview
                  fxRates={dashboard.fxRates ?? []}
                  groups={holdingGroups}
                  locale={locale}
                  reportingCurrency={dashboard.summary.reportingCurrency}
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
            // Phase 5e — `action-center` removed from DASHBOARD_CARDS;
            // recompute / generate-snapshots moved to FloatingQuickActions
            // (rendered by AppShell); integrity surfaces as the standalone
            // Alert above the hero (see below in this same file).
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

export function DashboardCommandModules({
  groups,
  locale,
  summary,
}: {
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  summary: DashboardSnapshot["summary"];
}) {
  const largestHolding = groups[0] ?? null;
  const topMover = [...groups]
    .sort((left, right) => Math.abs(right.change ?? 0) - Math.abs(left.change ?? 0))[0] ?? null;
  const marketCount = new Set(groups.map((group) => group.marketCode)).size;
  const reportCurrencyParams = `currencyMode=specified&currency=${summary.reportingCurrency}&range=1Y`;

  return (
    <section className="grid gap-3 md:grid-cols-3" data-testid="dashboard-command-modules">
      <DashboardCommandCard
        description={summary.asOf ? formatDateLabel(summary.asOf, locale) : "Latest available snapshot"}
        href={`/reports?tab=daily-review&scope=all&${reportCurrencyParams}`}
        testId="dashboard-command-today"
        title="Today"
        value={summary.dailyChangeAmount === null
          ? "-"
          : formatCompactCurrencyAmount(summary.dailyChangeAmount, summary.reportingCurrency, locale)}
      >
        <div className="flex flex-wrap gap-2">
          {summary.dailyChangePercent !== null ? <Badge variant="secondary">{formatPercent(summary.dailyChangePercent, locale)}</Badge> : null}
          <Badge variant={summary.openIssueCount > 0 ? "destructive" : "outline"}>
            {formatNumber(summary.openIssueCount, locale)} issue(s)
          </Badge>
          <Badge variant="outline">{formatNumber(summary.upcomingDividendCount, locale)} dividend(s)</Badge>
        </div>
      </DashboardCommandCard>

      <DashboardCommandCard
        description={`FX ${summary.fxStatus}`}
        href={`/reports?tab=market&scope=all&${reportCurrencyParams}`}
        testId="dashboard-command-market-pulse"
        title="Market Pulse"
        value={`${formatNumber(marketCount, locale)} market(s)`}
      >
        <p className="text-sm text-muted-foreground">
          {topMover
            ? `${topMover.ticker} / ${topMover.marketCode}: ${topMover.change === null ? "-" : formatCompactCurrencyAmount(topMover.change, topMover.currency, locale)}`
            : "No market movers available."}
        </p>
      </DashboardCommandCard>

      <DashboardCommandCard
        description={largestHolding ? `${largestHolding.ticker} / ${largestHolding.marketCode}` : "No holdings"}
        href={`/reports?tab=portfolio&scope=all&${reportCurrencyParams}`}
        testId="dashboard-command-portfolio-health"
        title="Portfolio Health"
        value={largestHolding?.allocationPct !== null && largestHolding?.allocationPct !== undefined
          ? formatPercent(largestHolding.allocationPct, locale)
          : "-"}
      >
        <p className="text-sm text-muted-foreground">
          Unrealized {summary.unrealizedPnlAmount === null ? "-" : formatCompactCurrencyAmount(summary.unrealizedPnlAmount, summary.reportingCurrency, locale)}
        </p>
      </DashboardCommandCard>
    </section>
  );
}

function DashboardCommandCard({
  children,
  description,
  href,
  testId,
  title,
  value,
}: {
  children: ReactNode;
  description: string;
  href: string;
  testId: string;
  title: string;
  value: string;
}) {
  return (
    <ShadcnCard data-testid={testId}>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardDescription>{title}</CardDescription>
            <CardTitle className="mt-1 font-mono text-2xl tabular-nums">{value}</CardTitle>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link href={href}>Open</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        {children}
      </CardContent>
    </ShadcnCard>
  );
}
