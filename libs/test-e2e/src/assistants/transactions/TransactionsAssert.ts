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
  async readOnlyMessageIsVisible(): Promise<void> {
    await expect(this.page.getByTestId("transactions-readonly")).toBeVisible();
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

  @Step()
  async selectedAccountOptionContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.elements.selectedAccountOption).toContainText(text);
  }

  @Step()
  async selectedAccountOptionExcludes(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.elements.selectedAccountOption).not.toContainText(text);
  }

  @Step()
  async unitPriceValueEquals(value: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.elements.unitPriceInput).toHaveValue(value);
  }

  @Step()
  async priceSourceHintIsVisible(): Promise<void> {
    await expect(this.el.transactionForm.elements.priceSourceHint).toBeVisible();
  }

  @Step()
  async priceUnavailableHintIsVisible(): Promise<void> {
    await expect(this.el.transactionForm.elements.priceUnavailableHint).toBeVisible();
  }

  @Step()
  async commissionEstimateContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.elements.commissionEstimateValue).toContainText(text);
  }

  @Step()
  async commissionEstimateIsHidden(): Promise<void> {
    await expect(this.el.transactionForm.elements.commissionEstimateSection).toBeHidden();
  }

  @Step()
  async taxEstimateContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.elements.taxEstimateValue).toContainText(text);
  }

  @Step()
  async taxEstimateIsHidden(): Promise<void> {
    await expect(this.el.transactionForm.elements.taxEstimateSection).toBeHidden();
  }
}
