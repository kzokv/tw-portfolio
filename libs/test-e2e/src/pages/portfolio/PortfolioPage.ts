import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

export interface TPortfolioElements extends TElementLocatorHelpers {
  holdingsTable: Locator;
  portfolioIntro: Locator;
  firstHoldingRow: Locator;
  holdingGroupRow: (ticker: string, marketCode: string) => Locator;
  holdingGroupToggle: (ticker: string, marketCode: string) => Locator;
  holdingChildRow: (ticker: string, marketCode: string, accountId: string) => Locator;
  holdingLink: (symbol: string) => Locator;
  displayModeSelect: Locator;
  displayModeAggregated: Locator;
  displayModeExpanded: Locator;
  displayModeAccount: Locator;
  filterMarket: Locator;
  filterAccount: Locator;
  filterStatus: Locator;
  filterColumns: Locator;
  allocationBasisSelect: Locator;
  allocationBasisMarketValue: Locator;
  allocationBasisCostBasis: Locator;
}

export class PortfolioPage extends BasePage<TPortfolioElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      holdingsTable: this.locate("holdings-table", "Holdings Table"),
      portfolioIntro: this.locate("portfolio-intro", "Portfolio Intro"),
      firstHoldingRow: this.nth(this.locate("holdings-table"), "tbody tr", 0, "First Holding Row"),
      holdingGroupRow: (ticker: string, marketCode: string) =>
        this.locate(`holding-group-row-${ticker}-${marketCode}`, `Holding Group Row ${ticker}/${marketCode}`),
      holdingGroupToggle: (ticker: string, marketCode: string) =>
        this.locate(`holding-group-toggle-${ticker}-${marketCode}`, `Holding Group Toggle ${ticker}/${marketCode}`),
      holdingChildRow: (ticker: string, marketCode: string, accountId: string) =>
        this.locate(
          `holding-child-row-${ticker}-${marketCode}-${accountId}`,
          `Holding Child Row ${ticker}/${marketCode}/${accountId}`,
        ),
      holdingLink: (symbol: string) =>
        this.withDescription(
          this.locate("holdings-table").getByRole("link", { name: symbol }),
          `Holding Link ${symbol}`,
        ),
      displayModeSelect: this.locate("holdings-display-mode-select", "Holdings Display Mode Select"),
      displayModeAggregated: this.locate("holdings-display-mode-aggregated", "Holdings Display Mode Aggregated"),
      displayModeExpanded: this.locate("holdings-display-mode-expanded", "Holdings Display Mode Expanded"),
      displayModeAccount: this.locate("holdings-display-mode-accounts", "Holdings Display Mode Account"),
      filterMarket: this.locate("holdings-filter-market", "Holdings Filter Market"),
      filterAccount: this.locate("holdings-filter-account", "Holdings Filter Account"),
      filterStatus: this.locate("holdings-filter-status", "Holdings Filter Status"),
      filterColumns: this.locate("holdings-filter-columns", "Holdings Filter Columns"),
      allocationBasisSelect: this.locate("holdings-allocation-basis-select", "Holdings Allocation Basis Select"),
      allocationBasisMarketValue: this.locate(
        "holdings-allocation-basis-market-value",
        "Holdings Allocation Basis Market Value",
      ),
      allocationBasisCostBasis: this.locate(
        "holdings-allocation-basis-cost-basis",
        "Holdings Allocation Basis Cost Basis",
      ),
    };
  }
}
