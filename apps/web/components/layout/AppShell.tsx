"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  type DashboardPerformanceRange,
  type LocaleCode,
} from "@vakwen/shared-types";
import { getDictionary } from "../../lib/i18n";
import type { TransactionInput } from "../portfolio/types";
import { AppShellLayout } from "./AppShellLayout";
import { BreadcrumbProvider } from "./BreadcrumbProvider";
import { useDashboardData } from "../../features/dashboard/hooks/useDashboardData";
import { useRecomputeAction } from "../../features/portfolio/hooks/useRecomputeAction";
import { useTransactionSubmission } from "../../features/portfolio/hooks/useTransactionSubmission";
import { useTransactionMutations } from "../../features/portfolio/hooks/useTransactionMutations";
import { useProfile, type ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";
import { useNotifications } from "../../hooks/useNotifications";
import { useEffectiveRanges } from "../../hooks/useEffectiveRanges";
import { PortfolioSwitcher } from "./PortfolioSwitcher";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { AppShellDataProvider } from "./AppShellDataContext";
import { useAppShellDataValue } from "./useAppShellDataValue";
import { useSnapshotGeneration } from "./useSnapshotGeneration";
import { useSharedContext } from "./useSharedContext";
import { useAppNavigation } from "./useAppNavigation";
import { CommandPalette } from "./CommandPalette";
import { CommandPaletteProvider } from "./CommandPaletteContext";
import { NavigationFeedbackProvider } from "./NavigationFeedbackContext";
import { useCommandPalette } from "../../hooks/useCommandPalette";
import { AddTransactionDialog } from "../portfolio/AddTransactionDialog";
import { FloatingQuickActions } from "../dashboard/FloatingQuickActions";
import { RecomputeConfirmDialog } from "../portfolio/RecomputeConfirmDialog";

type AppSection = "dashboard" | "portfolio" | "transactions" | "dividends" | "cash-ledger";

interface AppShellProps {
  /** Retained for back-compat with callers; the new shell derives the
   * active surface from `usePathname` so callers can stop passing this. */
  section?: AppSection;
  isDemo?: boolean;
  localeOverride?: LocaleCode;
  /** Legacy props retained for back-compat (used by the sharing page to
   * pass overrides); now ignored — the breadcrumb owns titling. */
  titleOverride?: string;
  descriptionOverride?: string;
  activeSectionOverride?: AppSection | null;
  initialProfile?: ProfileWithImpersonationDto | null;
  /** SSR-resolved sidebar collapsed state (Preserves §8 item 14). */
  initialSidebarOpen?: boolean;
  children?: React.ReactNode;
}

const DEFAULT_TRANSACTION: TransactionInput = {
  accountId: "",
  ticker: "",
  marketCode: null,
  quantity: 1000,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: new Date().toISOString().slice(0, 10),
  type: "BUY",
  isDayTrade: false,
};

export function AppShell({
  section: _section = "dashboard",
  isDemo = false,
  localeOverride,
  titleOverride: _titleOverride,
  descriptionOverride: _descriptionOverride,
  activeSectionOverride: _activeSectionOverride,
  initialProfile = null,
  initialSidebarOpen = true,
  children,
}: AppShellProps) {
  const [isClientReady, setIsClientReady] = useState(false);
  const [performanceRange, setPerformanceRange] = useState<DashboardPerformanceRange>("1M");
  // KZO-161 (158C) / KZO-159 — Effective dashboard performance ranges.
  const { effectiveRanges, refetch: refetchEffectiveRanges } = useEffectiveRanges();
  // KZO-161 (158C) F4 — gear icon → customize-ranges popover open state.
  const [customizeRangesOpen, setCustomizeRangesOpen] = useState(false);

  const dashboard = useDashboardData({ initialTransaction: DEFAULT_TRANSACTION });
  const profileData = useProfile(initialProfile);
  const impersonation = profileData.profile?.impersonation
    && profileData.profile.impersonation.active !== false
    ? profileData.profile.impersonation
    : null;

  const locale: LocaleCode = localeOverride ?? dashboard.settings?.locale ?? "en";
  const dict = useMemo(() => getDictionary(locale), [locale]);

  const sharedContext = useSharedContext({
    refreshDashboard: dashboard.refresh,
    refreshProfile: profileData.refresh,
    dict,
  });
  const {
    inboundShares,
    switcherLoaded,
    currentContextOwnerId,
    currentSharedOwnerLabel,
    isSharedContext,
    contextMessage,
    contextRefreshSignal,
    bumpContextRefreshSignal,
    refreshContextDependentData,
    handleContextSelect,
    handleSharingNotification,
  } = sharedContext;

  const hasOwnerEmptyPortfolio = isSharedContext && dashboard.holdings.length === 0;
  // Preserves §8 item 4 — shared-context dictionary remapping for empty
  // portfolio / empty transactions copy.
  const uiDict = useMemo(() => {
    if (!isSharedContext) return dict;
    return {
      ...dict,
      dashboardHome: hasOwnerEmptyPortfolio
        ? {
          ...dict.dashboardHome,
          holdingsEmpty: dict.switcher.sharedHoldingsEmpty.replace("{owner}", currentSharedOwnerLabel),
        }
        : dict.dashboardHome,
      transactions: {
        ...dict.transactions,
        recentLedgerEmpty: dict.switcher.sharedTransactionsEmpty.replace("{owner}", currentSharedOwnerLabel),
      },
    };
  }, [currentSharedOwnerLabel, dict, hasOwnerEmptyPortfolio, isSharedContext]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  // KZO-161 (158C) range-snap guard.
  useEffect(() => {
    if (effectiveRanges.length === 0) return;
    if (!effectiveRanges.includes(performanceRange)) {
      setPerformanceRange(effectiveRanges[0]);
    }
  }, [effectiveRanges, performanceRange]);

  const refreshAfterTransaction = useCallback(async () => {
    await dashboard.refresh();
    bumpContextRefreshSignal();
  }, [bumpContextRefreshSignal, dashboard]);

  const transactionSubmission = useTransactionSubmission({
    initialValue: DEFAULT_TRANSACTION,
    noAccountsMessage: dict.feedback.noAccounts,
    tickerRequiredMessage: dict.transactions.tickerRequired,
    successMessage: dict.feedback.transactionSubmitted,
    refresh: refreshAfterTransaction,
  });

  const recomputeAction = useRecomputeAction({
    locale,
    fallbackConfirm: dict.recompute.fallbackConfirm,
    refresh: refreshAfterTransaction,
  });

  const snapshotGeneration = useSnapshotGeneration({
    dict,
    onSuccess: bumpContextRefreshSignal,
  });

  const mutations = useTransactionMutations({
    locale,
    dict,
    refresh: refreshAfterTransaction,
    onSnapshotsGenerated: snapshotGeneration.handleSnapshotsGenerated,
  });

  // Preserves §8 item 11 — useNotifications stays here with `enabled: true`
  // (SSE pre-connect) per `react-useEventStream-preconnect-pattern.md`.
  const notificationData = useNotifications({ onSharingNotification: handleSharingNotification });
  const [notificationDropdownOpen, setNotificationDropdownOpen] = useState(false);

  const transactionAccountOptions = useMemo(
    () =>
      dashboard.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        feeProfileName:
          dashboard.feeProfiles.find((profile) => profile.id === account.feeProfileId)?.name ?? "",
        defaultCurrency: account.defaultCurrency,
        accountType: account.accountType,
      })),
    [dashboard.accounts, dashboard.feeProfiles],
  );

  const isI18nReady = !!dashboard.settings || !!localeOverride;

  useEffect(() => {
    transactionSubmission.setDraftTransaction((previous) => dashboard.synchronizeTransactionDraft(previous));
  }, [dashboard.synchronizeTransactionDraft, transactionSubmission.setDraftTransaction]);

  const globalError = transactionSubmission.errorMessage || recomputeAction.errorMessage || dashboard.errorMessage;

  const { quickSearchItems } = useAppNavigation(dict, dashboard.instruments);

  const handleClearGlobalError = useCallback(() => {
    dashboard.setErrorMessage("");
    transactionSubmission.setErrorMessage("");
    recomputeAction.setErrorMessage("");
    void (async () => {
      await dashboard.refresh();
      bumpContextRefreshSignal();
    })().catch(() => undefined);
  }, [bumpContextRefreshSignal, dashboard, recomputeAction, transactionSubmission]);

  const handleReportingCurrencySaved = useCallback(() => {
    void dashboard.refresh();
    bumpContextRefreshSignal();
  }, [bumpContextRefreshSignal, dashboard]);

  // Phase 3e — global ⌘K palette state + AlertDialog state for `recompute.all`.
  const commandPalette = useCommandPalette();
  const [addTransactionDialogOpen, setAddTransactionDialogOpen] = useState(false);
  const [recomputeDialogOpen, setRecomputeDialogOpen] = useState(false);

  const handleAddTransactionFromPalette = useCallback(() => {
    setAddTransactionDialogOpen(true);
  }, []);

  const handleRecomputeFromPalette = useCallback(() => {
    setRecomputeDialogOpen(true);
  }, []);

  const appShellDataValue = useAppShellDataValue({
    dashboard,
    uiDict,
    locale,
    isSharedContext,
    isI18nReady,
    transactionSubmission,
    mutations,
    recomputeAction,
    openRecomputeConfirm: handleRecomputeFromPalette,
    transactionAccountOptions,
    performanceRange,
    setPerformanceRange,
    effectiveRanges,
    refetchEffectiveRanges,
    customizeRangesOpen,
    setCustomizeRangesOpen,
    generateSnapshots: snapshotGeneration.generateSnapshots,
    isGeneratingSnapshots: snapshotGeneration.isGeneratingSnapshots,
    contextRefreshSignal,
  });

  const portfolioSwitcher = inboundShares.length > 0 ? (
    <PortfolioSwitcher
      inboundActive={inboundShares}
      currentContextOwnerId={currentContextOwnerId}
      onSelect={handleContextSelect}
      dict={uiDict.switcher}
    />
  ) : null;

  // Phase 5e — pathname used to gate the floating ⨁ to /dashboard only.
  const pathname = usePathname() ?? "/";

  const handleRecomputeConfirm = useCallback(() => {
    setRecomputeDialogOpen(false);
    // §12 A2 — skip the in-hook `window.confirm` because the AlertDialog
    // has already collected the user's confirmation.
    void recomputeAction.runRecompute({ skipConfirm: true });
  }, [recomputeAction]);

  const commandPaletteContextValue = useMemo(
    () => ({
      open: commandPalette.open,
      setOpen: commandPalette.setOpen,
      openWithQuery: commandPalette.openWithQuery,
    }),
    [commandPalette.open, commandPalette.setOpen, commandPalette.openWithQuery],
  );

  return (
    <div className="app-shell relative flex min-h-screen w-full min-w-0 max-w-full flex-col overflow-x-clip" data-testid="app-shell">
      {isDemo && (
        <div
          className="flex h-8 items-center justify-center bg-amber-100 text-xs font-medium text-amber-800"
          data-testid="demo-banner"
        >
          You&apos;re using a demo session.
        </div>
      )}
      {/* Preserves §8 item 6 — ImpersonationBanner above SidebarProvider so
          it spans the full viewport above sidebar + content. ResizeObserver
          dropped per design §3; banner stacks naturally. */}
      <ImpersonationBanner
        impersonation={impersonation}
        onRefreshContext={refreshContextDependentData}
      />

      <BreadcrumbProvider>
        {/* AppShellDataProvider lifted to wrap SidebarProvider so the
            Breadcrumb in TopBar can read `uiDict` for locale-aware fallback
            labels (e.g. "持倉" in zh-TW). Children still consume the same
            context via useAppShellData inside <main> below. */}
        <AppShellDataProvider value={appShellDataValue}>
          <CommandPaletteProvider value={commandPaletteContextValue}>
            <NavigationFeedbackProvider>
              <AppShellLayout
                initialSidebarOpen={initialSidebarOpen}
                dashboard={dashboard}
                profileData={profileData}
                dict={dict}
                uiDict={uiDict}
                locale={locale}
                switcherSlot={portfolioSwitcher}
                quickSearchItems={quickSearchItems}
                unreadCount={notificationData.unreadCount}
                notifications={notificationData.notifications}
                notificationDropdownOpen={notificationDropdownOpen}
                onNotificationOpenChange={setNotificationDropdownOpen}
                markRead={notificationData.markRead}
                markAllRead={notificationData.markAllRead}
                dismiss={notificationData.dismiss}
                contextMessage={contextMessage}
                globalError={globalError}
                transactionMessage={transactionSubmission.message}
                recomputeMessage={recomputeAction.message}
                snapshotMessage={snapshotGeneration.snapshotMessage}
                mutationsMessage={mutations.message}
                mutationsErrorMessage={mutations.errorMessage}
                onClearGlobalError={handleClearGlobalError}
                isClientReady={isClientReady}
                switcherLoaded={switcherLoaded}
                onTimeframesSaved={refetchEffectiveRanges}
                onReportingCurrencySaved={handleReportingCurrencySaved}
              >
                {children ?? null}
              </AppShellLayout>
            </NavigationFeedbackProvider>

            <CommandPalette
              open={commandPalette.open}
              onOpenChange={commandPalette.setOpen}
              initialQuery={commandPalette.initialQuery}
              dict={dict}
              onAddTransaction={handleAddTransactionFromPalette}
              onRecomputeAll={handleRecomputeFromPalette}
            />

            <AddTransactionDialog
              open={addTransactionDialogOpen}
              onOpenChange={setAddTransactionDialogOpen}
              value={transactionSubmission.draftTransaction}
              onChange={transactionSubmission.setDraftTransaction}
              onUnitPriceEdited={transactionSubmission.markUnitPriceEdited}
              onSubmit={async () => {
                const ok = await transactionSubmission.submit();
                if (ok) setAddTransactionDialogOpen(false);
              }}
              pending={transactionSubmission.isSubmitting}
              accountOptions={transactionAccountOptions}
              message={transactionSubmission.message}
              errorMessage={transactionSubmission.errorMessage}
              dict={dict}
              locale={locale}
              priceHint={transactionSubmission.priceHint}
              showPriceUnavailableHint={transactionSubmission.showPriceUnavailableHint}
              feeEstimate={transactionSubmission.feeEstimate}
            />

            <RecomputeConfirmDialog
              open={recomputeDialogOpen}
              onOpenChange={setRecomputeDialogOpen}
              onConfirm={handleRecomputeConfirm}
              dict={dict}
              pending={recomputeAction.isRunning}
            />

            {/* Phase 5e — floating ⨁ quick-actions Sheet. Dashboard-only
                surface; hidden in shared context (read-only). Reuses the
                same AddTransactionDialog + RecomputeConfirmDialog handlers
                already wired for the ⌘K palette. */}
            <FloatingQuickActions
              hidden={pathname !== "/dashboard" || isSharedContext}
              onAddTransaction={handleAddTransactionFromPalette}
              onRecompute={handleRecomputeFromPalette}
              onGenerateSnapshots={snapshotGeneration.generateSnapshots}
              isGeneratingSnapshots={snapshotGeneration.isGeneratingSnapshots}
            />
          </CommandPaletteProvider>
        </AppShellDataProvider>
      </BreadcrumbProvider>
    </div>
  );
}
