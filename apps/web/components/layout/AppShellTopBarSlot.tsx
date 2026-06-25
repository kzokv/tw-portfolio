"use client";

import { useCallback } from "react";
import type { LocaleCode, NotificationDto } from "@vakwen/shared-types";
import { API_PUBLIC } from "../../lib/api";
import type { AppDictionary } from "../../lib/i18n/types";
import { TopBar } from "./TopBar";
import { getLayoutShellLabels } from "./i18n";
import type { QuickSearchItem } from "./QuickSearchPanel";

interface AppShellTopBarSlotProps {
  userId?: string;
  displayName?: string | null;
  pictureUrl?: string | null;
  email?: string | null;
  role?: string;
  locale: LocaleCode;
  uiDict: AppDictionary;
  quickSearchItems: QuickSearchItem[];
  unreadCount: number;
  notifications: NotificationDto[];
  notificationDropdownOpen: boolean;
  onNotificationOpenChange: (open: boolean) => void;
  markRead: (id: string) => Promise<void> | void;
  markAllRead: () => Promise<void> | void;
  dismiss: (id: string) => Promise<void> | void;
  onOpenProfile: () => void;
}

/**
 * Thin wrapper that adapts the AppShell-owned notification + identity props
 * to `<TopBar>`'s shape. Extracted from `AppShell.tsx` per Phase 3c spec
 * target (AppShell ≤300 LOC). No new logic — only prop fan-out.
 */
export function AppShellTopBarSlot({
  userId,
  displayName,
  pictureUrl,
  email,
  role,
  locale,
  uiDict,
  quickSearchItems,
  unreadCount,
  notifications,
  notificationDropdownOpen,
  onNotificationOpenChange,
  markRead,
  markAllRead,
  dismiss,
  onOpenProfile,
}: AppShellTopBarSlotProps) {
  const handleMarkRead = useCallback((id: string) => { void markRead(id); }, [markRead]);
  const handleMarkAllRead = useCallback(() => { void markAllRead(); }, [markAllRead]);
  const handleDismiss = useCallback((id: string) => { void dismiss(id); }, [dismiss]);
  const shellLabels = getLayoutShellLabels(locale);

  return (
    <TopBar
      userId={userId}
      displayName={displayName}
      pictureUrl={pictureUrl}
      email={email}
      role={role}
      onOpenProfile={onOpenProfile}
      signOutHref={`${API_PUBLIC}/auth/logout`}
      searchPlaceholder={uiDict.topBar.searchPlaceholder}
      searchLabel={uiDict.topBar.searchLabel}
      searchEmptyLabel={uiDict.topBar.searchEmptyLabel}
      searchRoutesLabel={uiDict.topBar.searchRoutesLabel}
      searchTickersLabel={uiDict.topBar.searchTickersLabel}
      openSearchLabel={uiDict.topBar.openSearchLabel}
      closeSearchLabel={uiDict.topBar.closeSearchLabel}
      toggleSidebarLabel={shellLabels.topBar.toggleSidebarLabel}
      openNavigationLabel={shellLabels.topBar.openNavigationLabel}
      commandPaletteLabel={uiDict.commandPalette.placeholder}
      commandPaletteAriaLabel={shellLabels.commandPaletteTrigger.ariaLabel}
      shellLabels={shellLabels}
      searchItems={quickSearchItems}
      unreadCount={unreadCount}
      notifications={notifications}
      notificationDropdownOpen={notificationDropdownOpen}
      onNotificationOpenChange={onNotificationOpenChange}
      onNotificationMarkRead={handleMarkRead}
      onNotificationMarkAllRead={handleMarkAllRead}
      onNotificationDismiss={handleDismiss}
      notificationDict={uiDict}
    />
  );
}
