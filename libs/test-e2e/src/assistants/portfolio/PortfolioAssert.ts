import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";

import type { PortfolioPage } from "../../pages/portfolio/PortfolioPage.js";

export class PortfolioAssert extends BaseAssert {
  declare protected readonly _instance: PortfolioPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async holdingsTableIsVisible(): Promise<void> {
    await expect(this.el.holdingsTable).toBeVisible({ timeout: 20_000 });
  }

  @Step()
  async holdingsTableContains(text: string | RegExp): Promise<void> {
    await expect(this.el.holdingsTable).toContainText(text);
  }

  @Step()
  async holdingsTableNotContains(text: string | RegExp): Promise<void> {
    await expect(this.el.holdingsTable).not.toContainText(text);
  }

  @Step()
  async portfolioIntroIsVisible(): Promise<void> {
    await expect(this.el.portfolioIntro).toBeVisible();
  }

  @Step()
  async firstHoldingRowIsVisible(): Promise<void> {
    await expect(this.el.firstHoldingRow).toBeVisible({ timeout: 10_000 });
  }

  @Step()
  async holdingGroupRowIsVisible(ticker: string, marketCode: string): Promise<void> {
    await expect(this.el.holdingGroupRow(ticker, marketCode)).toBeVisible();
  }

  @Step()
  async holdingChildRowIsVisible(ticker: string, marketCode: string, accountId: string): Promise<void> {
    await expect(this.el.holdingChildRow(ticker, marketCode, accountId)).toBeVisible();
  }

  @Step()
  async holdingChildRowIsHidden(ticker: string, marketCode: string, accountId: string): Promise<void> {
    await expect(this.el.holdingChildRow(ticker, marketCode, accountId)).toHaveCount(0);
  }

  @Step()
  async holdingLinkIsVisible(symbol: string): Promise<void> {
    await expect(this.el.holdingLink(symbol)).toBeVisible();
  }

  @Step()
  async holdingsFilterControlsAreVisible(): Promise<void> {
    await expect(this.el.filterMarket).toBeVisible();
    await expect(this.el.filterAccount).toBeVisible();
    await expect(this.el.filterStatus).toBeVisible();
    await expect(this.el.filterColumns).toBeVisible();
  }

  @Step()
  async allocationBasisCostBasisIsSelected(): Promise<void> {
    await expect(this.el.allocationBasisCostBasis).toHaveAttribute("aria-pressed", "true");
  }
}
