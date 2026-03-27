import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TTopBarElements {
  title: Locator;
  avatarButton: Locator;
  avatarMenuSettings: Locator;
  avatarMenuIdentity: Locator;
  avatarMenuSignOut: Locator;
}

export class TopBarComponent extends BasePage<TTopBarElements> {
  protected initializeElements(): void {
    this._elements = {
      title: this.locate("topbar-title", "Top Bar Title"),
      avatarButton: this.locate("avatar-button", "Avatar Button"),
      avatarMenuSettings: this.locate("avatar-menu-settings", "Open Settings Menu Item"),
      avatarMenuIdentity: this.locate("avatar-menu-identity", "Avatar Menu Identity Header"),
      avatarMenuSignOut: this.locate("avatar-menu-sign-out", "Avatar Menu Sign Out"),
    };
  }
}
