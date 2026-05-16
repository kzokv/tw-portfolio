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
import { cn } from "../../lib/utils";
import type { TransactionInput } from "../portfolio/types";
import { SettingsDrawer } from "../settings/SettingsDrawer";
import { Button } from "../ui/Button";
import { API_PUBLIC, postJson } from "../../lib/api";
import { TopBar, type QuickSearchItem } from "./TopBar";
import { SideNavigation } from "./SideNavigation";
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

type AppSection = "dashboard" | "portfolio" | "transactions" | "dividends" | "cash-ledger";
type ViewportMode = "mobile" | "compact" | "wide";

interface AppShellProps {
  section?: AppSection;
  isDemo?: boolean;
  localeOverride?: LocaleCode;
  titleOverride?: string;
  descriptionOverride?: string;
  activeSectionOverride?: AppSection | null;
  initialProfile?: ProfileWithImpersonationDto | null;
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
  // KZO-169: marketCode is null until either the chip is selected or the
  // form is mounted with a multi-currency-aware default. AddTransactionCard
  // derives the displayed chip from `accountOptions` when this is null.
  marketCode: null,
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
  initialProfile = null,
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
  // KZO-159 (158A) / KZO-161 (158C) — Effective dashboard performance ranges
  // resolved through the 3-tier user → admin → default precedence. Hook
  // extracted in KZO-161 so the gear popover + Display tab can trigger a
  // refetch after saving without remounting AppShell. See
  // apps/web/hooks/useEffectiveRanges.ts and design §7.
  const { effectiveRanges, refetch: refetchEffectiveRanges } = useEffectiveRanges();
  // KZO-161 (158C) F5 / KZO-162 — Per-page remount counter map. Each
  // <SortableCardGrid> instance keys on its own counter, so a per-page reset
  // remounts only that surface. "Reset all layouts" bumps every counter
  // atomically. The grid re-fetches its initial order on mount, so a
  // key-bump is the simplest way to reflect the reset without plumbing
  // imperative refs.
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
  const [chromeHeight, setChromeHeight] = useState(0);
  // Guards the deep-link effect: once we apply ?as=X the first time, don't
  // re-apply even if the effect's dependencies thrash during the refresh
  // cascade (router.refresh → re-render → stable callback identity change).
  // Without this guard, the deep-link effect can race with React's hook
  // tracking under Next's Suspense + router.refresh combo and manifest as
  // "Rendered more hooks than during the previous render."
  const deepLinkAppliedRef = useRef(false);
  const chromeRef = useRef<HTMLDivElement | null>(null);
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
  // Only override the truly-empty-portfolio copy. Deliberately does NOT fire
  // for filter-empty states (e.g. search matched 0 holdings), which share the
  // same dict key but mean something different. Guarding on a zero-length
  // portfolio keeps the owner-facing copy scoped to the empty-owner case.
  const hasOwnerEmptyPortfolio = isSharedContext && dashboard.holdings.length === 0;
  // Note: `recentLedgerEmpty` mutation is unconditional in shared context.
  // The key is only consumed by RecentTransactionsCard's empty-state path
  // (apps/web/components/dashboard/RecentTransactionsCard.tsx:42); when
  // items exist the empty path doesn't render, so the override is harmless
  // when items.length > 0. Pre-refactor AppShell gated this on items.length
  // via `useRecentTransactions` — that hook now lives in TransactionsClient,
  // so the items count isn't observable here. Net behaviour identical.
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
  }, [
    currentSharedOwnerLabel,
    dict,
    hasOwnerEmptyPortfolio,
    isSharedContext,
  ]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  // KZO-161 (158C): range-snap guard. When the effective list changes (user
  // removes their current range from the popover, admin config changes, etc.)
  // snap `performanceRange` to `effectiveRanges[0]` so the dashboard never
  // requests a range the backend's dynamic validator will 400.
  useEffect(() => {
    if (effectiveRanges.length === 0) return;
    if (!effectiveRanges.includes(performanceRange)) {
      setPerformanceRange(effectiveRanges[0]);
    }
  }, [effectiveRanges, performanceRange]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const element = chromeRef.current;
    if (!element) return;

    const updateHeight = () => {
      setChromeHeight(element.getBoundingClientRect().height);
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [impersonation]);

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

  const refreshContextDependentData = useCallback(async () => {
    router.refresh();
    setContextRefreshSignal((n) => n + 1);
    await Promise.allSettled([
      dashboard.refresh(),
      profileData.refresh(),
      refreshSwitcherData(),
    ]);
  }, [
    dashboard,
    profileData,
    refreshSwitcherData,
    router,
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
    // KZO-115: trade mutations trigger a scoped snapshot recompute inside
    // scheduleReplayWithRetry. Signal page-scoped clients (DashboardClient's
    // performance chart, TransactionsClient's recent ledger) to re-fetch
    // so they reflect the new snapshots without remount.
    setContextRefreshSignal((n) => n + 1);
  }, [dashboard.refresh]);

  const transactionSubmission = useTransactionSubmission({
    initialValue: DEFAULT_TRANSACTION,
    noAccountsMessage: dict.feedback.noAccounts,
    tickerRequiredMessage: dict.transactions.tickerRequired,
    successMessage: dict.feedback.transactionSubmitted,
    refresh: refreshAfterTransaction,
  });

  const refreshAfterRecompute = useCallback(async () => {
    await dashboard.refresh();
    // Signal DashboardClient's performance chart to re-fetch.
    setContextRefreshSignal((n) => n + 1);
  }, [dashboard.refresh]);

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
      // Signal DashboardClient to re-fetch the performance series so the
      // chart reflects the newly-generated snapshots.
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
        isRevokedSharingNotification(notification) &&
        ownerUserId &&
        ownerUserId === currentContextOwnerId
      ) {
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
  // KZO-169: thread `defaultCurrency` (and `accountType`) through so the form
  // can derive the chip default + filter the account dropdown by currency
  // compatibility.
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
  }, [dashboard.refresh]);

  const isI18nReady = !!dashboard.settings || !!localeOverride;

  const drawerOpen = searchParams.get("drawer") === "settings";

  // KZO-169 (NC4): deep-link support for the transaction form's inline
  // create-account link. URL shape: `?drawer=settings&settingsTab=accounts
  // &accountsPrefillCurrency=USD`. Parsed values are passed to SettingsDrawer
  // and on into useSettingsForm + AccountCreateForm.
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
        // KZO-169: also clear the deep-link params on close so a subsequent
        // re-open does not re-prefill stale state.
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
      <div ref={chromeRef} className="sticky top-0 z-30">
        <ImpersonationBanner impersonation={impersonation} onRefreshContext={refreshContextDependentData} />
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
          sticky={false}
          mobileSearchTop={chromeHeight}
        />
      </div>

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
            <ApiClientErrorToast />
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
                        // Signal child clients to re-fetch their page-scoped data.
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

            <CardLayoutResetProvider value={cardLayoutResetCounts}>
              <AppShellDataProvider value={appShellDataValue}>
                {children ?? null}
              </AppShellDataProvider>
            </CardLayoutResetProvider>
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
        // KZO-179 — re-fetch dashboard.accounts after a POST /accounts from
        // the new Accounts tab. dashboard.refresh() triggers a snapshot
        // refetch which re-pulls accounts + feeProfiles + bindings (see
        // useDashboardData.refresh).
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
        // KZO-180 — when the user changes their reporting currency, the API
        // re-translates dashboard totals + the perf series at the next read.
        // Mirror the timeframe-saved wiring: refetch the snapshot AND the
        // perf data so the labels/values flip in place without a remount.
        onReportingCurrencySaved={() => {
          void dashboard.refresh();
          // Signal DashboardClient to re-fetch its performance chart so
          // the re-translated series replaces the old labels/values.
          setContextRefreshSignal((n) => n + 1);
        }}
        // KZO-169 (NC4): deep-link prefill for the create-account flow.
        // AddTransactionCard's "no {currency} account" inline error builds a
        // URL with these params; AppShell parses them above.
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
