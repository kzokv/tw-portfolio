import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseActions } from "@tw-portfolio/test-framework/mixins";

import type { PortfolioPage } from "../../pages/portfolio/PortfolioPage.js";

export class PortfolioActions extends BaseActions {
  declare protected readonly _instance: PortfolioPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToPortfolio(): Promise<void> {
    await this.mxNavigateToRoute("/portfolio", TestEnv.appBaseUrl);
  }

  @Step()
  async openHoldingBySymbol(symbol: string): Promise<void> {
    await Promise.all([
      this.page.waitForURL(new RegExp(`/tickers/${symbol}(?:\\?|$)`)),
      this.mxClick(this.el.holdingsTable.getByRole("link", { name: symbol })),
    ]);
    await this.mxWaitForShellClientReady();
  }
}
