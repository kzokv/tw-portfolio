import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TPortfolioElements {
  holdingsTable: Locator;
  portfolioIntro: Locator;
}

export class PortfolioPage extends BasePage<TPortfolioElements> {
  protected initializeElements(): void {
    this._elements = {
      holdingsTable: this.locate("holdings-table", "Holdings Table"),
      portfolioIntro: this.locate("portfolio-intro", "Portfolio Intro"),
    };
  }
}
