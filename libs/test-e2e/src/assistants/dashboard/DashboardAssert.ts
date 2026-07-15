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
    await expect(this.el.holdingsHeaderCells.first()).toContainText(/daily change/i);
  }

  @Step()
  async holdingRowContainsText(ticker: string, text: string | RegExp): Promise<void> {
    await expect(this.el.holdingRow(ticker)).toContainText(text);
  }

  @Step()
  async holdingRowHasColorClass(ticker: string, colorClass: string): Promise<void> {
    await expect(this.el.holdingDailyChangeCell(ticker)).toHaveClass(classTokenPattern(colorClass));
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
  // Phase 5e moved recompute and generate-snapshots actions into the
  // FloatingQuickActions sheet. Visibility assertions proxy on the
  // floating trigger (presence == actions reachable); opening the sheet
  // for a passive check would leave its overlay blocking subsequent
  // dashboard clicks. The actual click+open flow lives in
  // DashboardActions.clickRecompute / clickGenerateSnapshots.

  @Step()
  async generateSnapshotsButtonIsVisible(): Promise<void> {
    await expect(this.el.floatingQuickActionsTrigger).toBeVisible();
  }

  @Step()
  async recomputeButtonIsVisible(): Promise<void> {
    await expect(this.el.floatingQuickActionsTrigger).toBeVisible();
  }

  @Step()
  async recomputeButtonIsHidden(): Promise<void> {
    // When isSharedContext is true, FloatingQuickActions returns null;
    // the trigger and all action buttons are absent from the DOM.
    await expect(this.el.floatingQuickActionsTrigger).toHaveCount(0);
  }

  @Step()
  async generateSnapshotsButtonIsHidden(): Promise<void> {
    await expect(this.el.floatingQuickActionsTrigger).toHaveCount(0);
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
  async dividendsSectionContains(text: string | RegExp): Promise<void> {
    await expect(this.el.dividendsSection).toContainText(text);
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

  @Step()
  async recomputeDialogIsVisible(): Promise<void> {
    await expect(this.el.recomputeConfirmDialog).toBeVisible();
  }

  @Step()
  async recomputeDialogIsHidden(): Promise<void> {
    await expect(this.el.recomputeConfirmDialog).toBeHidden();
  }

  @Step()
  async recomputeImpactIsVisible(): Promise<void> {
    await expect(this.el.recomputeImpactPreview).toBeVisible();
  }

  @Step()
  valueEquals(actual: unknown, expected: unknown): void {
    expect(actual).toEqual(expected);
  }

  @Step()
  async navigationCountIs(expected: number): Promise<void> {
    expect(await this.page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(expected);
  }

  @Step()
  async recomputeModeIsSelected(mode: "KEEP_RECORDED" | "RECALCULATE_CALCULATED"): Promise<void> {
    const option = mode === "KEEP_RECORDED"
      ? this.el.recomputeModeKeep
      : this.el.recomputeModeRecalculate;
    await expect(option).toHaveAttribute("data-state", "checked");
  }

  @Step()
  async recomputeImpactContains(text: string | RegExp): Promise<void> {
    await expect(this.el.recomputeImpactPreview).toContainText(text);
  }

  @Step()
  async recomputeZeroChangeIsVisible(): Promise<void> {
    await expect(this.el.recomputeZeroChange).toBeVisible();
  }

  @Step()
  async recomputeActionContains(text: string | RegExp): Promise<void> {
    await expect(this.el.recomputeConfirmDialogCta).toContainText(text);
  }

  @Step()
  async recomputeActionIsDisabled(): Promise<void> {
    await expect(this.el.recomputeConfirmDialogCta).toBeDisabled();
  }

  @Step()
  async recomputeCancelIsDisabled(): Promise<void> {
    await expect(this.el.recomputeConfirmDialogCancel).toBeDisabled();
  }

  @Step()
  async recomputeStatusMessageContains(text: string | RegExp): Promise<void> {
    await expect(this.el.recomputeConfirmDialog.getByRole("status")).toContainText(text);
  }

  @Step()
  async viewportHasNoHorizontalOverflow(): Promise<void> {
    expect(await this.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
}

const FINANCE_TONE_CLASS_EQUIVALENTS: Record<string, string[]> = {
  "text-emerald-600": ["text-emerald-600", "text-success", "text-[hsl(var(--success))]", "text-[hsl(var(--finance-gain))]"],
  "text-rose-600": ["text-rose-600", "text-destructive", "text-[hsl(var(--destructive))]", "text-[hsl(var(--finance-loss))]"],
  "text-[hsl(var(--finance-gain))]": ["text-[hsl(var(--finance-gain))]"],
  "text-[hsl(var(--finance-loss))]": ["text-[hsl(var(--finance-loss))]"],
};

function classTokenPattern(classToken: string): RegExp {
  const equivalentTokens = FINANCE_TONE_CLASS_EQUIVALENTS[classToken] ?? [classToken];
  return new RegExp(`(?:^|\\s)(?:${equivalentTokens.map(escapeRegExp).join("|")})(?:\\s|$)`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
