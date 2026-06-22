import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { PortfolioPage } from "../../pages/portfolio/PortfolioPage.js";

export class PortfolioActions extends AppBaseActions {
  declare protected readonly _instance: PortfolioPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToPortfolio(): Promise<void> {
    await this.mxNavigateToRoute("/portfolio", TestEnv.appBaseUrl);
  }

  @Step()
  async openHoldingByTicker(symbol: string): Promise<void> {
    await Promise.all([
      this.page.waitForURL(new RegExp(`/tickers/${symbol}(?:\\?|$)`)),
      this.mxClick(this.el.holdingsTable.getByRole("link", { name: symbol })),
    ]);
    await this.mxWaitForShellClientReady();
  }

  @Step()
  async setDisplayModeGrouped(): Promise<void> {
    await this.mxClick(this.el.displayModeSelect);
    await this.mxClick(this.el.displayModeAggregated);
  }

  @Step()
  async setDisplayModeExpanded(): Promise<void> {
    await this.mxClick(this.el.displayModeSelect);
    await this.mxClick(this.el.displayModeExpanded);
  }

  @Step()
  async expandHoldingGroup(ticker: string, marketCode: string): Promise<void> {
    await this.mxClick(this.el.holdingGroupToggle(ticker, marketCode));
  }

  @Step()
  async setAllocationBasisCostBasis(): Promise<void> {
    await this.mxClick(this.el.allocationBasisSelect);
    await this.mxClick(this.el.allocationBasisCostBasis);
  }

  @Step()
  async openHoldingGroup(ticker: string, marketCode: string): Promise<void> {
    await Promise.all([
      this.page.waitForURL(new RegExp(`/tickers/${ticker}\\?marketCode=${marketCode}(?:&|$)`)),
      this.mxClick(this.el.holdingGroupRow(ticker, marketCode).getByRole("link", { name: ticker })),
    ]);
    await this.mxWaitForShellClientReady();
  }

  @Step()
  async openHoldingChild(ticker: string, marketCode: string, accountId: string): Promise<void> {
    await Promise.all([
      this.page.waitForURL(new RegExp(`/tickers/${ticker}\\?marketCode=${marketCode}&accountId=${accountId}(?:&|$)`)),
      this.mxClick(this.el.holdingChildRow(ticker, marketCode, accountId).getByRole("link").first()),
    ]);
    await this.mxWaitForShellClientReady();
  }
}
