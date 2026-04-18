import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { AppShellPage } from "../../pages/layout/AppShellPage.js";

export class AppShellAssert extends BaseAssert {
  declare protected readonly _instance: AppShellPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async topBarTitleContains(text: string): Promise<void> {
    await expect(this.el.topBar.elements.title).toContainText(text);
  }

  @Step()
  async isOnRoute(expected: string | RegExp): Promise<void> {
    await this.mxAssertUrlMatches(expected);
  }

  @Step()
  async quotePollValueContains(text: string): Promise<void> {
    await expect(this.el.settings.quotePollValue).toContainText(text);
  }

  @Step()
  async desktopSidebarIsVisible(): Promise<void> {
    await expect(this.el.desktopSidebar).toBeVisible();
  }

  @Step()
  async desktopSidebarCollapsedStateIs(collapsed: boolean): Promise<void> {
    await expect(this.el.desktopSidebar).toHaveAttribute("data-collapsed", String(collapsed));
  }

  @Step()
  async desktopNavToggleIsVisible(): Promise<void> {
    await expect(this.el.desktopNavToggle).toBeVisible();
  }

  @Step()
  async sidebarLinkIsCurrent(destination: string, mode: "desktop" | "mobile" = "desktop"): Promise<void> {
    const container = mode === "desktop" ? this.el.desktopSidebar : this.el.mobileSidebar;
    await expect(container.getByTestId(`sidebar-link-${destination}`)).toHaveAttribute("aria-current", "page");
  }

  @Step()
  async desktopSearchIsVisible(): Promise<void> {
    await expect(this.el.search.elements.desktopSearch).toBeVisible();
  }

  @Step()
  async desktopSearchPaddingLeftAtLeast(expectedMinimum: number): Promise<void> {
    const paddingLeft = await this.el.search.elements.desktopSearch.evaluate(
      (input) => Number.parseFloat(getComputedStyle(input).paddingLeft),
    );
    await this.mxAssertGreaterThanOrEqual(paddingLeft, expectedMinimum, "desktop search left padding");
  }

  @Step()
  async searchResultsAreVisible(): Promise<void> {
    await expect(this.el.search.elements.desktopResults).toBeVisible();
  }

  @Step()
  async quickSearchTickerIsVisible(symbol: string): Promise<void> {
    await expect(this.el.search.elements.desktopResults.getByRole("button", { name: new RegExp(symbol) })).toBeVisible();
  }

  @Step()
  async mobileNavToggleIsVisible(): Promise<void> {
    await expect(this.el.mobileNavToggle).toBeVisible();
  }

  @Step()
  async mobileSearchButtonIsVisible(): Promise<void> {
    await expect(this.el.search.elements.mobileSearchButton).toBeVisible();
  }

  @Step()
  async mobileSearchSheetIsVisible(): Promise<void> {
    await expect(this.el.search.elements.mobileSheet).toBeVisible();
  }

  @Step()
  async documentHasNoHorizontalOverflow(tolerance = 2): Promise<void> {
    const { scrollWidth, clientWidth } = await this.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    await this.mxAssertLessThanOrEqual(scrollWidth, clientWidth + tolerance, "document scroll width");
  }

  @Step()
  async avatarButtonIsFocused(): Promise<void> {
    await expect(this.el.topBar.elements.avatarButton).toBeFocused();
  }

  @Step()
  async appIsReady(): Promise<void> {
    await expect(this.el.appReady).toBeAttached({ timeout: 30_000 });
  }

  @Step()
  async statusToastContains(text: string | RegExp): Promise<void> {
    await expect(this.page.getByTestId("context-status")).toContainText(text);
  }

  @Step()
  async avatarMenuShowsSettingsAndSignOut(): Promise<void> {
    await expect(this.el.topBar.elements.avatarMenuSettings).toBeVisible();
    await expect(this.el.topBar.elements.avatarMenuSignOut).toBeVisible();
  }

  @Step()
  async avatarIdentityContains(text: string | RegExp): Promise<void> {
    await expect(this.el.topBar.elements.avatarMenuIdentity).toContainText(text);
  }

  @Step()
  async avatarImageSourceContains(text: string): Promise<void> {
    const image = this.el.topBar.elements.avatarButton.locator("img");
    await expect(image).toBeVisible();
    expect(await image.getAttribute("src")).toContain(text);
  }

  @Step()
  async avatarShowsNoImage(): Promise<void> {
    await expect(this.el.topBar.elements.avatarButton.locator("img")).toHaveCount(0);
  }

  @Step()
  async avatarInitialsMatch(expected: RegExp): Promise<void> {
    await expect(
      this.el.topBar.elements.avatarButton.locator("span[aria-hidden='true']"),
    ).toHaveText(expected);
  }

  @Step()
  async notificationBellIsVisible(): Promise<void> {
    await expect(this.el.topBar.elements.notificationBell).toBeVisible();
  }

  @Step()
  async notificationBadgeIsHidden(): Promise<void> {
    await expect(this.el.topBar.elements.notificationBadge).toBeHidden();
  }

  @Step()
  async notificationBadgeCountIs(expected: number): Promise<void> {
    await expect(this.el.topBar.elements.notificationBadge).toBeVisible();
    await expect(this.el.topBar.elements.notificationBadge).toHaveText(String(expected));
  }

  @Step()
  async notificationDropdownIsVisible(): Promise<void> {
    await expect(this.el.topBar.elements.notificationDropdown).toBeVisible();
  }

  @Step()
  async notificationDropdownIsHidden(): Promise<void> {
    await expect(this.el.topBar.elements.notificationDropdown).toBeHidden();
  }

  @Step()
  async notificationEmptyStateIsVisible(): Promise<void> {
    await expect(this.el.topBar.elements.notificationEmpty).toBeVisible();
  }

  @Step()
  async notificationItemIsVisible(notificationId: string): Promise<void> {
    await expect(this.page.getByTestId(`notification-item-${notificationId}`)).toBeVisible();
  }

  @Step()
  async notificationItemIsHidden(notificationId: string): Promise<void> {
    await expect(this.page.getByTestId(`notification-item-${notificationId}`)).toBeHidden();
  }

  @Step()
  async notificationUnreadDotIsVisible(notificationId: string): Promise<void> {
    await expect(this.page.getByTestId(`notification-unread-${notificationId}`)).toBeVisible();
  }

  @Step()
  async notificationUnreadDotIsHidden(notificationId: string): Promise<void> {
    await expect(this.page.getByTestId(`notification-unread-${notificationId}`)).toBeHidden();
  }

  // ── Admin portal assertions ───────────────────────────────────────────────

  @Step()
  async adminUsersPageIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("admin-users-page")).toBeVisible();
  }

  @Step()
  async adminInvitesPageIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("admin-invites-page")).toBeVisible();
  }

  @Step()
  async adminAuditLogPageIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("admin-audit-log-page")).toBeVisible();
  }

  @Step()
  async adminUsersTableIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("users-table")).toBeVisible();
  }

  @Step()
  async adminInvitesTableIsVisible(): Promise<void> {
    // Fresh test users may have zero invites — accept either the table or the empty state
    const table = this.page.getByTestId("invites-table");
    const empty = this.page.getByText("No invites found.");
    await expect(table.or(empty)).toBeVisible();
  }

  @Step()
  async adminAuditLogTableIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("audit-log-table")).toBeVisible();
  }

  @Step()
  async adminYouBadgeIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("you-badge")).toBeVisible();
  }

  @Step()
  async adminOwnRowHasDisabledActions(): Promise<void> {
    const youBadge = this.page.getByTestId("you-badge");
    const ownRow = youBadge.locator("xpath=ancestor::tr").first();
    await expect(ownRow.locator("button[disabled]").first()).toBeVisible();
  }

  @Step()
  async adminInviteFormSuccessIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("invite-form-success")).toBeVisible();
  }

  @Step()
  async adminInviteStatusBadgeIsVisible(status: string): Promise<void> {
    await expect(this.page.getByTestId(`status-badge-${status}`).first()).toBeVisible();
  }

  @Step()
  async adminConfirmDialogIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("confirm-dialog")).toBeVisible();
  }

  @Step()
  async avatarMenuAdminLinkIsVisible(): Promise<void> {
    await expect(this.el.topBar.elements.avatarMenuAdmin).toBeVisible();
  }

  // ── Sharing surface assertions ────────────────────────────────────────────

  @Step()
  async avatarMenuSharingLinkIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("avatar-menu-sharing")).toBeVisible();
  }

  @Step()
  async sharingPageIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("sharing-page")).toBeVisible();
  }

  @Step()
  async sharingGrantButtonIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("sharing-grant-button")).toBeVisible();
  }

  @Step()
  async sharingOutboundSectionIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("sharing-outbound-section")).toBeVisible();
  }

  @Step()
  async sharingInboundSectionIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("sharing-inbound-section")).toBeVisible();
  }

  @Step()
  async sharingGrantDialogIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("grant-share-dialog")).toBeVisible();
  }

  @Step()
  async sharingGrantEmailInputIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("grant-share-email-input")).toBeVisible();
  }

  @Step()
  async adminAuditLogTableContains(text: string): Promise<void> {
    const table = this.page.getByTestId("audit-log-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText(text);
  }

  @Step()
  async pageContainsText(text: string): Promise<void> {
    await expect(this.page.getByText(text).first()).toBeVisible();
  }
}
