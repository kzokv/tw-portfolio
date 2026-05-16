"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type AccountDefaultCurrency,
  type DashboardPerformanceRange,
  type InstrumentOptionDto,
  type LocaleCode,
  type SnapshotsGeneratedEvent,
} from "@vakwen/shared-types";
import { getDictionary } from "../../lib/i18n";
import type { TransactionInput } from "../portfolio/types";
import { SettingsDrawer } from "../settings/SettingsDrawer";
import { Button } from "../ui/Button";
import { API_PUBLIC, postJson } from "../../lib/api";
import { SidebarInset, SidebarProvider } from "../ui/shadcn/sidebar";
import { TopBar, type QuickSearchItem } from "./TopBar";
import { AppSidebar } from "./AppSidebar";
import { BreadcrumbProvider } from "./BreadcrumbProvider";
import { IntegrityIssueDialog } from "../../features/dashboard/components/IntegrityIssueDialog";
import { useDashboardData } from "../../features/dashboard/hooks/useDashboardData";
import { useRecomputeAction } from "../../features/portfolio/hooks/useRecomputeAction";
import { useTransactionSubmission } from "../../features/portfolio/hooks/useTransactionSubmission";
import { useTransactionMutations } from "../../features/portfolio/hooks/useTransactionMutations";
import { useSettingsSave } from "../../features/settings/hooks/useSettingsSave";
import { renameAccount } from "../../features/settings/services/settingsService";
import { useProfile, type ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";
import { useNotifications } from "../../hooks/useNotifications";
import { fetchSharingPageData } from "../../features/sharing/service";
import {
  extractSharingNotificationDetail,
  isRevokedSharingNotification,
} from "../../lib/sharing-notification-matcher";
import type { InboundShareCardItem } from "../../features/sharing/types";
import { useEffectiveRanges } from "../../hooks/useEffectiveRanges";
import { PortfolioSwitcher } from "./PortfolioSwitcher";
import {
  CONTEXT_FALLBACK_REVOKED_EVENT,
  applyDeepLinkAs,
  clearContextCookie,
  writeContextCookie,
} from "../../lib/context";
import { useSharedContextOwnerId } from "../../hooks/useSharedContextOwnerId";
import { StatusToast } from "../ui/StatusToast";
import { ApiClientErrorToast } from "./ApiClientErrorToast";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { AppShellDataProvider, type AppShellData } from "./AppShellDataContext";
import { CardLayoutResetProvider } from "./CardLayoutResetContext";
import { cn } from "../../lib/utils";

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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isClientReady, setIsClientReady] = useState(false);
  const [performanceRange, setPerformanceRange] = useState<DashboardPerformanceRange>("1M");
  // KZO-161 (158C) / KZO-159 — Effective dashboard performance ranges.
  const { effectiveRanges, refetch: refetchEffectiveRanges } = useEffectiveRanges();
  // KZO-161 (158C) F5 / KZO-162 — Per-page remount counter map.
  const [cardLayoutResetCounts, setCardLayoutResetCounts] = useState<{
    dashboard: number;
    transactions: number;
    portfolio: number;
  }>({ dashboard: 0, transactions: 0, portfolio: 0 });
  // KZO-161 (158C) F4 — gear icon → customize-ranges popover open state.
  const [customizeRangesOpen, setCustomizeRangesOpen] = useState(false);
  const [inboundShares, setInboundShares] = useState<InboundShareCardItem[]>([]);
  const [switcherLoaded, setSwitcherLoaded] = useState(false);
  const [contextMessage, setContextMessage] = useState("");
  // Preserves §8 item 2 — deep-link guard for ?as=ownerId; ensures we only
  // apply the deep link once even if the effect's deps thrash during
  // router.refresh-driven re-renders.
  const deepLinkAppliedRef = useRef(false);
  const currentContextOwnerId = useSharedContextOwnerId();

  const dashboard = useDashboardData({ initialTransaction: DEFAULT_TRANSACTION });
  const profileData = useProfile(initialProfile);
  const impersonation = profileData.profile?.impersonation
    && profileData.profile.impersonation.active !== false
    ? profileData.profile.impersonation
    : null;

  const locale: LocaleCode = localeOverride ?? dashboard.settings?.locale ?? "en";
  const dict = useMemo(() => getDictionary(locale), [locale]);
  const currentSharedOwner = useMemo(
    () =>
      currentContextOwnerId
        ? inboundShares.find((item) => item.ownerUserId === currentContextOwnerId) ?? null
        : null,
    [currentContextOwnerId, inboundShares],
  );
  const isSharedContext = currentSharedOwner !== null;
  const currentSharedOwnerLabel = currentSharedOwner?.ownerDisplayName
    || currentSharedOwner?.ownerEmail
    || dict.switcher.self;
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

  const refreshSwitcherData = useCallback(async () => {
    try {
      const sharingData = await fetchSharingPageData();
      setInboundShares(sharingData.inbound.active);
    } catch {
      setInboundShares([]);
    } finally {
      setSwitcherLoaded(true);
    }
  }, []);

  const [contextRefreshSignal, setContextRefreshSignal] = useState(0);

  // Preserves §8 item 5 — router.refresh() after context changes.
  const refreshContextDependentData = useCallback(async () => {
    router.refresh();
    setContextRefreshSignal((n) => n + 1);
    await Promise.allSettled([
      dashboard.refresh(),
      profileData.refresh(),
      refreshSwitcherData(),
    ]);
  }, [dashboard, profileData, refreshSwitcherData, router]);

  useEffect(() => {
    void refreshSwitcherData();
  }, [refreshSwitcherData]);

  useEffect(() => {
    if (!switcherLoaded || !currentContextOwnerId) return;
    const stillActive = inboundShares.some((item) => item.ownerUserId === currentContextOwnerId);
    if (stillActive) return;
    clearContextCookie();
    setContextMessage(dict.switcher.revokedFallback);
    void refreshContextDependentData();
  }, [
    currentContextOwnerId,
    dict.switcher.revokedFallback,
    inboundShares,
    refreshContextDependentData,
    switcherLoaded,
  ]);

  // Preserves §8 item 2 — ?as=ownerId deep-link applied once.
  useEffect(() => {
    if (!switcherLoaded) return;
    if (deepLinkAppliedRef.current) return;
    const asOwnerId = searchParams.get("as");
    if (!asOwnerId) return;

    const ownerIds = inboundShares
      .map((item) => item.ownerUserId)
      .filter((value): value is string => Boolean(value));
    const appliedOwnerId = applyDeepLinkAs(searchParams, ownerIds);

    deepLinkAppliedRef.current = true;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("as");
    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    window.history.replaceState({}, "", nextUrl);

    if (appliedOwnerId) {
      setContextMessage("");
      void refreshContextDependentData();
    }
  }, [
    inboundShares,
    pathname,
    refreshContextDependentData,
    searchParams,
    switcherLoaded,
  ]);

  // Preserves §8 item 1 — CONTEXT_FALLBACK_REVOKED_EVENT window listener.
  useEffect(() => {
    function handleFallbackRevoked(): void {
      setContextMessage(dict.switcher.revokedFallback);
      void refreshContextDependentData();
    }
    window.addEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, handleFallbackRevoked);
    return () => {
      window.removeEventListener(CONTEXT_FALLBACK_REVOKED_EVENT, handleFallbackRevoked);
    };
  }, [dict.switcher.revokedFallback, refreshContextDependentData]);

  const refreshAfterTransaction = useCallback(async () => {
    await dashboard.refresh();
    setContextRefreshSignal((n) => n + 1);
  }, [dashboard]);

  const transactionSubmission = useTransactionSubmission({
    initialValue: DEFAULT_TRANSACTION,
    noAccountsMessage: dict.feedback.noAccounts,
    tickerRequiredMessage: dict.transactions.tickerRequired,
    successMessage: dict.feedback.transactionSubmitted,
    refresh: refreshAfterTransaction,
  });

  const refreshAfterRecompute = useCallback(async () => {
    await dashboard.refresh();
    setContextRefreshSignal((n) => n + 1);
  }, [dashboard]);

  const recomputeAction = useRecomputeAction({
    locale,
    fallbackConfirm: dict.recompute.fallbackConfirm,
    refresh: refreshAfterRecompute,
  });

  const [isGeneratingSnapshots, setIsGeneratingSnapshots] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState("");

  const handleSnapshotsGenerated = useCallback(
    (event: SnapshotsGeneratedEvent) => {
      setIsGeneratingSnapshots(false);
      if (event.status === "error") {
        setSnapshotMessage(
          dict.dashboardHome.snapshotsGenerationFailed.replace("{error}", event.error ?? ""),
        );
        return;
      }
      setSnapshotMessage(
        dict.dashboardHome.snapshotsGeneratedMessage
          .replace("{totalRows}", String(event.totalRows))
          .replace("{provisionalRows}", String(event.provisionalRows)),
      );
      setContextRefreshSignal((n) => n + 1);
    },
    [
      dict.dashboardHome.snapshotsGeneratedMessage,
      dict.dashboardHome.snapshotsGenerationFailed,
    ],
  );

  const generateSnapshots = useCallback(async () => {
    setIsGeneratingSnapshots(true);
    setSnapshotMessage("");
    try {
      await postJson("/portfolio/snapshots/generate", {});
    } catch {
      setIsGeneratingSnapshots(false);
      setSnapshotMessage("");
    }
  }, []);

  const mutations = useTransactionMutations({
    locale,
    dict,
    refresh: refreshAfterTransaction,
    onSnapshotsGenerated: handleSnapshotsGenerated,
  });

  const handleSharingNotification = useCallback(
    (notification: { title: string; detail: unknown }) => {
      void refreshSwitcherData();
      const detail = extractSharingNotificationDetail(notification.detail);
      const ownerUserId = detail?.ownerUserId ?? null;
      const ownerLabel = detail?.ownerDisplayName || detail?.ownerEmail || dict.switcher.self;
      if (
        isRevokedSharingNotification(notification)
        && ownerUserId
        && ownerUserId === currentContextOwnerId
      ) {
        clearContextCookie();
        setContextMessage(dict.switcher.revokedFallbackOwner.replace("{owner}", ownerLabel));
        void refreshContextDependentData();
      }
    },
    [currentContextOwnerId, dict.switcher, refreshContextDependentData, refreshSwitcherData],
  );
  // Preserves §8 item 11 — useNotifications stays here with `enabled: true`
  // (SSE pre-connect) per `react-useEventStream-preconnect-pattern.md`.
  const notificationData = useNotifications({ onSharingNotification: handleSharingNotification });
  const [notificationDropdownOpen, setNotificationDropdownOpen] = useState(false);

  const settingsSave = useSettingsSave({
    refresh: dashboard.refresh,
    closeDrawer: () => setDrawerOpen(false),
  });

  const transactionAccountOptions = useMemo(
    () =>
      dashboard.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        feeProfileName: dashboard.feeProfiles.find((profile) => profile.id === account.feeProfileId)?.name ?? "",
        defaultCurrency: account.defaultCurrency,
        accountType: account.accountType,
      })),
    [dashboard.accounts, dashboard.feeProfiles],
  );
  const handleRenameAccount = useCallback(async (accountId: string, name: string) => {
    await renameAccount(accountId, name);
    await dashboard.refresh();
  }, [dashboard]);

  const isI18nReady = !!dashboard.settings || !!localeOverride;

  const drawerOpen = searchParams.get("drawer") === "settings";

  const settingsTabParam = searchParams.get("settingsTab");
  const settingsInitialTab =
    settingsTabParam === "profile" ||
    settingsTabParam === "general" ||
    settingsTabParam === "accounts" ||
    settingsTabParam === "tickers" ||
    settingsTabParam === "display"
      ? settingsTabParam
      : undefined;
  const accountsPrefillCurrencyParam = searchParams.get("accountsPrefillCurrency");
  const accountsPrefillCurrency: AccountDefaultCurrency | undefined =
    accountsPrefillCurrencyParam === "TWD" ||
    accountsPrefillCurrencyParam === "USD" ||
    accountsPrefillCurrencyParam === "AUD"
      ? accountsPrefillCurrencyParam
      : undefined;

  const setDrawerOpen = useCallback(
    (open: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (open) {
        params.set("drawer", "settings");
      } else {
        params.delete("drawer");
        params.delete("settingsTab");
        params.delete("accountsPrefillCurrency");
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    transactionSubmission.setDraftTransaction((previous) => dashboard.synchronizeTransactionDraft(previous));
  }, [dashboard.synchronizeTransactionDraft, transactionSubmission.setDraftTransaction]);

  const globalError = transactionSubmission.errorMessage || recomputeAction.errorMessage || dashboard.errorMessage;
  const transactionMessage = transactionSubmission.message;
  const recomputeMessage = recomputeAction.message;

  const navigationItems = useMemo(
    () => [
      { id: "dashboard", href: "/dashboard", label: dict.navigation.dashboardLabel, description: dict.navigation.dashboardDescription },
      { id: "portfolio", href: "/portfolio", label: dict.navigation.portfolioLabel, description: dict.navigation.portfolioDescription },
      { id: "transactions", href: "/transactions", label: dict.navigation.transactionsLabel, description: dict.navigation.transactionsDescription },
      { id: "dividends", href: "/dividends", label: dict.navigation.dividendsLabel, description: dict.navigation.dividendsDescription },
      { id: "cash-ledger", href: "/cash-ledger", label: dict.navigation.cashLedgerLabel, description: dict.navigation.cashLedgerDescription },
    ],
    [dict],
  );

  const quickSearchItems = useMemo<QuickSearchItem[]>(
    () => [
      ...navigationItems.map((item) => ({
        id: item.id,
        kind: "route" as const,
        label: item.label,
        description: item.description,
        href: item.href,
        keywords: [item.id, item.label, item.description],
      })),
      ...dashboard.instruments.map((symbol) => ({
        id: `${symbol.marketCode ?? "na"}-${symbol.ticker.toLowerCase()}`,
        kind: "symbol" as const,
        label: symbol.ticker,
        description: buildInstrumentSearchDescription(symbol),
        href: `/tickers/${encodeURIComponent(symbol.ticker)}`,
        keywords: [symbol.instrumentType, symbol.marketCode ?? "", symbol.ticker],
      })),
    ],
    [dashboard.instruments, navigationItems],
  );

  const handleContextSelect = useCallback((ownerUserId: string | null) => {
    setContextMessage("");
    if (ownerUserId) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      writeContextCookie(ownerUserId);
    } else {
      clearContextCookie();
    }
    void refreshContextDependentData();
  }, [refreshContextDependentData]);

  const appShellDataValue: AppShellData = useMemo(
    () => ({
      dashboard,
      uiDict,
      locale,
      isSharedContext,
      isBootstrapping: dashboard.isBootstrapping,
      isI18nReady,
      transactionSubmission,
      mutations,
      recomputeAction,
      transactionAccountOptions,
      performanceRange,
      setPerformanceRange,
      effectiveRanges,
      refetchEffectiveRanges,
      customizeRangesOpen,
      setCustomizeRangesOpen,
      generateSnapshots,
      isGeneratingSnapshots,
      setDrawerOpen,
      contextRefreshSignal,
    }),
    [
      contextRefreshSignal,
      customizeRangesOpen,
      dashboard,
      effectiveRanges,
      generateSnapshots,
      isGeneratingSnapshots,
      isI18nReady,
      isSharedContext,
      locale,
      mutations,
      performanceRange,
      recomputeAction,
      refetchEffectiveRanges,
      setDrawerOpen,
      transactionAccountOptions,
      transactionSubmission,
      uiDict,
    ],
  );

  const portfolioSwitcher = (
    <PortfolioSwitcher
      inboundActive={inboundShares}
      currentContextOwnerId={currentContextOwnerId}
      onSelect={handleContextSelect}
      dict={uiDict.switcher}
    />
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
        <SidebarProvider defaultOpen={initialSidebarOpen}>
          <AppSidebar
            variant="user"
            role={profileData.profile?.role}
            onOpenSettings={() => setDrawerOpen(true)}
            productName={uiDict.topBar.productName}
            switcherSlot={inboundShares.length > 0 ? portfolioSwitcher : null}
          />

          <SidebarInset className="relative min-w-0 max-w-full overflow-x-hidden">
            <TopBar
              userId={dashboard.settings?.userId}
              displayName={profileData.profile?.displayName}
              pictureUrl={profileData.profile?.providerPictureUrl}
              email={profileData.profile?.email}
              role={profileData.profile?.role}
              onOpenProfile={() => setDrawerOpen(true)}
              signOutHref={`${API_PUBLIC}/auth/logout`}
              searchPlaceholder={uiDict.topBar.searchPlaceholder}
              searchLabel={uiDict.topBar.searchLabel}
              searchEmptyLabel={uiDict.topBar.searchEmptyLabel}
              searchRoutesLabel={uiDict.topBar.searchRoutesLabel}
              searchTickersLabel={uiDict.topBar.searchTickersLabel}
              openSearchLabel={uiDict.topBar.openSearchLabel}
              closeSearchLabel={uiDict.topBar.closeSearchLabel}
              searchItems={quickSearchItems}
              unreadCount={notificationData.unreadCount}
              notifications={notificationData.notifications}
              notificationDropdownOpen={notificationDropdownOpen}
              onNotificationOpenChange={setNotificationDropdownOpen}
              onNotificationMarkRead={(id) => { void notificationData.markRead(id); }}
              onNotificationMarkAllRead={() => { void notificationData.markAllRead(); }}
              onNotificationDismiss={(id) => { void notificationData.dismiss(id); }}
              notificationDict={uiDict}
            />

            <main className="min-w-0 max-w-full flex-1 overflow-x-hidden px-4 py-6 md:px-6 md:py-8" data-testid="shell-main">
              {/* Preserves §8 item 7 — ApiClientErrorToast inside SidebarInset main. */}
              <ApiClientErrorToast />
              {/* Preserves §8 item 8 — StatusToast inside SidebarInset main. */}
              <StatusToast message={contextMessage} variant="success" testId="context-status" />

              {globalError ? (
                <div
                  className="mb-5 rounded-[22px] border border-[rgba(251,113,133,0.28)] bg-[rgba(254,226,226,0.9)] px-4 py-3 text-sm text-rose-700 shadow-[0_18px_36px_rgba(251,113,133,0.12)]"
                  role="status"
                  aria-live="polite"
                  data-testid="global-error-banner"
                >
                  <p>{dict.feedback.requestFailedPrefix}: {globalError}</p>
                  <div className="mt-2 flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        dashboard.setErrorMessage("");
                        transactionSubmission.setErrorMessage("");
                        recomputeAction.setErrorMessage("");
                        void (async () => {
                          await dashboard.refresh();
                          setContextRefreshSignal((n) => n + 1);
                        })().catch(() => undefined);
                      }}
                    >
                      {dict.actions.retry}
                    </Button>
                  </div>
                </div>
              ) : null}

              {!globalError && transactionMessage ? (
                <p
                  className="mb-5 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700"
                  data-testid="transaction-status"
                  role="status"
                  aria-live="polite"
                >
                  {transactionMessage}
                </p>
              ) : null}

              {!globalError && (mutations.message || mutations.errorMessage) ? (
                <p
                  className={cn(
                    "mb-5 rounded-[22px] border px-4 py-3 text-sm",
                    mutations.errorMessage
                      ? "border-[rgba(251,113,133,0.28)] bg-[rgba(254,226,226,0.9)] text-rose-700"
                      : "border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] text-emerald-700",
                  )}
                  data-testid="mutation-status"
                  role="status"
                  aria-live="polite"
                >
                  {mutations.errorMessage || mutations.message}
                </p>
              ) : null}

              {!globalError && !transactionMessage && recomputeMessage ? (
                <p
                  className="mb-5 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700"
                  data-testid="recompute-status"
                  role="status"
                  aria-live="polite"
                >
                  {recomputeMessage}
                </p>
              ) : null}

              {!globalError && snapshotMessage ? (
                <p
                  className="mb-5 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700"
                  data-testid="snapshot-status"
                  role="status"
                  aria-live="polite"
                >
                  {snapshotMessage}
                </p>
              ) : null}

              <div data-testid="app-shell-ready" />
              {isClientReady ? <div data-testid="app-shell-client-ready" /> : null}
              {switcherLoaded ? <div data-testid="switcher-data-ready" /> : null}

              <CardLayoutResetProvider value={cardLayoutResetCounts}>
                {children ?? null}
              </CardLayoutResetProvider>
            </main>
          </SidebarInset>
        </SidebarProvider>
        </AppShellDataProvider>
      </BreadcrumbProvider>

      <IntegrityIssueDialog
        issue={dashboard.actions.integrityIssue}
        open={dashboard.showIntegrityDialog}
        onOpenChange={dashboard.setShowIntegrityDialog}
        onOpenSettings={() => setDrawerOpen(true)}
        dict={uiDict}
      />

      <SettingsDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        settings={dashboard.settings}
        accounts={dashboard.accounts}
        feeProfiles={dashboard.feeProfiles}
        feeProfileBindings={dashboard.feeProfileBindings}
        profile={profileData.profile}
        onProfileUpdate={profileData.refresh}
        onAccountsRefresh={dashboard.refresh}
        isSaving={settingsSave.isSaving}
        errorMessage={settingsSave.errorMessage}
        onSave={settingsSave.save}
        onRenameAccount={handleRenameAccount}
        dict={uiDict}
        onTimeframesSaved={refetchEffectiveRanges}
        onLayoutReset={() =>
          setCardLayoutResetCounts((counts) => ({
            dashboard: counts.dashboard + 1,
            transactions: counts.transactions + 1,
            portfolio: counts.portfolio + 1,
          }))
        }
        onPageLayoutReset={(page) =>
          setCardLayoutResetCounts((counts) => ({
            ...counts,
            [page]: counts[page] + 1,
          }))
        }
        onReportingCurrencySaved={() => {
          void dashboard.refresh();
          setContextRefreshSignal((n) => n + 1);
        }}
        initialTab={settingsInitialTab}
        accountsPrefillCurrency={accountsPrefillCurrency}
      />
    </div>
  );
}

function buildInstrumentSearchDescription(symbol: InstrumentOptionDto): string {
  const instrument = symbol.instrumentType === "BOND_ETF"
    ? "Bond ETF"
    : symbol.instrumentType === "ETF"
      ? "ETF"
      : "Stock";
  return symbol.marketCode ? `${instrument} / ${symbol.marketCode}` : instrument;
}
