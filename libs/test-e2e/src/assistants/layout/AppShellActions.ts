import { expect } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { AppShellPage } from "../../pages/layout/AppShellPage.js";
import type { TSidebarDestination } from "../../pages/layout/SideNavigationComponent.js";

export class AppShellActions extends AppBaseActions {
  declare protected readonly _instance: AppShellPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToRoute(path: string): Promise<void> {
    await this.mxNavigateToRoute(path, TestEnv.appBaseUrl);
  }

  @Step()
  async openSettingsDrawer(): Promise<void> {
    await this.mxWaitForAppReady();
    await this.uiActions.click.perform(this.el.topBar.elements.avatarButton);
    await this.uiActions.wait.perform(this.el.topBar.elements.avatarMenuSettings);
    await this.uiActions.click.perform(this.el.topBar.elements.avatarMenuSettings);
    await this.verifyDrawerOpened();
  }

  private async verifyDrawerOpened(): Promise<void> {
    await expect(this.el.settings.drawer).toBeVisible();
    await expect(this.page).toHaveURL(/drawer=settings/);
  }

  @Step()
  async setViewport(width: number, height: number): Promise<void> {
    await this.mxSetViewportSize(width, height);
  }

  @Step()
  async navigateViaSidebar(destination: TSidebarDestination): Promise<void> {
    await this.uiActions.click.perform(this.el.sideNavigation.elements[destination]);
    await this.mxWaitForAppReady();
  }

  @Step()
  async reloadPage(): Promise<void> {
    await this.mxReloadPage();
  }

  @Step()
  async reloadShellPage(): Promise<void> {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await expect(this.el.appReady).toBeAttached({ timeout: 20_000 });
    await expect(this.el.topBar.elements.title).toBeVisible({ timeout: 20_000 });
  }

  @Step()
  async toggleDesktopSidebar(): Promise<void> {
    await this.uiActions.click.perform(this.el.desktopNavToggle);
  }

  @Step()
  async navigateViaMobileSidebar(destination: TSidebarDestination): Promise<void> {
    await this.uiActions.click.perform(this.el.mobileSidebar.getByTestId(`sidebar-link-${destination}`));
    await this.mxWaitForAppReady();
  }

  @Step()
  async openMobileNavigation(): Promise<void> {
    await this.uiActions.click.perform(this.el.mobileNavToggle);
    await this.uiActions.wait.perform(this.el.mobileSidebar);
  }

  @Step()
  async fillDesktopSearch(value: string): Promise<void> {
    await this.mxFill(this.el.search.elements.desktopSearch, value);
  }

  @Step()
  async openMobileSearch(): Promise<void> {
    await this.uiActions.click.perform(this.el.search.elements.mobileSearchButton);
    await this.uiActions.wait.perform(this.el.search.elements.mobileSheet);
  }

  @Step()
  async fillMobileSearch(value: string): Promise<void> {
    await this.mxFill(this.el.search.elements.mobileSheetInput, value);
  }

  @Step()
  async clickQuickSearchRoute(route: string, panel: "desktop" | "mobile" = "desktop"): Promise<void> {
    const container = panel === "desktop"
      ? this.el.search.elements.desktopResults
      : this.el.search.elements.mobileResults;
    await this.uiActions.click.perform(container.getByTestId(`quick-search-item-route-${route}`));
  }

  @Step()
  async clickQuickSearchTicker(symbol: string): Promise<void> {
    await this.uiActions.click.perform(this.el.search.elements.desktopResults.getByRole("button", { name: new RegExp(symbol) }));
  }

  @Step()
  async openAvatarMenu(): Promise<void> {
    await this.mxWaitForAppReady();
    await this.uiActions.click.perform(this.el.topBar.elements.avatarButton);
  }

  @Step()
  async focusAvatarButton(): Promise<void> {
    await this.el.topBar.elements.avatarButton.focus();
  }

  @Step()
  async clickAvatarMenuSignOut(): Promise<void> {
    await this.uiActions.click.perform(this.el.topBar.elements.avatarMenuSignOut);
  }

  @Step()
  async clickAvatarMenuSharing(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("avatar-menu-sharing"));
  }

  @Step()
  async clickSharingGrantButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("sharing-grant-button"));
  }

  @Step()
  async clickAdminAuditToggleFilters(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("toggle-filters"));
  }

  @Step()
  async clickAdminAuditActionFilter(action: string): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId(`action-filter-${action}`));
  }

  @Step()
  async clickNotificationBell(): Promise<void> {
    await this.uiActions.click.perform(this.el.topBar.elements.notificationBell);
  }

  @Step()
  async clickNotificationMarkAllRead(): Promise<void> {
    await this.uiActions.click.perform(this.el.topBar.elements.notificationMarkAllRead);
  }

  @Step()
  async clickNotificationItem(notificationId: string): Promise<void> {
    await this.uiActions.click.perform(
      this.page.getByTestId(`notification-item-${notificationId}`),
    );
  }

  @Step()
  async clickNotificationDismiss(notificationId: string): Promise<void> {
    // Hover to make dismiss button visible, then click
    await this.page.getByTestId(`notification-item-${notificationId}`).hover();
    await this.uiActions.click.perform(
      this.page.getByTestId(`notification-dismiss-${notificationId}`),
    );
  }

  @Step()
  async clickOutsideDropdown(): Promise<void> {
    // Click on the page body outside the dropdown to close it
    await this.page.locator("body").click({ position: { x: 10, y: 10 } });
  }

  // ── Admin portal actions ──────────────────────────────────────────────────

  @Step()
  async fillAdminInviteForm(email: string, role: string): Promise<void> {
    await this.mxFill(this.page.getByTestId("invite-email-input"), email);
    await this.mxSelectOption(this.page.getByTestId("invite-role-select"), role);
  }

  @Step()
  async submitAdminInviteForm(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("invite-submit"));
  }

  @Step()
  async clickFirstRevokeButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.locator("[data-testid^='revoke-btn-']").first());
  }

  @Step()
  async confirmDialog(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("confirm-dialog-confirm"));
  }
}
