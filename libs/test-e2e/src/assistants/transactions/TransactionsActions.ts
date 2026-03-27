import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseActions } from "@tw-portfolio/test-framework/mixins";

import type { TransactionsPage } from "../../pages/transactions/TransactionsPage.js";

export class TransactionsActions extends BaseActions {
  declare protected readonly _instance: TransactionsPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToTransactions(): Promise<void> {
    await this.mxNavigateToRoute("/transactions", TestEnv.appBaseUrl);
  }

  @Step()
  async selectFirstAccount(): Promise<void> {
    const accountSelect = this.el.transactionForm.elements.accountSelect;
    const firstOption = accountSelect.locator("option").first();
    const firstAccountId = await firstOption.getAttribute("value");
    await this.uiActions.select.perform(accountSelect, firstAccountId ?? "acc-1");
  }

  @Step()
  async submitTransaction(): Promise<void> {
    await this.uiActions.click.perform(this.el.transactionForm.elements.submitButton);
  }

  @Step()
  async focusAccountTooltip(): Promise<void> {
    await this.el.tooltipAccountTrigger.focus();
  }

  @Step()
  async waitForTransactionPost(): Promise<import("@playwright/test").Response> {
    return this.page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/portfolio/transactions") && r.ok(),
    );
  }

  @Step()
  async waitForDashboardRefresh(): Promise<import("@playwright/test").Response> {
    return this.page.waitForResponse(
      (r) => r.request().method() === "GET" && r.url().includes("/dashboard/overview") && r.ok(),
    );
  }

  @Step()
  async waitForLedgerRefresh(): Promise<import("@playwright/test").Response> {
    return this.page.waitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        r.url().includes("/portfolio/transactions?limit=6") &&
        r.ok(),
    );
  }
}
