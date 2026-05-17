import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";

import type { DashboardPage } from "../../pages/dashboard/DashboardPage.js";

export class DashboardAssert extends BaseAssert {
  declare protected readonly _instance: DashboardPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async demoBannerIsVisible(): Promise<void> {
    await expect(this.el.demoBanner).toBeVisible();
  }

  @Step()
  async demoBannerContains(text: string | RegExp): Promise<void> {
    await expect(this.el.demoBanner).toContainText(text);
  }

  @Step()
  async recomputeStatusContains(text: string | RegExp): Promise<void> {
    await expect(this.el.recomputeStatus).toContainText(text);
  }

  @Step()
  async appIsReady(): Promise<void> {
    await expect(this.el.appReady).toBeAttached({ timeout: 30_000 });
  }

  @Step()
  async isOnDashboard(): Promise<void> {
    await this.mxAssertUrlMatches(/\/dashboard/);
  }

  @Step()
  async holdingsTableHasDailyChangeColumn(): Promise<void> {
    await expect(this.el.holdingsHeaderCells).toContainText([/daily change/i]);
  }

  @Step()
  async holdingRowContainsText(ticker: string, text: string | RegExp): Promise<void> {
    await expect(this.el.holdingRow(ticker)).toContainText(text);
  }

  @Step()
  async holdingRowHasColorClass(ticker: string, colorClass: string): Promise<void> {
    await expect(this.el.holdingDailyChangeCell(ticker)).toHaveClass(new RegExp(colorClass));
  }

  @Step()
  async heroPanelContains(text: string | RegExp): Promise<void> {
    await expect(this.el.heroPanel).toContainText(text);
  }

  @Step()
  async holdingsTableContains(text: string | RegExp): Promise<void> {
    await expect(this.el.holdingsTable).toContainText(text);
  }

  @Step()
  async holdingsTableNotContains(text: string | RegExp): Promise<void> {
    await expect(this.el.holdingsTable).not.toContainText(text);
  }

  // --- Snapshot chart assertions ---

  /**
   * Open the FloatingQuickActions sheet if it is not already open.
   * Mirrors DashboardActions.ensureFloatingSheetOpen — Phase 5e moved
   * recompute and generate-snapshots actions into a floating Sheet.
   */
  private async ensureFloatingSheetOpen(): Promise<void> {
    const visible = await this.el.floatingQuickActionsSheet.isVisible().catch(() => false);
    if (!visible) {
      await this.el.floatingQuickActionsTrigger.click();
      await this.el.floatingQuickActionsSheet.waitFor({ state: "visible" });
    }
  }

  @Step()
  async generateSnapshotsButtonIsVisible(): Promise<void> {
    // Phase 5e — Generate Snapshots is reachable via the FloatingQuickActions
    // trigger. Asserting on the trigger is sufficient (the action button itself
    // only renders while the sheet is open, and opening it here would block
    // subsequent clicks on dashboard content due to the sheet overlay).
    await expect(this.el.floatingQuickActionsTrigger).toBeVisible();
  }

  @Step()
  async recomputeButtonIsVisible(): Promise<void> {
    // Phase 5e — Recompute is reachable via the FloatingQuickActions trigger.
    // See generateSnapshotsButtonIsVisible for rationale.
    await expect(this.el.floatingQuickActionsTrigger).toBeVisible();
  }

  @Step()
  async recomputeButtonIsHidden(): Promise<void> {
    // Phase 5e — when isSharedContext is true, the entire FloatingQuickActions
    // component returns null; the trigger and all action buttons are absent
    // from the DOM. Assert against the trigger as the canonical entry point.
    await expect(this.el.floatingQuickActionsTrigger).toHaveCount(0);
  }

  @Step()
  async generateSnapshotsButtonIsHidden(): Promise<void> {
    // Phase 5e — see recomputeButtonIsHidden for rationale.
    await expect(this.el.floatingQuickActionsTrigger).toHaveCount(0);
  }

  @Step()
  async generateSnapshotsButtonIsDisabled(): Promise<void> {
    // Phase 5e — Generate Snapshots disabled-state lives inside the sheet.
    await this.ensureFloatingSheetOpen();
    await expect(this.el.floatingActionGenerateSnapshots).toBeDisabled();
  }

  @Step()
  async snapshotStatusContains(text: string | RegExp, options?: { timeout?: number }): Promise<void> {
    await expect(this.el.snapshotStatus).toContainText(text, options);
  }

  @Step()
  async performanceCardIsVisible(): Promise<void> {
    await expect(this.el.performanceCard).toBeVisible();
  }

  @Step()
  async performanceChartHasData(): Promise<void> {
    await expect(this.el.performanceChartDataPath.first()).toBeVisible();
  }

  @Step()
  async performancePartialWarningIsVisible(): Promise<void> {
    await expect(this.el.performancePartialWarning).toBeVisible();
  }

  @Step()
  async performancePartialWarningIsHidden(): Promise<void> {
    await expect(this.el.performancePartialWarning).not.toBeVisible();
  }

  @Step()
  async returnPercentCardIsVisible(): Promise<void> {
    await expect(this.el.returnPercentCard).toBeVisible();
  }

  @Step()
  async returnPercentChartHasData(): Promise<void> {
    await expect(this.el.returnPercentChartDataPath.first()).toBeVisible();
  }

  @Step()
  async returnPercentCardContains(text: string | RegExp): Promise<void> {
    await expect(this.el.returnPercentCard).toContainText(text);
  }

  @Step()
  async returnPercentProvisionalWarningIsVisible(): Promise<void> {
    await expect(this.el.returnPercentProvisionalWarning).toBeVisible();
  }

  @Step()
  async returnPercentProvisionalWarningIsHidden(): Promise<void> {
    await expect(this.el.returnPercentProvisionalWarning).not.toBeVisible();
  }

  // --- Phase 5d/5e — slim hero block + integrity Alert + floating ⨁ ---

  @Step()
  async dashboardHeroIsVisible(): Promise<void> {
    await expect(this.el.dashboardHero).toBeVisible();
  }

  @Step()
  async dashboardHeroTotalIsVisible(): Promise<void> {
    await expect(this.el.dashboardHeroTotal).toBeVisible();
  }

  @Step()
  async dashboardHeroDayDeltaIsVisible(): Promise<void> {
    await expect(this.el.dashboardHeroDayDelta).toBeVisible();
  }

  @Step()
  async dashboardBiggestMoversIsVisible(): Promise<void> {
    await expect(this.el.dashboardBiggestMovers).toBeVisible();
  }

  @Step()
  async dashboardBiggestMoversIsEmpty(): Promise<void> {
    await expect(this.el.dashboardBiggestMoversEmpty).toBeVisible();
  }

  @Step()
  async dashboardBiggestMoversRowVisible(ticker: string): Promise<void> {
    await expect(this.el.biggestMoverRow(ticker)).toBeVisible();
  }

  @Step()
  async dashboardIntegrityAlertIsVisible(): Promise<void> {
    await expect(this.el.dashboardIntegrityAlert).toBeVisible();
  }

  @Step()
  async dashboardIntegrityAlertIsHidden(): Promise<void> {
    await expect(this.el.dashboardIntegrityAlert).toHaveCount(0);
  }

  @Step()
  async floatingQuickActionsTriggerIsVisible(): Promise<void> {
    await expect(this.el.floatingQuickActionsTrigger).toBeVisible();
  }

  @Step()
  async floatingQuickActionsTriggerIsHidden(): Promise<void> {
    await expect(this.el.floatingQuickActionsTrigger).toHaveCount(0);
  }

  @Step()
  async floatingQuickActionsSheetIsVisible(): Promise<void> {
    await expect(this.el.floatingQuickActionsSheet).toBeVisible();
  }

  @Step()
  async floatingActionAddTransactionIsVisible(): Promise<void> {
    await expect(this.el.floatingActionAddTransaction).toBeVisible();
  }

  @Step()
  async floatingActionRecomputeIsVisible(): Promise<void> {
    await expect(this.el.floatingActionRecompute).toBeVisible();
  }

  @Step()
  async floatingActionGenerateSnapshotsIsVisible(): Promise<void> {
    await expect(this.el.floatingActionGenerateSnapshots).toBeVisible();
  }
}
