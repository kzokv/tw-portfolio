"use client";

import { useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type {
  LocaleCode,
  NotificationDto,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import { SidebarInset, SidebarProvider } from "../ui/shadcn/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AppShellTopBarSlot } from "./AppShellTopBarSlot";
import { AppShellBanners } from "./AppShellBanners";
import { AppShellChrome } from "./AppShellChrome";
import { ApiClientErrorToast } from "./ApiClientErrorToast";
import { SharedContextStrip } from "./SharedContextStrip";
import { StatusToast } from "../ui/StatusToast";
import { cn } from "../../lib/utils";
import type { QuickSearchItem } from "./QuickSearchPanel";
import type { useProfile as useProfileType } from "../../features/profile/hooks/useProfile";
import { useNavigationFeedback } from "./NavigationFeedbackContext";
import { ShellNavigationFeedback } from "./ShellNavigationFeedback";
import type { IntegrityIssue } from "../../features/dashboard/types";
import { getLayoutShellLabels } from "./i18n";

interface AppShellLayoutProps {
  initialSidebarOpen: boolean;
  // Identity
  profileData: ReturnType<typeof useProfileType>;
  integrityIssue: IntegrityIssue | null;
  showIntegrityDialog: boolean;
  setShowIntegrityDialog: (open: boolean) => void;
  // Dictionaries
  dict: AppDictionary;
  uiDict: AppDictionary;
  locale: LocaleCode;
  isSharedContext: boolean;
  sharedOwnerId: string;
  sharedOwnerLabel: string;
  onExitSharedContext: () => void;
  // Sidebar slot
  switcherSlot: ReactNode;
  // TopBar inputs
  quickSearchItems: QuickSearchItem[];
  unreadCount: number;
  notifications: NotificationDto[];
  notificationDropdownOpen: boolean;
  onNotificationOpenChange: (open: boolean) => void;
  markRead: (id: string) => Promise<void> | void;
  markAllRead: () => Promise<void> | void;
  dismiss: (id: string) => Promise<void> | void;
  // Status / banner state
  contextMessage: string;
  globalError: string;
  transactionMessage: string;
  recomputeMessage: string;
  snapshotMessage: string;
  mutationsMessage: string;
  mutationsErrorMessage: string;
  onClearGlobalError: () => void;
  // Ready / debug markers
  isClientReady: boolean;
  switcherLoaded: boolean;
  // Phase 3d S10 — drawer wiring removed. AppShellChrome no longer renders
  // SettingsDrawer; the integrity dialog's "open settings" CTA navigates
  // to /settings via useRouter. `onTimeframesSaved` + `onReportingCurrencySaved`
  // remain here for the dashboard's own performance refresh signal path —
  // they are no longer threaded through the chrome.
  onTimeframesSaved: () => void;
  onReportingCurrencySaved: () => void;
  children: ReactNode;
}

/**
 * Pure-presentation shell skeleton: `<SidebarProvider>` + `<AppSidebar>` +
 * `<SidebarInset>` (TopBar + main + banners + chrome). Extracted from
 * `AppShell.tsx` per Phase 3c spec target (AppShell ≤300 LOC). No
 * effects, no state — all data flows in via props.
 */
export function AppShellLayout({
  initialSidebarOpen,
  profileData,
  integrityIssue,
  showIntegrityDialog,
  setShowIntegrityDialog,
  dict,
  uiDict,
  locale,
  isSharedContext,
  sharedOwnerId,
  sharedOwnerLabel,
  onExitSharedContext,
  switcherSlot,
  quickSearchItems,
  unreadCount,
  notifications,
  notificationDropdownOpen,
  onNotificationOpenChange,
  markRead,
  markAllRead,
  dismiss,
  contextMessage,
  globalError,
  transactionMessage,
  recomputeMessage,
  snapshotMessage,
  mutationsMessage,
  mutationsErrorMessage,
  onClearGlobalError,
  isClientReady,
  switcherLoaded,
  onTimeframesSaved: _onTimeframesSaved,
  onReportingCurrencySaved: _onReportingCurrencySaved,
  children,
}: AppShellLayoutProps) {
  const router = useRouter();
  const { isPending } = useNavigationFeedback();
  const shellLabels = getLayoutShellLabels(locale);
  // Phase 3d — avatar-menu Profile entry routes directly to /settings/profile.
  // (Drawer-open path retired in S10.)
  const openProfile = useCallback(() => router.push("/settings/profile"), [router]);
  return (
    <SidebarProvider defaultOpen={initialSidebarOpen}>
      <AppSidebar
        variant="user"
        role={profileData.profile?.role}
        productName={uiDict.topBar.productName}
        labels={{
          brandMobileAria: uiDict.topBar.openNavigationLabel,
          brandDesktopAria: uiDict.topBar.titleTooltip,
          dashboardFeedbackLabel: uiDict.navigation.dashboardLabel,
          operatorGroupLabel: uiDict.commandPalette.groupActions,
          resizeRail: shellLabels.sidebarResizeRail,
          nav: {
            dashboard: uiDict.navigation.dashboardLabel,
            analysis: uiDict.navigation.analysisLabel,
            reports: uiDict.navigation.reportsLabel,
            portfolio: uiDict.navigation.portfolioLabel,
            transactions: uiDict.navigation.transactionsLabel,
            "cash-ledger": uiDict.navigation.cashLedgerLabel,
            dividends: uiDict.navigation.dividendsLabel,
            sharing: uiDict.commandPalette.routeSharing,
            admin: shellLabels.profileMenu.adminLink,
            settings: uiDict.settings.title,
          },
        }}
        switcherSlot={switcherSlot}
      />

      <SidebarInset className="relative flex h-svh min-w-0 max-w-full flex-col overflow-hidden">
        <AppShellTopBarSlot
          userId={profileData.profile?.userId}
          displayName={profileData.profile?.displayName}
          pictureUrl={profileData.profile?.providerPictureUrl}
          email={profileData.profile?.email}
          role={profileData.profile?.role}
          locale={locale}
          uiDict={uiDict}
          quickSearchItems={quickSearchItems}
          unreadCount={unreadCount}
          notifications={notifications}
          notificationDropdownOpen={notificationDropdownOpen}
          onNotificationOpenChange={onNotificationOpenChange}
          markRead={markRead}
          markAllRead={markAllRead}
          dismiss={dismiss}
          onOpenProfile={openProfile}
        />

        <main
          className="min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 md:px-6 md:py-8"
          data-testid="shell-main"
        >
          {/* Preserves §8 item 7 — ApiClientErrorToast inside SidebarInset main. */}
          <ApiClientErrorToast />
          {/* Preserves §8 item 8 — StatusToast inside SidebarInset main. */}
          <StatusToast message={contextMessage} variant="success" testId="context-status" />

          <AppShellBanners
            dict={dict}
            globalError={globalError}
            transactionMessage={transactionMessage}
            recomputeMessage={recomputeMessage}
            snapshotMessage={snapshotMessage}
            mutationsMessage={mutationsMessage}
            mutationsErrorMessage={mutationsErrorMessage}
            onClearGlobalError={onClearGlobalError}
          />

          <ShellNavigationFeedback />

          <div data-testid="app-shell-ready" />
          {isClientReady ? <div data-testid="app-shell-client-ready" /> : null}
          {switcherLoaded ? <div data-testid="switcher-data-ready" /> : null}

          <div
            className={cn(
              "transition-opacity duration-150",
              isPending ? "opacity-60" : "opacity-100",
            )}
            data-testid="shell-content-frame"
          >
            {isSharedContext ? (
              <SharedContextStrip
                key={sharedOwnerId}
                ownerId={sharedOwnerId}
                ownerLabel={sharedOwnerLabel}
                titleTemplate={uiDict.switcher.contextStripTitle}
                subtitleTemplate={uiDict.switcher.contextStripSubtitle}
                actionLabel={uiDict.switcher.contextStripAction}
                onExitSharedContext={onExitSharedContext}
              />
            ) : null}
            <AppShellChrome
              integrityIssue={integrityIssue}
              showIntegrityDialog={showIntegrityDialog}
              setShowIntegrityDialog={setShowIntegrityDialog}
              uiDict={uiDict}
              locale={locale}
            >
              {children}
            </AppShellChrome>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
