"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  DashboardPerformanceRange,
  InstrumentOptionDto,
  LocaleCode,
  SnapshotsGeneratedEvent,
} from "@tw-portfolio/shared-types";
import { getDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { AddTransactionCard } from "../portfolio/AddTransactionCard";
import { HoldingsTable } from "../portfolio/HoldingsTable";
import type { TransactionInput } from "../portfolio/types";
import { SettingsDrawer } from "../settings/SettingsDrawer";
import { DashboardLoading } from "../dashboard/DashboardLoading";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { API_PUBLIC, postJson } from "../../lib/api";
import { TopBar, type QuickSearchItem } from "./TopBar";
import { SideNavigation } from "./SideNavigation";
import { IntegrityIssueDialog } from "../../features/dashboard/components/IntegrityIssueDialog";
import { useDashboardData } from "../../features/dashboard/hooks/useDashboardData";
import { useDashboardPerformance } from "../../features/dashboard/hooks/useDashboardPerformance";
import { useRecomputeAction } from "../../features/portfolio/hooks/useRecomputeAction";
import { useRecentTransactions } from "../../features/portfolio/hooks/useRecentTransactions";
import { useTransactionSubmission } from "../../features/portfolio/hooks/useTransactionSubmission";
import { useTransactionMutations } from "../../features/portfolio/hooks/useTransactionMutations";
import { useSettingsSave } from "../../features/settings/hooks/useSettingsSave";
import { useProfile } from "../../features/profile/hooks/useProfile";
import { useNotifications } from "../../hooks/useNotifications";
import { fetchSharingPageData } from "../../features/sharing/service";
import type { InboundShareCardItem } from "../../features/sharing/types";
import { DividendsSection } from "../dashboard/DividendsSection";
import { ActionCenterSection } from "../dashboard/ActionCenterSection";
import { AllocationSnapshotCard } from "../dashboard/AllocationSnapshotCard";
import { PortfolioTrendCard } from "../dashboard/PortfolioTrendCard";
import { ReturnPercentCard } from "../dashboard/ReturnPercentCard";
import { RecentTransactionsCard } from "../dashboard/RecentTransactionsCard";
import { PortfolioSwitcher } from "./PortfolioSwitcher";
import {
  CONTEXT_FALLBACK_REVOKED_EVENT,
  applyDeepLinkAs,
  clearContextCookie,
  writeContextCookie,
} from "../../lib/context";
import { useSharedContextOwnerId } from "../../hooks/useSharedContextOwnerId";
import { StatusToast } from "../ui/StatusToast";

type AppSection = "dashboard" | "portfolio" | "transactions" | "dividends" | "cash-ledger";
type ViewportMode = "mobile" | "compact" | "wide";

interface AppShellProps {
  section?: AppSection;
  isDemo?: boolean;
  localeOverride?: LocaleCode;
  titleOverride?: string;
  descriptionOverride?: string;
  activeSectionOverride?: AppSection | null;
  children?: React.ReactNode;
}

interface NavigationItem {
  id: AppSection;
  href: string;
  label: string;
  description: string;
}

const DESKTOP_NAV_STORAGE_KEY = "tw-shell-nav-collapsed";
const DEFAULT_TRANSACTION: TransactionInput = {
  accountId: "",
  ticker: "",
  quantity: 1000,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: new Date().toISOString().slice(0, 10),
  type: "BUY",
  isDayTrade: false,
};

export function AppShell({
  section = "dashboard",
  isDemo = false,
  localeOverride,
  titleOverride,
  descriptionOverride,
  activeSectionOverride,
  children,
}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isClientReady, setIsClientReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [viewportMode, setViewportMode] = useState<ViewportMode>("wide");
  const [desktopNavPreference, setDesktopNavPreference] = useState<boolean | null>(null);
  const [performanceRange, setPerformanceRange] = useState<DashboardPerformanceRange>("1M");
  const [inboundShares, setInboundShares] = useState<InboundShareCardItem[]>([]);
  const [switcherLoaded, setSwitcherLoaded] = useState(false);
  const [contextMessage, setContextMessage] = useState("");
  // Guards the deep-link effect: once we apply ?as=X the first time, don't
  // re-apply even if the effect's dependencies thrash during the refresh
  // cascade (router.refresh → re-render → stable callback identity change).
  // Without this guard, the deep-link effect can race with React's hook
  // tracking under Next's Suspense + router.refresh combo and manifest as
  // "Rendered more hooks than during the previous render."
  const deepLinkAppliedRef = useRef(false);
  const currentContextOwnerId = useSharedContextOwnerId();

  const dashboard = useDashboardData({ initialTransaction: DEFAULT_TRANSACTION });
  const performance = useDashboardPerformance({
    range: performanceRange,
    enabled: section === "dashboard",
  });
  const recentTransactions = useRecentTransactions({
    limit: 6,
    enabled: section === "transactions",
  });
  const profileData = useProfile();

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
  // Only override the truly-empty-portfolio copy. Deliberately does NOT fire
  // for filter-empty states (e.g. search matched 0 holdings), which share the
  // same dict key but mean something different. Guarding on a zero-length
  // portfolio keeps the owner-facing copy scoped to the empty-owner case.
  const hasOwnerEmptyPortfolio = isSharedContext && dashboard.holdings.length === 0;
  const hasOwnerEmptyRecentTransactions = isSharedContext && recentTransactions.items.length === 0;
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
      transactions: hasOwnerEmptyRecentTransactions
        ? {
          ...dict.transactions,
          recentLedgerEmpty: dict.switcher.sharedTransactionsEmpty.replace("{owner}", currentSharedOwnerLabel),
        }
        : dict.transactions,
    };
  }, [
    currentSharedOwnerLabel,
    dict,
    hasOwnerEmptyPortfolio,
    hasOwnerEmptyRecentTransactions,
    isSharedContext,
  ]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

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

  const refreshContextDependentData = useCallback(async () => {
    router.refresh();
    await Promise.allSettled([
      dashboard.refresh(),
      profileData.refresh(),
      refreshSwitcherData(),
      section === "dashboard" ? performance.refresh() : Promise.resolve(),
      section === "transactions" ? recentTransactions.refresh() : Promise.resolve(),
    ]);
  }, [
    dashboard,
    performance,
    profileData,
    recentTransactions,
    refreshSwitcherData,
    router,
    section,
  ]);

  useEffect(() => {
    void refreshSwitcherData();
  }, [refreshSwitcherData]);

  useEffect(() => {
    if (!switcherLoaded || !currentContextOwnerId) return;
    const stillActive = inboundShares.some((item) => item.ownerUserId === currentContextOwnerId);
    if (stillActive) return;
    // clearContextCookie() internally dispatches CONTEXT_CHANGED_EVENT, which
    // drives useSharedContextOwnerId → setOwnerUserId(null). This effect
    // relies on that internal dispatch to sync the switcher UI. Removing that
    // dispatch would silently break this fallback path.
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

  useEffect(() => {
    function resolveViewportMode(width: number): ViewportMode {
      if (width < 1024) return "mobile";
      if (width < 1280) return "compact";
      return "wide";
    }

    function updateViewport() {
      setViewportMode(resolveViewportMode(window.innerWidth));
    }

    updateViewport();
    const storedPreference = window.localStorage.getItem(DESKTOP_NAV_STORAGE_KEY);
    if (storedPreference === "true") setDesktopNavPreference(true);
    if (storedPreference === "false") setDesktopNavPreference(false);

    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const desktopNavigationCollapsed = viewportMode === "mobile"
    ? false
    : desktopNavPreference ?? viewportMode === "compact";

  const refreshAfterTransaction = useCallback(async () => {
    await dashboard.refresh();
    if (section === "transactions") {
      await recentTransactions.refresh();
    }
    // KZO-115: trade mutations trigger a scoped snapshot recompute inside
    // scheduleReplayWithRetry; refresh the performance chart when we're on
    // the dashboard so the chart reflects the new snapshots without the user
    // having to navigate away and back.
    if (section === "dashboard") {
      await performance.refresh();
    }
  }, [dashboard.refresh, performance.refresh, recentTransactions.refresh, section]);

  const transactionSubmission = useTransactionSubmission({
    initialValue: DEFAULT_TRANSACTION,
    noAccountsMessage: dict.feedback.noAccounts,
    tickerRequiredMessage: dict.transactions.tickerRequired,
    successMessage: dict.feedback.transactionSubmitted,
    refresh: refreshAfterTransaction,
  });

  const refreshAfterRecompute = useCallback(async () => {
    await dashboard.refresh();
    if (section === "dashboard") {
      await performance.refresh();
    }
  }, [dashboard.refresh, performance.refresh, section]);

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
          dict.dashboardHome.snapshotsGenerationFailed.replace(
            "{error}",
            event.error ?? "",
          ),
        );
        return;
      }
      setSnapshotMessage(
        dict.dashboardHome.snapshotsGeneratedMessage
          .replace("{totalRows}", String(event.totalRows))
          .replace("{provisionalRows}", String(event.provisionalRows)),
      );
      void performance.refresh();
    },
    [
      dict.dashboardHome.snapshotsGeneratedMessage,
      dict.dashboardHome.snapshotsGenerationFailed,
      performance.refresh,
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

      const detail = notification.detail as {
        ownerUserId?: string;
        ownerDisplayName?: string | null;
        ownerEmail?: string | null;
      } | null;
      const ownerUserId = typeof detail?.ownerUserId === "string" ? detail.ownerUserId : null;
      const ownerLabel = detail?.ownerDisplayName || detail?.ownerEmail || dict.switcher.self;

      if (notification.title === "Portfolio access revoked" && ownerUserId && ownerUserId === currentContextOwnerId) {
        clearContextCookie();
        setContextMessage(
          dict.switcher.revokedFallbackOwner.replace("{owner}", ownerLabel),
        );
        void refreshContextDependentData();
      }
    },
    [
      currentContextOwnerId,
      dict.switcher,
      refreshContextDependentData,
      refreshSwitcherData,
    ],
  );
  const notificationData = useNotifications({ onSharingNotification: handleSharingNotification });
  const [notificationDropdownOpen, setNotificationDropdownOpen] = useState(false);

  const settingsSave = useSettingsSave({
    refresh: dashboard.refresh,
    closeDrawer: () => setDrawerOpen(false),
  });

  const isI18nReady = !!dashboard.settings || !!localeOverride;
  const hasCustomChildren = children !== undefined;
  const showPageSkeleton = !hasCustomChildren && (dashboard.isBootstrapping || !isI18nReady);

  const drawerOpen = searchParams.get("drawer") === "settings";

  const setDrawerOpen = useCallback(
    (open: boolean) => {
      const params = new URLSearchParams(searchParams.toString());
      if (open) params.set("drawer", "settings");
      else params.delete("drawer");

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

  const navigationItems = useMemo<NavigationItem[]>(
    () => [
      {
        id: "dashboard",
        href: "/dashboard",
        label: dict.navigation.dashboardLabel,
        description: dict.navigation.dashboardDescription,
      },
      {
        id: "portfolio",
        href: "/portfolio",
        label: dict.navigation.portfolioLabel,
        description: dict.navigation.portfolioDescription,
      },
      {
        id: "transactions",
        href: "/transactions",
        label: dict.navigation.transactionsLabel,
        description: dict.navigation.transactionsDescription,
      },
      {
        id: "dividends",
        href: "/dividends",
        label: dict.navigation.dividendsLabel,
        description: dict.navigation.dividendsDescription,
      },
      {
        id: "cash-ledger",
        href: "/cash-ledger",
        label: dict.navigation.cashLedgerLabel,
        description: dict.navigation.cashLedgerDescription,
      },
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

  const derivedShellTitle = section === "dashboard"
    ? uiDict.navigation.dashboardLabel
    : section === "portfolio"
      ? uiDict.navigation.portfolioLabel
      : section === "transactions"
        ? uiDict.navigation.transactionsLabel
        : section === "cash-ledger"
          ? uiDict.navigation.cashLedgerLabel
          : uiDict.navigation.dividendsLabel;
  const derivedShellDescription = section === "dashboard"
    ? uiDict.navigation.dashboardDescription
    : section === "portfolio"
      ? uiDict.navigation.portfolioDescription
      : section === "transactions"
        ? uiDict.navigation.transactionsDescription
        : section === "cash-ledger"
          ? uiDict.navigation.cashLedgerDescription
          : uiDict.navigation.dividendsDescription;

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

  function toggleDesktopNavigation() {
    if (viewportMode === "mobile") return;
    const nextValue = !desktopNavigationCollapsed;
    setDesktopNavPreference(nextValue);
    window.localStorage.setItem(DESKTOP_NAV_STORAGE_KEY, String(nextValue));
  }

  return (
    <div className="app-shell relative min-h-screen min-w-0 overflow-x-clip">
      {isDemo && (
        <div
          className="flex h-8 items-center justify-center bg-amber-100 text-xs font-medium text-amber-800"
          data-testid="demo-banner"
        >
          You&apos;re using a demo session.
        </div>
      )}
      <TopBar
        userId={dashboard.settings?.userId}
        displayName={profileData.profile?.displayName}
        pictureUrl={profileData.profile?.providerPictureUrl}
        email={profileData.profile?.email}
        role={profileData.profile?.role}
        isDemo={isDemo}
        onOpenSettings={() => setDrawerOpen(true)}
        onToggleNavigation={() => setMobileNavOpen((current) => !current)}
        onToggleDesktopNavigation={toggleDesktopNavigation}
        navigationOpen={mobileNavOpen}
        desktopNavigationCollapsed={desktopNavigationCollapsed}
        productName={uiDict.topBar.productName}
        title={titleOverride ?? derivedShellTitle}
        titleTooltip={descriptionOverride ?? derivedShellDescription}
        openSettingsLabel={uiDict.topBar.openSettingsLabel}
        sharingLabel={uiDict.topBar.sharingLabel}
        signOutLabel="Sign out"
        signOutHref={`${API_PUBLIC}/auth/logout`}
        searchPlaceholder={uiDict.topBar.searchPlaceholder}
        searchLabel={uiDict.topBar.searchLabel}
        searchEmptyLabel={uiDict.topBar.searchEmptyLabel}
        searchRoutesLabel={uiDict.topBar.searchRoutesLabel}
        searchTickersLabel={uiDict.topBar.searchTickersLabel}
        openSearchLabel={uiDict.topBar.openSearchLabel}
        closeSearchLabel={uiDict.topBar.closeSearchLabel}
        openNavigationLabel={uiDict.topBar.openNavigationLabel}
        closeNavigationLabel={uiDict.topBar.closeNavigationLabel}
        expandSidebarLabel={uiDict.topBar.expandSidebarLabel}
        collapseSidebarLabel={uiDict.topBar.collapseSidebarLabel}
        searchItems={quickSearchItems}
        unreadCount={notificationData.unreadCount}
        notifications={notificationData.notifications}
        notificationDropdownOpen={notificationDropdownOpen}
        onNotificationBellClick={() => setNotificationDropdownOpen((prev) => !prev)}
        onNotificationMarkRead={(id) => { void notificationData.markRead(id); }}
        onNotificationMarkAllRead={() => { void notificationData.markAllRead(); }}
        onNotificationDismiss={(id) => { void notificationData.dismiss(id); }}
        onNotificationDropdownClose={() => setNotificationDropdownOpen(false)}
        notificationDict={uiDict}
        portfolioSwitcher={
          <PortfolioSwitcher
            inboundActive={inboundShares}
            currentContextOwnerId={currentContextOwnerId}
            onSelect={handleContextSelect}
            dict={uiDict.switcher}
          />
        }
      />

      <div
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/38 transition-opacity lg:hidden",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
        onClick={() => setMobileNavOpen(false)}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-[min(21rem,calc(100%-1.5rem))] p-3 transition-transform duration-200 lg:hidden",
          mobileNavOpen ? "translate-x-0" : "-translate-x-[110%]",
        )}
      >
        <SideNavigation
              items={navigationItems}
              activeSection={activeSectionOverride ?? section}
              eyebrow={dict.topBar.productName}
              title={titleOverride ?? derivedShellTitle}
              description={descriptionOverride ?? derivedShellDescription}
              mobile
          onNavigate={() => setMobileNavOpen(false)}
        />
      </aside>

      <div className="relative mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8 md:py-8 xl:px-10 xl:py-10">
        <div
          className="grid items-start gap-6 lg:grid-cols-[var(--desktop-sidebar-width)_minmax(0,1fr)] xl:gap-8"
          style={{ ["--desktop-sidebar-width" as string]: desktopNavigationCollapsed ? "5.75rem" : "18.75rem" }}
        >
          <div className="hidden lg:block">
            <SideNavigation
              items={navigationItems}
              activeSection={activeSectionOverride ?? section}
              eyebrow={dict.topBar.productName}
              title={titleOverride ?? derivedShellTitle}
              description={descriptionOverride ?? derivedShellDescription}
              collapsed={desktopNavigationCollapsed}
            />
          </div>

          <main className="min-w-0" data-testid="shell-main">
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
                        if (section === "dashboard") {
                          await performance.refresh();
                        }
                        if (section === "transactions") {
                          await recentTransactions.refresh();
                        }
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
                className="mb-5 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700 shadow-[0_18px_36px_rgba(52,211,153,0.1)]"
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
                  "mb-5 rounded-[22px] border px-4 py-3 text-sm shadow-[0_18px_36px_rgba(52,211,153,0.1)]",
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
                className="mb-5 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700 shadow-[0_18px_36px_rgba(52,211,153,0.1)]"
                data-testid="recompute-status"
                role="status"
                aria-live="polite"
              >
                {recomputeMessage}
              </p>
            ) : null}

            {!globalError && snapshotMessage ? (
              <p
                className="mb-5 rounded-[22px] border border-[rgba(52,211,153,0.22)] bg-[rgba(236,253,245,0.96)] px-4 py-3 text-sm text-emerald-700 shadow-[0_18px_36px_rgba(52,211,153,0.1)]"
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

            {showPageSkeleton ? (
              <>
                <div className="mb-5 h-2 w-full rounded skeleton-line" aria-hidden="true" />
                <DashboardLoading />
              </>
            ) : (
              children ?? renderSection({
                section,
                dashboard,
                dict: uiDict,
                locale,
                performance,
                performanceRange,
                setPerformanceRange,
                recentTransactions,
                transactionSubmission,
                recomputeAction,
                setDrawerOpen,
                recomputingSymbols: mutations.recomputingSymbols,
                generateSnapshots,
                isGeneratingSnapshots,
                isSharedContext,
              })
            )}
          </main>
        </div>
      </div>

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
        isSaving={settingsSave.isSaving}
        errorMessage={settingsSave.errorMessage}
        onSave={settingsSave.save}
        dict={uiDict}
      />
    </div>
  );
}

function renderSection({
  section,
  dashboard,
  dict,
  locale,
  performance,
  performanceRange,
  setPerformanceRange,
  recentTransactions,
  transactionSubmission,
  recomputeAction,
  setDrawerOpen,
  recomputingSymbols,
  generateSnapshots,
  isGeneratingSnapshots,
  isSharedContext,
}: {
  section: AppSection;
  dashboard: ReturnType<typeof useDashboardData>;
  dict: ReturnType<typeof getDictionary>;
  locale: LocaleCode;
  performance: ReturnType<typeof useDashboardPerformance>;
  performanceRange: DashboardPerformanceRange;
  setPerformanceRange: (range: DashboardPerformanceRange) => void;
  recentTransactions: ReturnType<typeof useRecentTransactions>;
  transactionSubmission: ReturnType<typeof useTransactionSubmission>;
  recomputeAction: ReturnType<typeof useRecomputeAction>;
  setDrawerOpen: (open: boolean) => void;
  recomputingSymbols: Set<string>;
  generateSnapshots: () => Promise<void>;
  isGeneratingSnapshots: boolean;
  isSharedContext: boolean;
}) {
  const largestHolding = dashboard.holdings[0] ?? null;
  const quotedHoldingCount = dashboard.holdings.filter((holding) => holding.currentUnitPrice !== null).length;
  const quoteCoverageValue = dashboard.holdings.length === 0
    ? "-"
    : formatPercent((quotedHoldingCount / dashboard.holdings.length) * 100, locale);
  const quoteCoverageDetail = dashboard.holdings.length === 0
    ? dict.dashboardHome.holdingsEmpty
    : `${formatNumber(quotedHoldingCount, locale)} / ${formatNumber(dashboard.holdings.length, locale)}`;

  if (section === "portfolio") {
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
        <HoldingsTable holdings={dashboard.holdings} dict={dict} locale={locale} recomputingSymbols={recomputingSymbols} />
        <DividendsSection upcoming={dashboard.dividends.upcoming} recent={dashboard.dividends.recent} dict={dict} locale={locale} />
      </div>
    );
  }

  if (section === "transactions") {
    return (
      <div className="stagger grid min-w-0 gap-6">
        <RouteHeroPanel
          eyebrow={dict.navigation.transactionsLabel}
          title={dict.transactions.title}
          description={dict.navigation.transactionsDescription}
          testId="transactions-intro"
          metrics={[
            {
              label: dict.dashboardHome.accountCountLabel,
              value: formatNumber(dashboard.summary.accountCount, locale),
              detail: dict.navigation.transactionsLabel,
            },
            {
              label: dict.dashboardHome.holdingCountLabel,
              value: formatNumber(dashboard.summary.holdingCount, locale),
              detail: dict.holdings.entries.replace("{count}", String(dashboard.summary.holdingCount)),
            },
            {
              label: dict.dashboardHome.issueCountLabel,
              value: formatNumber(dashboard.summary.openIssueCount, locale),
              detail: dashboard.summary.openIssueCount > 0 ? dict.dialogs.integrityTitle : dict.dashboardHome.actionHealthyTitle,
            },
            {
              label: dict.dashboardHome.quoteCoverageLabel,
              value: quoteCoverageValue,
              detail: quoteCoverageDetail,
            },
          ]}
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <div className="min-w-0">
            {isSharedContext ? (
              <Card
                className="border border-rose-200 bg-rose-50/90 text-rose-700"
                data-testid="transactions-readonly"
              >
                <p role="status" aria-live="polite">{dict.switcher.readonlyDescription}</p>
              </Card>
            ) : (
              <AddTransactionCard
                value={transactionSubmission.draftTransaction}
                accountOptions={dashboard.accounts.map((account) => ({ id: account.id, name: account.name }))}
                pending={transactionSubmission.isSubmitting}
                onChange={(next) => {
                  transactionSubmission.setMessage("");
                  transactionSubmission.setDraftTransaction(dashboard.synchronizeTransactionDraft(next));
                }}
                onSubmit={transactionSubmission.submit}
                dict={dict}
              />
            )}
          </div>

          <div className="grid min-w-0 gap-6">
            <StatusStripCard
              eyebrow={dict.navigation.transactionsLabel}
              title={dict.transactions.verificationTitle}
              description={dict.transactions.verificationDescription}
              metrics={[
                {
                  label: dict.dashboardHome.marketValueLabel,
                  value: dashboard.summary.marketValueAmount !== null
                    ? formatCurrencyAmount(dashboard.summary.marketValueAmount, dashboard.summary.totalCostCurrency, locale)
                    : dict.dashboardHome.noMarketValue,
                },
                {
                  label: dict.dashboardHome.totalCostLabel,
                  value: formatCurrencyAmount(dashboard.summary.totalCostAmount, dashboard.summary.totalCostCurrency, locale),
                },
                {
                  label: dict.dashboardHome.holdingCountLabel,
                  value: formatNumber(dashboard.summary.holdingCount, locale),
                },
              ]}
              testId="transactions-verification-panel"
            />
            <RecentTransactionsCard
              items={recentTransactions.items}
              locale={locale}
              dict={dict}
              isLoading={recentTransactions.isLoading}
              errorMessage={recentTransactions.errorMessage}
            />
          </div>
        </div>
      </div>
    );
  }

  if (section === "dividends") {
    return null;
  }

  if (section === "cash-ledger") {
    return null;
  }

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
              ? formatCurrencyAmount(dashboard.summary.marketValueAmount, dashboard.summary.totalCostCurrency, locale)
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
              ? formatCurrencyAmount(dashboard.summary.unrealizedPnlAmount, dashboard.summary.totalCostCurrency, locale)
              : dict.dashboardHome.noMarketValue,
            detail: formatCurrencyAmount(dashboard.summary.totalCostAmount, dashboard.summary.totalCostCurrency, locale),
          },
          {
            label: dict.dashboardHome.dailyChangeLabel,
            value: dashboard.summary.dailyChangeAmount !== null
              ? formatCurrencyAmount(dashboard.summary.dailyChangeAmount, dashboard.summary.totalCostCurrency, locale)
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
        actions={(
          <div className="flex flex-wrap items-center gap-2 rounded-full border border-slate-200 bg-white/90 p-1 shadow-[0_12px_24px_rgba(148,163,184,0.08)]">
            {(["1M", "3M", "YTD", "1Y"] as DashboardPerformanceRange[]).map((item) => (
              <Button
                key={item}
                variant={item === performanceRange ? "default" : "secondary"}
                size="sm"
                className={cn(
                  "rounded-full border-transparent px-3 text-[11px] font-semibold uppercase tracking-[0.16em]",
                  item !== performanceRange && "bg-transparent shadow-none",
                )}
                data-testid={`dashboard-hero-range-${item.toLowerCase()}`}
                onClick={() => setPerformanceRange(item)}
                aria-pressed={item === performanceRange}
              >
                {item === "1M"
                  ? dict.dashboardHome.range1MLabel
                  : item === "3M"
                    ? dict.dashboardHome.range3MLabel
                    : item === "YTD"
                      ? dict.dashboardHome.rangeYtdLabel
                      : dict.dashboardHome.range1YLabel}
              </Button>
            ))}
          </div>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.22fr)_minmax(0,0.78fr)]">
        <PortfolioTrendCard
          data={performance.data}
          range={performanceRange}
          currency={dashboard.summary.totalCostCurrency}
          locale={locale}
          dict={dict}
          isLoading={performance.isLoading}
          errorMessage={performance.errorMessage}
          onRangeChange={setPerformanceRange}
        />
        <AllocationSnapshotCard holdings={dashboard.holdings} locale={locale} dict={dict} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)]">
        <ReturnPercentCard
          data={performance.data}
          locale={locale}
          dict={dict}
          isLoading={performance.isLoading}
          errorMessage={performance.errorMessage}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <HoldingsTable holdings={dashboard.holdings} dict={dict} locale={locale} recomputingSymbols={recomputingSymbols} />
        <ActionCenterSection
          locale={locale}
          settings={dashboard.settings}
          integrityIssue={dashboard.actions.integrityIssue}
          pending={recomputeAction.isRunning}
          onRecompute={recomputeAction.runRecompute}
          onGenerateSnapshots={generateSnapshots}
          isGeneratingSnapshots={isGeneratingSnapshots}
          onOpenSettings={() => setDrawerOpen(true)}
          dict={dict}
          readOnly={isSharedContext}
          readOnlyMessage={dict.switcher.readonlyDescription}
        />
      </div>

      <DividendsSection upcoming={dashboard.dividends.upcoming} recent={dashboard.dividends.recent} dict={dict} locale={locale} />
    </div>
  );
}

function RouteHeroPanel({
  eyebrow,
  title,
  description,
  metrics,
  testId,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  metrics: Array<{ label: string; value: string; detail?: string }>;
  testId: string;
  actions?: ReactNode;
}) {
  return (
    <section
      className="glass-panel overflow-hidden rounded-[34px] border border-slate-200/85 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(231,238,255,0.96))] px-5 py-6 shadow-[0_30px_70px_rgba(79,70,229,0.12)] sm:px-6 sm:py-7 md:px-8"
      data-testid={testId}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.92fr)] xl:items-start">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-indigo-500/80">{eyebrow}</p>
          <h2 className="mt-3 text-3xl leading-tight text-slate-950 sm:text-4xl">{title}</h2>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-600">{description}</p>
          {actions ? <div className="mt-5">{actions}</div> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-[24px] border border-indigo-100 bg-white/80 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{metric.value}</p>
              {metric.detail ? <p className="mt-2 text-sm text-slate-500">{metric.detail}</p> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatusStripCard({
  eyebrow,
  title,
  description,
  metrics,
  testId,
}: {
  eyebrow: string;
  title: string;
  description: string;
  metrics: Array<{ label: string; value: string }>;
  testId?: string;
}) {
  return (
    <Card className="border border-slate-200/80 bg-[rgba(255,255,255,0.94)]" data-testid={testId}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500/78">{eyebrow}</p>
      <h2 className="mt-2 text-2xl text-slate-950">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-[22px] border border-slate-200 bg-slate-50/90 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{metric.label}</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">{metric.value}</p>
          </div>
        ))}
      </div>
    </Card>
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
