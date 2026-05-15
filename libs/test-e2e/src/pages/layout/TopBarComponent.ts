import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";

export interface TTopBarElements {
  title: Locator;
  avatarButton: Locator;
  avatarMenuSettings: Locator;
  avatarMenuAdmin: Locator;
  avatarMenuIdentity: Locator;
  avatarMenuSignOut: Locator;
  notificationBell: Locator;
  notificationBadge: Locator;
  notificationDropdown: Locator;
  notificationEmpty: Locator;
  notificationMarkAllRead: Locator;
}

export class TopBarComponent extends BasePage<TTopBarElements> {
  protected initializeElements(): void {
    this._elements = {
      title: this.locate("topbar-title", "Top Bar Title"),
      avatarButton: this.locate("avatar-button", "Avatar Button"),
      avatarMenuSettings: this.locate("avatar-menu-settings", "Open Settings Menu Item"),
      avatarMenuAdmin: this.locate("avatar-menu-admin", "Avatar Menu Admin Link"),
      avatarMenuIdentity: this.locate("avatar-menu-identity", "Avatar Menu Identity Header"),
      avatarMenuSignOut: this.locate("avatar-menu-sign-out", "Avatar Menu Sign Out"),
      notificationBell: this.locate("notification-bell", "Notification Bell"),
      notificationBadge: this.locate("notification-badge", "Notification Badge"),
      notificationDropdown: this.locate("notification-dropdown", "Notification Dropdown"),
      notificationEmpty: this.locate("notification-empty", "Notification Empty State"),
      notificationMarkAllRead: this.locate("notification-mark-all-read", "Mark All Read Button"),
    };
  }
}
