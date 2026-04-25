import { expect, type Locator } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { AppShellPage } from "../../pages/layout/AppShellPage.js";
import type { TSidebarDestination } from "../../pages/layout/SideNavigationComponent.js";

/**
 * dnd-kit drag helper — uses Playwright's built-in `locator.dragTo()`.
 *
 * Design-doc §3 spike confirmed Stage 1 (locator.dragTo) works with dnd-kit
 * defaults — no mouse.down/move/up workaround needed.
 *
 * After `dragTo`, the mouse cursor is left at the target position. dnd-kit's
 * PointerSensor can briefly retain pointer-capture state for a few ms after
 * drop, intercepting the next click and preventing the React onClick handler
 * from firing on subsequent buttons (timeframe-save-button, card buttons,
 * etc.). The post-drop `page.mouse.move(0, 0)` moves the cursor away to
 * release any lingering capture before the test continues. Without this
 * stabilization, [timeframe-G] flakes ~25% of runs even though the assertion
 * before the click confirms the React state has committed.
 */
async function dndKitDrag(source: Locator, target: Locator): Promise<void> {
  await source.dragTo(target);
  await target.page().mouse.move(0, 0);
}

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

  // ── Admin settings actions ────────────────────────────────────────────────

  @Step()
  async toggleAdminSettingsOverride(enable: boolean): Promise<void> {
    const toggle = this.page.getByTestId("admin-settings-override-toggle");
    if (enable) {
      await toggle.check();
    } else {
      await toggle.uncheck();
    }
  }

  @Step()
  async fillAdminSettingsMinutes(value: string): Promise<void> {
    await this.mxFill(this.page.getByTestId("admin-settings-minutes-input"), value);
  }

  @Step()
  async clickAdminSettingsSave(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("admin-settings-save-button"));
  }

  // ── KZO-159 — Admin timeframe defaults section actions ────────────────────
  //
  // Each active range is rendered as a row:
  //   • `timeframe-chip-${range}`          — toggle-off (clicking removes it)
  //   • `timeframe-drag-handle-${range}`   — dnd-kit drag handle (KZO-161 F4a)
  //
  // NOTE: `timeframe-chip-up-${range}` and `timeframe-chip-down-${range}`
  // have been removed — the ↑↓ buttons were replaced by dnd-kit drag handles
  // in KZO-161 F4a. Use `dragAdminTimeframeChip()` instead.
  //
  // Predefined chips not in the active list appear in the "Available" row
  // with the same `timeframe-chip-${range}` testid but `data-active="false"`.

  @Step()
  async clickAdminTimeframeChip(range: string): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId(`timeframe-chip-${range}`));
  }

  /**
   * Drag a timeframe chip to reorder it in the admin settings list.
   * Uses the dnd-kit drag handle testid `timeframe-drag-handle-{range}`.
   * `from` = the range to move; `to` = the range whose position to drop onto.
   */
  @Step()
  async dragAdminTimeframeChip(from: string, to: string): Promise<void> {
    await dndKitDrag(
      this.page.getByTestId(`timeframe-drag-handle-${from}`),
      this.page.getByTestId(`timeframe-drag-handle-${to}`),
    );
  }

  @Step()
  async fillAdminTimeframeAddInput(value: string): Promise<void> {
    await this.mxFill(this.page.getByTestId("timeframe-add-input"), value);
  }

  @Step()
  async clickAdminTimeframeAddButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("timeframe-add-button"));
  }

  @Step()
  async clickAdminTimeframeReset(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("timeframe-reset-button"));
  }

  @Step()
  async clickAdminTimeframeSave(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("timeframe-save-button"));
  }

  // ── KZO-161 — User timeframe customization popover actions ────────────────

  /**
   * Click the gear button on PortfolioTrendCard to open the customize popover.
   */
  @Step()
  async openTimeframeCustomize(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("timeframe-gear-btn"));
    await expect(this.page.getByTestId("timeframe-customize-popover")).toBeVisible();
  }

  /**
   * Drag a range row within the customize popover to reorder it.
   * `from` = the range to move; `to` = the range whose position to drop onto.
   */
  @Step()
  async dragTimeframeRange(from: string, to: string): Promise<void> {
    await dndKitDrag(
      this.page.getByTestId(`timeframe-drag-handle-${from}`),
      this.page.getByTestId(`timeframe-drag-handle-${to}`),
    );
  }

  /**
   * Toggle per-row range visibility inside the customize popover or Display tab.
   * Clicks the `timeframe-toggle-{range}` checkbox/button.
   */
  @Step()
  async toggleTimeframeRange(range: string): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId(`timeframe-toggle-${range}`));
  }

  @Step()
  async fillTimeframeCustomInput(value: string): Promise<void> {
    await this.mxFill(this.page.getByTestId("timeframe-custom-input"), value);
  }

  @Step()
  async clickTimeframeAddButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("timeframe-add-btn"));
  }

  /** Save button in the user-facing customize popover / Display tab. */
  @Step()
  async clickTimeframeSaveButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("timeframe-save-btn"));
  }

  /** Reset button in the user-facing customize popover / Display tab. */
  @Step()
  async clickTimeframeResetButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("timeframe-reset-btn"));
  }

  // ── KZO-161 — Settings Drawer Display tab actions ─────────────────────────

  /** Open the Display tab inside the SettingsDrawer. */
  @Step()
  async clickSettingsDisplayTab(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("settings-tab-display"));
    await expect(this.page.getByTestId("display-timeframes-section")).toBeVisible();
  }

  /**
   * KZO-162 — Click the global "Reset all layouts" button in the Display tab.
   * Sends PATCH /user-preferences { cardOrder: null } (clears every page's
   * saved order atomically).
   */
  @Step()
  async clickResetAllLayoutsButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("reset-all-layouts-btn"));
  }

  /**
   * KZO-162 — Click the per-page "Reset dashboard layout" button. Sends
   * PATCH /user-preferences { cardOrder: { dashboard: null } } (clears just
   * the dashboard sub-key while preserving the others).
   */
  @Step()
  async clickResetDashboardLayoutButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("reset-dashboard-layout-btn"));
  }

  /**
   * KZO-162 — Click the per-page "Reset transactions layout" button. Sends
   * PATCH /user-preferences { cardOrder: { transactions: null } }.
   */
  @Step()
  async clickResetTransactionsLayoutButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("reset-transactions-layout-btn"));
  }

  /**
   * KZO-162 — Click the per-page "Reset portfolio layout" button. Sends
   * PATCH /user-preferences { cardOrder: { portfolio: null } }.
   */
  @Step()
  async clickResetPortfolioLayoutButton(): Promise<void> {
    await this.uiActions.click.perform(this.page.getByTestId("reset-portfolio-layout-btn"));
  }

  // ── KZO-161 — Card reorder actions (F5) ──────────────────────────────────

  /**
   * Drag a dashboard card to a new position.
   * `from` = slug of the card to move; `to` = slug of the destination card.
   * Uses `card-drag-handle-{slug}` testids.
   */
  @Step()
  async dragCard(from: string, to: string): Promise<void> {
    await dndKitDrag(
      this.page.getByTestId(`card-drag-handle-${from}`),
      this.page.getByTestId(`card-drag-handle-${to}`),
    );
  }
}
