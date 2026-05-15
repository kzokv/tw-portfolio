import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

export interface TPortfolioElements extends TElementLocatorHelpers {
  holdingsTable: Locator;
  portfolioIntro: Locator;
  firstHoldingRow: Locator;
  holdingLink: (symbol: string) => Locator;
}

export class PortfolioPage extends BasePage<TPortfolioElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      holdingsTable: this.locate("holdings-table", "Holdings Table"),
      portfolioIntro: this.locate("portfolio-intro", "Portfolio Intro"),
      firstHoldingRow: this.nth(this.locate("holdings-table"), "tbody tr", 0, "First Holding Row"),
      holdingLink: (symbol: string) =>
        this.withDescription(
          this.locate("holdings-table").getByRole("link", { name: symbol }),
          `Holding Link ${symbol}`,
        ),
    };
  }
}
