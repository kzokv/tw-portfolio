import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { TransactionsPage } from "../../pages/transactions/TransactionsPage.js";

export class TransactionsAssert extends BaseAssert {
  declare protected readonly _instance: TransactionsPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async transactionStatusContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionStatus).toContainText(text);
  }

  @Step()
  async verificationPanelIsVisible(): Promise<void> {
    await expect(this.el.verificationPanel).toBeVisible();
  }

  @Step()
  async recentTransactionsTableIsVisible(): Promise<void> {
    await expect(
      this.el.recentTransactionsCard.getByTestId("recent-transactions-table"),
    ).toBeVisible();
  }

  @Step()
  async recentTransactionTickerIsVisible(symbol: string): Promise<void> {
    await expect(
      this.el.recentTransactionsTable.getByRole("link", { name: symbol }),
    ).toBeVisible();
  }

  @Step()
  async introIsVisible(): Promise<void> {
    await expect(this.el.transactionsIntro).toBeVisible();
  }

  @Step()
  async tooltipAccountContentIsVisible(): Promise<void> {
    await expect(this.el.tooltipAccountContent).toBeVisible();
  }

  @Step()
  async comboboxShowsOptions(count: number): Promise<void> {
    await expect(this.el.transactionForm.elements.tickerListbox.getByRole("option")).toHaveCount(count);
  }

  @Step()
  async selectedTickerContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.elements.tickerCombobox).toHaveValue(text);
  }

  @Step()
  async comboboxIsEmpty(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.elements.tickerEmptyState).toContainText(text);
  }
}
