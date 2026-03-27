import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

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
    await expect(this.el.holdingsTable.locator("tbody tr").first()).toBeVisible({ timeout: 10_000 });
  }

  @Step()
  async holdingLinkIsVisible(symbol: string): Promise<void> {
    await expect(this.el.holdingsTable.getByRole("link", { name: symbol })).toBeVisible();
  }
}
