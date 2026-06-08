"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { type LocaleCode, type ShellPortfolioConfigDto } from "@vakwen/shared-types";
import { getDictionary } from "../../lib/i18n";
import type { TransactionInput } from "../portfolio/types";
import { AppShellLayout } from "./AppShellLayout";
import { BreadcrumbProvider } from "./BreadcrumbProvider";
import { useRecomputeAction } from "../../features/portfolio/hooks/useRecomputeAction";
import { useTransactionSubmission } from "../../features/portfolio/hooks/useTransactionSubmission";
import { useTransactionMutations } from "../../features/portfolio/hooks/useTransactionMutations";
import { useProfile, type ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";
import { useNotifications } from "../../hooks/useNotifications";
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
import { useShellPortfolioConfig } from "./useShellPortfolioConfig";
import { useShellInstrumentIndex } from "./useShellInstrumentIndex";
import { clearRouteDtoCacheByPrefix, getRouteDtoCachePrefix } from "../../lib/routeDtoCache";

type AppSection = "dashboard" | "reports" | "portfolio" | "transactions" | "dividends" | "cash-ledger";

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
  initialPortfolioConfig?: ShellPortfolioConfigDto | null;
  portfolioConfigMode?: "eager" | "lazy";
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
  initialPortfolioConfig = null,
  portfolioConfigMode = "eager",
  initialSidebarOpen = true,
  children,
}: AppShellProps) {
  const [isClientReady, setIsClientReady] = useState(false);
  const portfolioConfig = useShellPortfolioConfig({
    initialTransaction: DEFAULT_TRANSACTION,
    initialConfig: initialPortfolioConfig,
    fetchMode: portfolioConfigMode,
  });
  const profileData = useProfile(initialProfile);
  const sessionUserId = profileData.profile?.userId ?? initialProfile?.userId ?? null;
  const impersonation = profileData.profile?.impersonation
    && profileData.profile.impersonation.active !== false
    ? profileData.profile.impersonation
    : null;

  const locale: LocaleCode = localeOverride ?? "en";
  const dict = useMemo(() => getDictionary(locale), [locale]);

  const sharedContext = useSharedContext({
    refreshDashboard: portfolioConfig.refresh,
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

  // Preserves §8 item 4 — shared-context dictionary remapping for empty
  // portfolio / empty transactions copy.
  const uiDict = useMemo(() => {
    if (!isSharedContext) return dict;
    return {
      ...dict,
      dashboardHome: {
        ...dict.dashboardHome,
        holdingsEmpty: dict.switcher.sharedHoldingsEmpty.replace("{owner}", currentSharedOwnerLabel),
      },
      transactions: {
        ...dict.transactions,
        recentLedgerEmpty: dict.switcher.sharedTransactionsEmpty.replace("{owner}", currentSharedOwnerLabel),
      },
    };
  }, [currentSharedOwnerLabel, dict, isSharedContext]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  const refreshAfterTransaction = useCallback(async () => {
    clearRouteDtoCacheByPrefix(getRouteDtoCachePrefix());
    await portfolioConfig.refresh();
    bumpContextRefreshSignal();
  }, [bumpContextRefreshSignal, portfolioConfig]);

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
      portfolioConfig.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        feeProfileName:
          portfolioConfig.feeProfiles.find((profile) => profile.id === account.feeProfileId)?.name ?? "",
        defaultCurrency: account.defaultCurrency,
        accountType: account.accountType,
      })),
    [portfolioConfig.accounts, portfolioConfig.feeProfiles],
  );

  useEffect(() => {
    transactionSubmission.setDraftTransaction((previous) => portfolioConfig.synchronizeTransactionDraft(previous));
  }, [portfolioConfig.synchronizeTransactionDraft, transactionSubmission.setDraftTransaction]);

  const globalError = transactionSubmission.errorMessage || recomputeAction.errorMessage || portfolioConfig.errorMessage;

  const shellInstruments = useShellInstrumentIndex(contextRefreshSignal);
  const { quickSearchItems } = useAppNavigation(dict, shellInstruments);

  const handleClearGlobalError = useCallback(() => {
    portfolioConfig.setErrorMessage("");
    transactionSubmission.setErrorMessage("");
    recomputeAction.setErrorMessage("");
    void (async () => {
      await portfolioConfig.refresh();
      bumpContextRefreshSignal();
    })().catch(() => undefined);
  }, [bumpContextRefreshSignal, portfolioConfig, recomputeAction, transactionSubmission]);

  const handleReportingCurrencySaved = useCallback(() => {
    clearRouteDtoCacheByPrefix(getRouteDtoCachePrefix());
    bumpContextRefreshSignal();
  }, [bumpContextRefreshSignal]);

  const previousSessionUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (previousSessionUserIdRef.current === undefined) {
      previousSessionUserIdRef.current = sessionUserId;
      return;
    }
    if (sessionUserId !== null && previousSessionUserIdRef.current !== sessionUserId) {
      clearRouteDtoCacheByPrefix(getRouteDtoCachePrefix());
    }
    previousSessionUserIdRef.current = sessionUserId;
  }, [sessionUserId]);

  // Phase 3e — global ⌘K palette state + AlertDialog state for `recompute.all`.
  const commandPalette = useCommandPalette();
  const [addTransactionDialogOpen, setAddTransactionDialogOpen] = useState(false);
  const [recomputeDialogOpen, setRecomputeDialogOpen] = useState(false);

  const handleAddTransactionFromPalette = useCallback(() => {
    void (async () => {
      await portfolioConfig.ensureLoaded();
      setAddTransactionDialogOpen(true);
    })().catch(() => undefined);
  }, [portfolioConfig]);

  const handleRecomputeFromPalette = useCallback(() => {
    void (async () => {
      await portfolioConfig.ensureLoaded();
      setRecomputeDialogOpen(true);
    })().catch(() => undefined);
  }, [portfolioConfig]);

  const appShellDataValue = useAppShellDataValue({
    uiDict,
    locale,
    sessionUserId,
    isSharedContext,
    transactionSubmission,
    mutations,
    recomputeAction,
    openRecomputeConfirm: handleRecomputeFromPalette,
    transactionAccountOptions,
    accounts: portfolioConfig.accounts,
    feeProfiles: portfolioConfig.feeProfiles,
    feeProfileBindings: portfolioConfig.feeProfileBindings,
    refreshPortfolioConfig: portfolioConfig.refresh,
    isPortfolioConfigLoading: portfolioConfig.isLoading,
    integrityIssue: portfolioConfig.integrityIssue,
    showIntegrityDialog: portfolioConfig.showIntegrityDialog,
    setShowIntegrityDialog: portfolioConfig.setShowIntegrityDialog,
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
          {dict.feedback.demoSession}
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
                profileData={profileData}
                integrityIssue={portfolioConfig.integrityIssue}
                showIntegrityDialog={portfolioConfig.showIntegrityDialog}
                setShowIntegrityDialog={portfolioConfig.setShowIntegrityDialog}
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
                onTimeframesSaved={() => undefined}
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
