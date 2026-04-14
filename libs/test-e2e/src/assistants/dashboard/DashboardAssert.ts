import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

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
  async summaryDailyChangeContains(text: string | RegExp): Promise<void> {
    await expect(this.el.summarySection).toContainText(text);
  }

  @Step()
  async summaryDailyChangeIsSubdued(): Promise<void> {
    const dailyChangeCard = this.el.summarySection
      .locator(".glass-inset")
      .filter({ hasText: /daily change/i });
    await expect(dailyChangeCard.locator("p.text-slate-400")).toBeVisible();
  }

  @Step()
  async holdingsTableHasDailyChangeColumn(): Promise<void> {
    await expect(this.el.holdingsTable.locator("thead th")).toContainText([/daily change/i]);
  }

  @Step()
  async holdingRowContainsText(ticker: string, text: string | RegExp): Promise<void> {
    const row = this.el.holdingsTable.locator("tbody tr").filter({ hasText: ticker });
    await expect(row).toContainText(text);
  }

  @Step()
  async holdingRowHasColorClass(ticker: string, colorClass: string): Promise<void> {
    const row = this.el.holdingsTable.locator("tbody tr").filter({ hasText: ticker });
    const dailyChangeCell = row.locator("td").nth(5);
    await expect(dailyChangeCell).toHaveClass(new RegExp(colorClass));
  }

  @Step()
  async heroPanelContains(text: string | RegExp): Promise<void> {
    await expect(this.el.heroPanel).toContainText(text);
  }

  @Step()
  async holdingsTableContains(text: string | RegExp): Promise<void> {
    await expect(this.el.holdingsTable).toContainText(text);
  }

  // --- Snapshot chart assertions ---

  @Step()
  async generateSnapshotsButtonIsVisible(): Promise<void> {
    await expect(this.el.generateSnapshotsButton).toBeVisible();
  }

  @Step()
  async generateSnapshotsButtonIsDisabled(): Promise<void> {
    await expect(this.el.generateSnapshotsButton).toBeDisabled();
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
    // Chart SVG has at least one <path> with a non-empty d attribute (data lines rendered)
    const paths = this.el.performanceChart.locator("path[d]");
    await expect(paths.first()).toBeVisible();
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
    const paths = this.el.returnPercentChart.locator("path[d]");
    await expect(paths.first()).toBeVisible();
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
}
