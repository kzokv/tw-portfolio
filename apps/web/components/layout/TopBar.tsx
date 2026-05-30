"use client";

import type { NotificationDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import { Button } from "../ui/Button";
import { SidebarTrigger, useSidebar } from "../ui/shadcn/sidebar";
import { Breadcrumb } from "./Breadcrumb";
import { CommandPaletteTrigger } from "./CommandPaletteTrigger";
import { NotificationBell } from "./NotificationBell";
import { ProfileMenu } from "../profile/ProfileMenu";
import { type QuickSearchItem } from "./QuickSearchPanel";
import { TopBarSearch } from "./TopBarSearch";
import { ThemeToggle } from "./ThemeToggle";

// Re-export so existing AppShell imports (`import type { QuickSearchItem } from "./TopBar"`)
// continue to resolve. The canonical home is `./QuickSearchPanel`.
export type { QuickSearchItem };

interface TopBarProps {
  // Identity
  userId?: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  email?: string | null;
  role?: string;

  // Profile menu wiring
  onOpenProfile?: () => void;
  signOutHref: string;

  // Search
  searchItems: QuickSearchItem[];
  searchPlaceholder: string;
  searchLabel: string;
  searchEmptyLabel: string;
  searchRoutesLabel: string;
  searchTickersLabel: string;
  openSearchLabel: string;
  closeSearchLabel: string;
  /** Hide the inline search input (admin variant). */
  hideSearch?: boolean;

  // Notifications
  unreadCount?: number;
  notifications?: NotificationDto[];
  notificationDropdownOpen?: boolean;
  onNotificationOpenChange?: (open: boolean) => void;
  onNotificationMarkRead?: (id: string) => void;
  onNotificationMarkAllRead?: () => void;
  onNotificationDismiss?: (id: string) => void;
  notificationDict?: AppDictionary;
  /** Hide the bell (e.g. admin shell). */
  hideNotifications?: boolean;
}

/**
 * Decomposed Phase 3c TopBar. Slots in order:
 *   `<SidebarTrigger>` (desktop collapse) · `<Breadcrumb>` · `<TopBarSearch>` ·
 *   `<CommandPaletteTrigger>` · `<NotificationBell>` · `<ThemeToggle>` ·
 *   `<ProfileMenu>`.
 *
 * Brand link and PortfolioSwitcher have moved to `<AppSidebar>` (spec
 * amendments #18 + #23). The page-title H1 block is dropped — the breadcrumb
 * replaces it.
 *
 * Search behavior + JSX lives in `./TopBarSearch`; quick-search result
 * rendering lives in `./QuickSearchPanel`.
 *
 * Locked testids per design §2.
 */
export function TopBar({
  userId,
  displayName,
  pictureUrl,
  email,
  role,
  onOpenProfile,
  signOutHref,
  searchItems,
  searchPlaceholder,
  searchLabel,
  searchEmptyLabel,
  searchRoutesLabel,
  searchTickersLabel,
  openSearchLabel,
  closeSearchLabel,
  hideSearch = false,
  unreadCount = 0,
  notifications = [],
  notificationDropdownOpen = false,
  onNotificationOpenChange,
  onNotificationMarkRead,
  onNotificationMarkAllRead,
  onNotificationDismiss,
  notificationDict,
  hideNotifications = false,
}: TopBarProps) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <header
      role="banner"
      data-testid="topbar"
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:gap-2 md:px-4"
    >
      <SidebarTrigger
        data-testid="app-sidebar-trigger"
        className="shrink-0"
        aria-label="Toggle sidebar"
      />
      {isMobile ? (
        // Preserves §8 item 13 — mobile brand-as-trigger. Tapping opens the
        // sheet so the user lands inside the sidebar tree. The in-Sheet
        // brand link (inside AppSidebar's SidebarHeader) handles desktop
        // brand-link semantics; this element is the locator anchor for
        // `app-sidebar-brand` on `<md`.
        <Button
          variant="ghost"
          className="h-9 shrink-0 px-1.5 text-xs font-semibold"
          onClick={() => setOpenMobile(true)}
          data-testid="app-sidebar-brand"
          aria-label="Open navigation"
        >
          V
        </Button>
      ) : null}

      <div className="min-w-0 flex-1" data-testid="topbar-breadcrumb">
        <Breadcrumb />
      </div>

      {!hideSearch ? (
        <TopBarSearch
          items={searchItems}
          placeholder={searchPlaceholder}
          label={searchLabel}
          emptyLabel={searchEmptyLabel}
          routesLabel={searchRoutesLabel}
          tickersLabel={searchTickersLabel}
          openLabel={openSearchLabel}
          closeLabel={closeSearchLabel}
        />
      ) : null}

      <CommandPaletteTrigger />

      {!hideNotifications
        && notificationDict
        && onNotificationOpenChange
        && onNotificationMarkRead
        && onNotificationMarkAllRead
        && onNotificationDismiss ? (
        <NotificationBell
          unreadCount={unreadCount}
          notifications={notifications}
          open={notificationDropdownOpen}
          onOpenChange={onNotificationOpenChange}
          onMarkRead={onNotificationMarkRead}
          onMarkAllRead={onNotificationMarkAllRead}
          onDismiss={onNotificationDismiss}
          dict={notificationDict}
        />
      ) : null}

      <div className="hidden shrink-0 md:block" data-testid="topbar-theme-toggle">
        <ThemeToggle />
      </div>

      <ProfileMenu
        userId={userId}
        displayName={displayName}
        pictureUrl={pictureUrl}
        email={email}
        role={role}
        onOpenProfile={onOpenProfile}
        signOutHref={signOutHref}
      />
    </header>
  );
}
