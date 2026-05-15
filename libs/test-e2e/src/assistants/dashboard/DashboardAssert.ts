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
  async summaryDailyChangeContains(text: string | RegExp): Promise<void> {
    await expect(this.el.summarySection).toContainText(text);
  }

  @Step()
  async summaryDailyChangeIsSubdued(): Promise<void> {
    await expect(this.el.dailyChangeSubduedText).toBeVisible();
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

  @Step()
  async generateSnapshotsButtonIsVisible(): Promise<void> {
    await expect(this.el.generateSnapshotsButton).toBeVisible();
  }

  @Step()
  async recomputeButtonIsVisible(): Promise<void> {
    await expect(this.el.recomputeButton).toBeVisible();
  }

  @Step()
  async recomputeButtonIsHidden(): Promise<void> {
    await expect(this.el.recomputeButton).toHaveCount(0);
  }

  @Step()
  async generateSnapshotsButtonIsHidden(): Promise<void> {
    await expect(this.el.generateSnapshotsButton).toHaveCount(0);
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
}
