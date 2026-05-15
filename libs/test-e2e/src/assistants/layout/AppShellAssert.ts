import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";

import type { AppShellPage } from "../../pages/layout/AppShellPage.js";

export class AppShellAssert extends BaseAssert {
  declare protected readonly _instance: AppShellPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async topBarTitleContains(text: string): Promise<void> {
    await expect(this.el.topBar.title).toContainText(text);
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
    await expect(this.el.search.desktopSearch).toBeVisible();
  }

  @Step()
  async desktopSearchPaddingLeftAtLeast(expectedMinimum: number): Promise<void> {
    const paddingLeft = await this.el.search.desktopSearch.evaluate(
      (input) => Number.parseFloat(getComputedStyle(input).paddingLeft),
    );
    await this.mxAssertGreaterThanOrEqual(paddingLeft, expectedMinimum, "desktop search left padding");
  }

  @Step()
  async searchResultsAreVisible(): Promise<void> {
    await expect(this.el.search.desktopResults).toBeVisible();
  }

  @Step()
  async quickSearchTickerIsVisible(symbol: string): Promise<void> {
    await expect(this.el.search.desktopResults.getByRole("button", { name: new RegExp(symbol) })).toBeVisible();
  }

  @Step()
  async mobileNavToggleIsVisible(): Promise<void> {
    await expect(this.el.mobileNavToggle).toBeVisible();
  }

  @Step()
  async mobileSearchButtonIsVisible(): Promise<void> {
    await expect(this.el.search.mobileSearchButton).toBeVisible();
  }

  @Step()
  async mobileSearchSheetIsVisible(): Promise<void> {
    await expect(this.el.search.mobileSheet).toBeVisible();
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
    await expect(this.el.topBar.avatarButton).toBeFocused();
  }

  @Step()
  async appIsReady(): Promise<void> {
    await expect(this.el.appReady).toBeAttached({ timeout: 30_000 });
  }

  // KZO-183: assert the global error banner contains the given text/pattern.
  @Step()
  async globalErrorContains(text: string | RegExp): Promise<void> {
    await expect(this.el.globalError).toContainText(text);
  }

  @Step()
  async statusToastContains(text: string | RegExp): Promise<void> {
    await expect(this.el.testId("context-status")).toContainText(text);
  }

  @Step()
  async impersonationBannerContains(text: string | RegExp): Promise<void> {
    await expect(this.el.impersonationBanner).toContainText(text);
  }

  @Step()
  async impersonationCountdownIsVisible(): Promise<void> {
    await expect(this.el.impersonationCountdown).toBeVisible();
  }

  @Step()
  async impersonationBannerIsHidden(): Promise<void> {
    await expect(this.el.impersonationBanner).toHaveCount(0);
  }

  @Step()
  async clientApiErrorToastContains(text: string | RegExp): Promise<void> {
    await expect(this.el.clientApiErrorToast).toContainText(text);
  }

  @Step()
  async clientApiErrorIsAbsent(): Promise<void> {
    await expect(this.el.testId("client-api-error")).toHaveCount(0);
  }

  @Step()
  async avatarMenuShowsSettingsAndSignOut(): Promise<void> {
    await expect(this.el.topBar.avatarMenuSettings).toBeVisible();
    await expect(this.el.topBar.avatarMenuSignOut).toBeVisible();
  }

  @Step()
  async avatarIdentityContains(text: string | RegExp): Promise<void> {
    await expect(this.el.topBar.avatarMenuIdentity).toContainText(text);
  }

  @Step()
  async avatarImageSourceContains(text: string): Promise<void> {
    await expect(this.el.avatarImage).toBeVisible();
    expect(await this.el.avatarImage.getAttribute("src")).toContain(text);
  }

  @Step()
  async avatarShowsNoImage(): Promise<void> {
    await expect(this.el.avatarImage).toHaveCount(0);
  }

  @Step()
  async avatarInitialsMatch(expected: RegExp): Promise<void> {
    await expect(this.el.avatarInitials).toHaveText(expected);
  }

  @Step()
  async notificationBellIsVisible(): Promise<void> {
    await expect(this.el.topBar.notificationBell).toBeVisible();
  }

  @Step()
  async notificationBadgeIsHidden(): Promise<void> {
    await expect(this.el.topBar.notificationBadge).toBeHidden();
  }

  @Step()
  async notificationBadgeCountIs(expected: number): Promise<void> {
    await expect(this.el.topBar.notificationBadge).toBeVisible();
    await expect(this.el.topBar.notificationBadge).toHaveText(String(expected));
  }

  @Step()
  async notificationDropdownIsVisible(): Promise<void> {
    await expect(this.el.topBar.notificationDropdown).toBeVisible();
  }

  @Step()
  async notificationDropdownIsHidden(): Promise<void> {
    await expect(this.el.topBar.notificationDropdown).toBeHidden();
  }

  @Step()
  async notificationEmptyStateIsVisible(): Promise<void> {
    await expect(this.el.topBar.notificationEmpty).toBeVisible();
  }

  @Step()
  async notificationItemIsVisible(notificationId: string): Promise<void> {
    await expect(this.el.testId(`notification-item-${notificationId}`)).toBeVisible();
  }

  @Step()
  async notificationItemIsHidden(notificationId: string): Promise<void> {
    await expect(this.el.testId(`notification-item-${notificationId}`)).toBeHidden();
  }

  @Step()
  async notificationUnreadDotIsVisible(notificationId: string): Promise<void> {
    await expect(this.el.testId(`notification-unread-${notificationId}`)).toBeVisible();
  }

  @Step()
  async notificationUnreadDotIsHidden(notificationId: string): Promise<void> {
    await expect(this.el.testId(`notification-unread-${notificationId}`)).toBeHidden();
  }

  // ── Admin portal assertions ───────────────────────────────────────────────

  @Step()
  async adminUsersPageIsVisible(): Promise<void> {
    await expect(this.el.testId("admin-users-page")).toBeVisible();
  }

  @Step()
  async adminInvitesPageIsVisible(): Promise<void> {
    await expect(this.el.testId("admin-invites-page")).toBeVisible();
  }

  @Step()
  async adminAuditLogPageIsVisible(): Promise<void> {
    await expect(this.el.testId("admin-audit-log-page")).toBeVisible();
  }

  @Step()
  async adminUsersTableIsVisible(): Promise<void> {
    await expect(this.el.testId("users-table")).toBeVisible();
  }

  @Step()
  async adminInvitesTableIsVisible(): Promise<void> {
    // Fresh test users may have zero invites — accept either the table or the empty state
    const table = this.el.testId("invites-table");
    const empty = this.el.text("No invites found.");
    await expect(table.or(empty)).toBeVisible();
  }

  @Step()
  async adminAuditLogTableIsVisible(): Promise<void> {
    await expect(this.el.testId("audit-log-table")).toBeVisible();
  }

  @Step()
  async adminYouBadgeIsVisible(): Promise<void> {
    await expect(this.el.testId("you-badge")).toBeVisible();
  }

  @Step()
  async adminOwnRowHasDisabledActions(): Promise<void> {
    await expect(this.el.adminOwnDisabledActionButton).toBeVisible();
  }

  @Step()
  async adminInviteFormSuccessIsVisible(): Promise<void> {
    await expect(this.el.testId("invite-form-success")).toBeVisible();
  }

  @Step()
  async adminInviteStatusBadgeIsVisible(status: string): Promise<void> {
    await expect(this.el.testId(`status-badge-${status}`).first()).toBeVisible();
  }

  @Step()
  async adminConfirmDialogIsVisible(): Promise<void> {
    await expect(this.el.testId("confirm-dialog")).toBeVisible();
  }

  @Step()
  async avatarMenuAdminLinkIsVisible(): Promise<void> {
    await expect(this.el.topBar.avatarMenuAdmin).toBeVisible();
  }

  // ── Admin settings assertions ─────────────────────────────────────────────

  @Step()
  async adminSettingsPageIsVisible(): Promise<void> {
    await expect(this.el.testId("admin-settings-page")).toBeVisible();
  }

  @Step()
  async adminSettingsSidebarLinkIsCurrent(): Promise<void> {
    await expect(this.el.testId("admin-sidebar-link-settings").first()).toHaveAttribute(
      "aria-current",
      "page",
    );
  }

  @Step()
  async adminSettingsOverrideToggleChecked(checked: boolean): Promise<void> {
    const toggle = this.el.testId("admin-settings-repair-cooldown-minutes-toggle");
    if (checked) {
      await expect(toggle).toBeChecked();
    } else {
      await expect(toggle).not.toBeChecked();
    }
  }

  @Step()
  async adminSettingsEnvDefaultBadgeIsVisible(): Promise<void> {
    const badge = this.el.testId("admin-settings-repair-cooldown-minutes-env-default-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/Using env default/i);
  }

  @Step()
  async adminSettingsEnvDefaultBadgeIsHidden(): Promise<void> {
    await expect(this.el.testId("admin-settings-repair-cooldown-minutes-env-default-badge")).toHaveCount(0);
  }

  @Step()
  async adminSettingsMinutesInputIsVisible(): Promise<void> {
    await expect(this.el.testId("admin-settings-repair-cooldown-minutes-input")).toBeVisible();
  }

  @Step()
  async adminSettingsMinutesInputIsHidden(): Promise<void> {
    await expect(this.el.testId("admin-settings-repair-cooldown-minutes-input")).toHaveCount(0);
  }

  @Step()
  async adminSettingsMinutesInputHasValue(value: string): Promise<void> {
    await expect(this.el.testId("admin-settings-repair-cooldown-minutes-input")).toHaveValue(value);
  }

  @Step()
  async adminSettingsSaveSuccessIsVisible(): Promise<void> {
    await expect(this.el.testId("admin-settings-repair-cooldown-minutes-success")).toBeVisible();
  }

  @Step()
  async adminSettingsLastUpdatedIsVisible(): Promise<void> {
    await expect(this.el.testId("admin-settings-last-updated")).toBeVisible();
  }

  @Step()
  async adminSettingsValidationErrorIsVisible(): Promise<void> {
    await expect(this.el.testId("admin-settings-repair-cooldown-minutes-validation-error")).toBeVisible();
  }

  @Step()
  async adminSettingsSaveButtonIsDisabled(): Promise<void> {
    await expect(this.el.testId("admin-settings-repair-cooldown-minutes-save-button")).toBeDisabled();
  }

  // ── KZO-159 — Admin timeframe defaults section assertions ─────────────────
  //
  // The active-vs-available state is encoded on the button's `data-active`
  // attribute. "Active" chips (`data-active="true"`) are the saved/pending
  // ranges; "Available" chips (`data-active="false"`) are predefined chips
  // not currently selected.
  //
  // admin-ui-bugs: the Timeframe Defaults section moved INSIDE the
  // `admin-settings-panel-display-defaults` tab. Every helper that reads
  // `timeframe-defaults-section` or `timeframe-chip-*` calls
  // `ensureDisplayDefaultsTabActive()` first so caller specs do NOT need
  // to learn about the new tab.

  private async ensureDisplayDefaultsTabActive(): Promise<void> {
    const panel = this.el.testId("admin-settings-panel-display-defaults");
    if (await panel.isVisible().catch(() => false)) return;
    const trigger = this.el.testId("admin-settings-tab-display-defaults");
    if (await trigger.isVisible().catch(() => false)) {
      await this.uiActions.click.perform(trigger);
      await panel.waitFor({ state: "visible" }).catch(() => undefined);
    }
  }

  @Step()
  async adminTimeframeSectionIsVisible(): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    await expect(this.el.testId("timeframe-defaults-section")).toBeVisible();
  }

  @Step()
  async adminTimeframeChipIsActive(range: string): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    const chip = this.el.testId(`timeframe-chip-${range}`);
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-active", "true");
  }

  @Step()
  async adminTimeframeChipIsInactive(range: string): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    // Either the chip is rendered as an "available" predefined chip
    // (`data-active="false"`), or it is not rendered at all — both
    // satisfy "not in the active list."
    const chip = this.el.testId(`timeframe-chip-${range}`);
    const count = await chip.count();
    if (count === 0) return;
    await expect(chip).toHaveAttribute("data-active", "false");
  }

  @Step()
  async adminTimeframeChipIsAbsent(range: string): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    await expect(this.el.testId(`timeframe-chip-${range}`)).toHaveCount(0);
  }

  @Step()
  async adminTimeframeChipsInOrder(expected: string[]): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    const count = await this.el.adminActiveTimeframeChips.count();
    const actual: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const testId = await this.el.adminActiveTimeframeChips.nth(i).getAttribute("data-testid");
      if (testId?.startsWith("timeframe-chip-")) {
        actual.push(testId.slice("timeframe-chip-".length));
      }
    }
    expect(actual, "active timeframe chip order").toEqual(expected);
  }

  @Step()
  async adminTimeframeValidationErrorIsVisible(): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    await expect(this.el.testId("timeframe-validation-error")).toBeVisible();
  }

  @Step()
  async adminTimeframeValidationErrorIsHidden(): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    await expect(this.el.testId("timeframe-validation-error")).toHaveCount(0);
  }

  @Step()
  async adminTimeframeSaveButtonIsEnabled(): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    await expect(this.el.testId("timeframe-save-button")).toBeEnabled();
  }

  @Step()
  async adminTimeframeSaveButtonIsDisabled(): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    await expect(this.el.testId("timeframe-save-button")).toBeDisabled();
  }

  @Step()
  async adminTimeframeSaveSuccessIsVisible(): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    await expect(this.el.testId("timeframe-save-success")).toBeVisible();
  }

  @Step()
  async adminTimeframeDragHandleIsEnabled(range: string): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    // Waits for the dnd-kit SortableRangeList to fully hydrate on the client.
    // Pre-mount (SSR fallback) renders the drag handle as `disabled`; post-mount
    // (isMounted=true) renders it as enabled with live dnd-kit listeners.
    await expect(this.el.testId(`timeframe-drag-handle-${range}`)).toBeEnabled();
  }

  @Step()
  async adminTimeframeFirstActiveChipIs(range: string): Promise<void> {
    await this.ensureDisplayDefaultsTabActive();
    await expect(this.el.adminFirstActiveTimeframeChip)
      .toHaveAttribute("data-testid", `timeframe-chip-${range}`);
  }

  // NOTE: adminTimeframeChipUpButtonIsDisabled / adminTimeframeChipDownButtonIsDisabled
  // removed in KZO-161 — the ↑↓ buttons were replaced by dnd-kit drag handles
  // in F4a; [timeframe-H] test dropped. Drag handle visibility is asserted via
  // `timeframeDragHandleIsVisible` below.

  // ── Sharing surface assertions ────────────────────────────────────────────

  @Step()
  async avatarMenuSharingLinkIsVisible(): Promise<void> {
    await expect(this.el.testId("avatar-menu-sharing")).toBeVisible();
  }

  @Step()
  async sharingPageIsVisible(): Promise<void> {
    await expect(this.el.testId("sharing-page")).toBeVisible();
  }

  @Step()
  async sharingGrantButtonIsVisible(): Promise<void> {
    await expect(this.el.testId("sharing-grant-button")).toBeVisible();
  }

  @Step()
  async sharingOutboundSectionIsVisible(): Promise<void> {
    await expect(this.el.testId("sharing-outbound-section")).toBeVisible();
  }

  @Step()
  async sharingInboundSectionIsVisible(): Promise<void> {
    await expect(this.el.testId("sharing-inbound-section")).toBeVisible();
  }

  @Step()
  async sharingGrantDialogIsVisible(): Promise<void> {
    await expect(this.el.testId("grant-share-dialog")).toBeVisible();
  }

  @Step()
  async sharingGrantEmailInputIsVisible(): Promise<void> {
    await expect(this.el.testId("grant-share-email-input")).toBeVisible();
  }

  @Step()
  async adminAuditLogTableContains(text: string): Promise<void> {
    const table = this.el.testId("audit-log-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText(text);
  }

  @Step()
  async pageContainsText(text: string): Promise<void> {
    await expect(this.el.text(text).first()).toBeVisible();
  }

  // ── KZO-159 → KZO-161 — Dashboard performance range button assertions ──────
  //
  // KZO-161 (F4) removed the hero pill row from RouteHeroPanel. The sole range
  // pill surface is now PortfolioTrendCard: `dashboard-performance-range-${range}`.
  //
  // `dashboardHeroRangeButtonIsVisible` / `dashboardHeroRangeButtonIsAbsent`
  // have been deleted — those testids no longer exist in the DOM.
  //
  // The `effectiveRanges` state in AppShell is populated from
  // `GET /user-preferences/effective-ranges` (3-tier resolver: user → admin →
  // default). These helpers let E2E tests verify that the admin-configured or
  // user-configured list actually drives the rendered buttons — guarding against
  // accidental re-hardcoding to DEFAULT_DASHBOARD_PERFORMANCE_RANGES.

  @Step()
  async dashboardPerformanceRangeButtonIsVisible(range: string): Promise<void> {
    await expect(
      this.el.testId(`dashboard-performance-range-${range.toLowerCase()}`),
    ).toBeVisible();
  }

  @Step()
  async dashboardPerformanceRangeButtonIsAbsent(range: string): Promise<void> {
    await expect(
      this.el.testId(`dashboard-performance-range-${range.toLowerCase()}`),
    ).toHaveCount(0);
  }

  // ── KZO-161 — User timeframe customize popover assertions ─────────────────

  @Step()
  async timeframeGearButtonIsVisible(): Promise<void> {
    await expect(this.el.testId("timeframe-gear-btn")).toBeVisible();
  }

  @Step()
  async timeframeCustomizePopoverIsVisible(): Promise<void> {
    await expect(this.el.testId("timeframe-customize-popover")).toBeVisible();
  }

  @Step()
  async timeframeCustomizePopoverIsHidden(): Promise<void> {
    await expect(this.el.testId("timeframe-customize-popover")).toHaveCount(0);
  }

  @Step()
  async timeframeCustomizeRowIsVisible(range: string): Promise<void> {
    await expect(this.el.testId(`timeframe-customize-row-${range}`)).toBeVisible();
  }

  @Step()
  async timeframeCustomizeRowIsAbsent(range: string): Promise<void> {
    await expect(this.el.testId(`timeframe-customize-row-${range}`)).toHaveCount(0);
  }

  @Step()
  async timeframeDragHandleIsVisible(range: string): Promise<void> {
    await expect(this.el.testId(`timeframe-drag-handle-${range}`)).toBeVisible();
  }

  @Step()
  async timeframeSaveButtonIsEnabled(): Promise<void> {
    await expect(this.el.testId("timeframe-save-btn")).toBeEnabled();
  }

  @Step()
  async timeframeToggleIsEnabled(range: string): Promise<void> {
    const toggle = this.el.testId(`timeframe-toggle-${range}`);
    await expect(toggle).toBeVisible();
    // Toggle is "enabled" = checked/active
    await expect(toggle).toHaveAttribute("data-active", "true");
  }

  @Step()
  async timeframeToggleIsDisabled(range: string): Promise<void> {
    const toggle = this.el.testId(`timeframe-toggle-${range}`);
    await expect(toggle).toBeVisible();
    // Toggle is "disabled" = unchecked/inactive
    await expect(toggle).toHaveAttribute("data-active", "false");
  }

  @Step()
  async timeframeCustomizeRowsInOrder(expected: string[]): Promise<void> {
    const count = await this.el.timeframeCustomizeRows.count();
    const actual: string[] = [];
    for (let i = 0; i < count; i++) {
      const testId = await this.el.timeframeCustomizeRows.nth(i).getAttribute("data-testid");
      if (testId?.startsWith("timeframe-customize-row-")) {
        actual.push(testId.slice("timeframe-customize-row-".length));
      }
    }
    expect(actual, "timeframe customize row order").toEqual(expected);
  }

  // ── KZO-161 — Settings Drawer Display tab assertions ──────────────────────

  @Step()
  async settingsDisplayTabIsVisible(): Promise<void> {
    await expect(this.el.testId("settings-tab-display")).toBeVisible();
  }

  @Step()
  async displayTimeframesSectionIsVisible(): Promise<void> {
    await expect(this.el.testId("display-timeframes-section")).toBeVisible();
  }

  @Step()
  async displayLayoutSectionIsVisible(): Promise<void> {
    await expect(this.el.testId("display-layout-section")).toBeVisible();
  }

  // KZO-162 — per-page Reset buttons (4 always-visible buttons in Display tab).

  @Step()
  async resetAllLayoutsButtonIsVisible(): Promise<void> {
    await expect(this.el.testId("reset-all-layouts-btn")).toBeVisible();
  }

  @Step()
  async resetDashboardLayoutButtonIsVisible(): Promise<void> {
    await expect(this.el.testId("reset-dashboard-layout-btn")).toBeVisible();
  }

  @Step()
  async resetTransactionsLayoutButtonIsVisible(): Promise<void> {
    await expect(this.el.testId("reset-transactions-layout-btn")).toBeVisible();
  }

  @Step()
  async resetPortfolioLayoutButtonIsVisible(): Promise<void> {
    await expect(this.el.testId("reset-portfolio-layout-btn")).toBeVisible();
  }

  // ── KZO-161 — Card reorder assertions (F5) ───────────────────────────────

  @Step()
  async cardIsVisible(slug: string): Promise<void> {
    await expect(this.el.testId(`card-${slug}`)).toBeVisible();
  }

  @Step()
  async cardDragHandleIsVisible(slug: string): Promise<void> {
    await expect(this.el.testId(`card-drag-handle-${slug}`)).toBeVisible();
  }

  /**
   * Assert that the cards appear in the given order based on their DOM
   * position (vertical order by bounding box top coordinate).
   */
  @Step()
  async cardsAreInOrder(expectedSlugs: string[]): Promise<void> {
    const cards = await Promise.all(
      expectedSlugs.map(async (slug) => {
        const el = this.el.testId(`card-${slug}`);
        const box = await el.boundingBox();
        return { slug, top: box?.y ?? 0 };
      }),
    );
    const sorted = [...cards].sort((a, b) => a.top - b.top);
    const actualOrder = sorted.map((c) => c.slug);
    expect(actualOrder, "card render order").toEqual(expectedSlugs);
  }

  /**
   * Assert a card is rendered with xl:col-span-2 (full-width) by checking
   * that its bounding box width is wider than a half-width card would be.
   * This is a heuristic check only valid at xl viewport (≥1280px).
   * Uses computed style instead to check the span directly.
   */
  @Step()
  async cardIsFullWidth(slug: string): Promise<void> {
    const gridColSpan = await this.el.testId(`card-${slug}`).evaluate((el) => {
      return getComputedStyle(el).gridColumn;
    });
    // xl:col-span-2 resolves to "span 2 / span 2" or similar
    expect(gridColSpan, `card-${slug} grid-column`).toMatch(/span\s*2/);
  }
}
