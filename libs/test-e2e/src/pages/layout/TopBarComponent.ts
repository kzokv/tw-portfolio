import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";

// Phase 3c: TopBar no longer renders a standalone page title (H1 removed).
// Breadcrumb replaces the title; `topbar-breadcrumb` wraps it in the TopBar.
// ProfileMenu replaces UserAvatarButton; avatar-menu-settings RETIRED (amendment #11).
// NotificationBell is now a shadcn Popover.
export interface TTopBarElements {
  /** Wrapper around <Breadcrumb> inside TopBar. Replaces the retired topbar-title H1. */
  breadcrumb: Locator;
  /** Avatar DropdownMenu trigger. Renamed from avatar-button → topbar-profile-menu-trigger. */
  avatarButton: Locator;
  /** Profile menu dropdown content. Renamed from avatar-dropdown-menu → profile-menu-content. */
  profileMenuContent: Locator;
  /** Identity block (name + email). Renamed from avatar-menu-identity → profile-menu-header. */
  avatarMenuIdentity: Locator;
  /**
   * Admin link in ProfileMenu. Element carries BOTH new testid (`profile-menu-admin-link`)
   * AND legacy back-compat alias (`avatar-menu-admin`) so existing specs keep passing.
   * Page-object uses the legacy alias per the 3c back-compat contract.
   */
  avatarMenuAdmin: Locator;
  /** Sign out link. Renamed from avatar-menu-sign-out → profile-menu-sign-out. */
  avatarMenuSignOut: Locator;
  // avatar-menu-settings RETIRED in 3c (amendment #11). Settings accessible via sidebar.
  /** Notification PopoverTrigger button. Renamed from notification-bell → notification-bell-button. */
  notificationBell: Locator;
  /** Unread count badge. Renamed from notification-badge → notification-bell-unread-count. */
  notificationBadge: Locator;
  /** Notification PopoverContent root. Renamed from notification-dropdown → notification-popover-content. */
  notificationDropdown: Locator;
  /** Empty state message. Renamed from notification-empty → notification-empty-state. */
  notificationEmpty: Locator;
  notificationMarkAllRead: Locator;
}

export class TopBarComponent extends BasePage<TTopBarElements> {
  protected initializeElements(): void {
    this._elements = {
      // 3c: breadcrumb wrapper replaces topbar-title H1
      breadcrumb: this.locate("topbar-breadcrumb", "Top Bar Breadcrumb Wrapper"),
      // 3c renames
      avatarButton: this.locate("topbar-profile-menu-trigger", "Profile Menu Trigger"),
      profileMenuContent: this.locate("profile-menu-content", "Profile Menu Content"),
      avatarMenuIdentity: this.locate("profile-menu-header", "Profile Menu Identity Header"),
      // legacy alias avatar-menu-admin still on element for back-compat
      avatarMenuAdmin: this.locate("avatar-menu-admin", "Avatar Menu Admin Link"),
      avatarMenuSignOut: this.locate("profile-menu-sign-out", "Profile Menu Sign Out"),
      // Notification bell → shadcn Popover
      notificationBell: this.locate("notification-bell-button", "Notification Bell Button"),
      notificationBadge: this.locate("notification-bell-unread-count", "Notification Unread Count"),
      notificationDropdown: this.locate("notification-popover-content", "Notification Popover Content"),
      notificationEmpty: this.locate("notification-empty-state", "Notification Empty State"),
      notificationMarkAllRead: this.locate("notification-mark-all-read", "Mark All Read Button"),
    };
  }
}
