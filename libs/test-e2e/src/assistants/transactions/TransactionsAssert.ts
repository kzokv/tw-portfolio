import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";

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
    await expect(this.el.readOnlyMessage).toBeVisible();
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
    await expect(this.el.transactionForm.tickerListbox.getByRole("option")).toHaveCount(count);
  }

  @Step()
  async comboboxOptionContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.tickerListbox.getByRole("option").filter({ hasText: text })).toBeVisible();
  }

  @Step()
  async selectedTickerContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.tickerCombobox).toHaveValue(text);
  }

  @Step()
  async selectedMarketChipIs(market: "TW" | "US" | "AU" | "ALL"): Promise<void> {
    await expect(this.el.transactionForm.marketChip(market)).toHaveAttribute("aria-checked", "true");
  }

  @Step()
  async selectedAccountOptionsContain(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.accountOptionByText(text)).toHaveCount(1);
  }

  @Step()
  async selectedAccountOptionsExclude(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.accountOptionByText(text)).toHaveCount(0);
  }

  @Step()
  async noAccountErrorContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.noAccountError).toContainText(text);
  }

  @Step()
  async createAccountLinkHrefContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.createAccountLink).toHaveAttribute("href", text);
  }

  @Step()
  async priceCurrencyIs(value: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.priceCurrencyInput).toHaveValue(value);
  }

  @Step()
  async submitButtonIsDisabled(): Promise<void> {
    await expect(this.el.transactionForm.submitButton).toBeDisabled();
  }

  @Step()
  async comboboxIsEmpty(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.tickerEmptyState).toContainText(text);
  }

  @Step()
  async selectedAccountOptionContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.selectedAccountOption).toContainText(text);
  }

  @Step()
  async selectedAccountOptionExcludes(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.selectedAccountOption).not.toContainText(text);
  }

  @Step()
  async unitPriceValueEquals(value: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.unitPriceInput).toHaveValue(value);
  }

  @Step()
  async priceSourceHintIsVisible(): Promise<void> {
    await expect(this.el.transactionForm.priceSourceHint).toBeVisible();
  }

  @Step()
  async priceUnavailableHintIsVisible(): Promise<void> {
    await expect(this.el.transactionForm.priceUnavailableHint).toBeVisible();
  }

  @Step()
  async commissionEstimateContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.commissionEstimateValue).toContainText(text);
  }

  @Step()
  async commissionEstimateIsHidden(): Promise<void> {
    // ui-enhancement (2026-05-13): the 4-tuple render gate makes the section
    // CONDITIONALLY rendered, not conditionally hidden. Asserting absence is
    // the correct contract under the new behavior; `toBeHidden()` would fail
    // because the element is not in the DOM.
    await expect(this.el.transactionForm.commissionEstimateSection).toHaveCount(0);
  }

  @Step()
  async taxEstimateContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.taxEstimateValue).toContainText(text);
  }

  @Step()
  async taxEstimateIsHidden(): Promise<void> {
    // ui-enhancement: tax section also gated by the 4-tuple + SELL discriminator.
    await expect(this.el.transactionForm.taxEstimateSection).toHaveCount(0);
  }

  // ── ui-enhancement — Fee/tax 4-tuple gate + degradation + chip cleanup ──

  @Step()
  async commissionEstimateSectionIsVisible(): Promise<void> {
    await expect(this.el.transactionForm.commissionEstimateSection).toBeVisible();
  }

  @Step()
  async commissionEstimateSectionIsAbsent(): Promise<void> {
    await expect(this.el.transactionForm.commissionEstimateSection).toHaveCount(0);
  }

  @Step()
  async commissionEstimateUnavailableIsVisible(): Promise<void> {
    await expect(this.el.transactionForm.commissionEstimateUnavailable).toBeVisible();
  }

  @Step()
  async commissionOverrideInputIsVisible(): Promise<void> {
    await expect(this.el.transactionForm.commissionOverrideInput).toBeVisible();
  }

  @Step()
  async commissionOverrideValueIs(value: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.commissionOverrideInput).toHaveValue(value);
  }

  @Step()
  async taxEstimateSectionIsVisible(): Promise<void> {
    await expect(this.el.transactionForm.taxEstimateSection).toBeVisible();
  }

  @Step()
  async taxEstimateSectionIsAbsent(): Promise<void> {
    await expect(this.el.transactionForm.taxEstimateSection).toHaveCount(0);
  }

  @Step()
  async marketChipIsVisible(market: "TW" | "US" | "AU"): Promise<void> {
    await expect(this.el.transactionForm.marketChip(market)).toBeVisible();
  }

  @Step()
  async marketChipIsAbsent(market: "TW" | "US" | "AU" | "ALL"): Promise<void> {
    await expect(this.el.transactionForm.marketChip(market)).toHaveCount(0);
  }

  @Step()
  async tickerComboboxValueIs(value: string | RegExp): Promise<void> {
    await expect(this.el.transactionForm.tickerCombobox).toHaveValue(value);
  }

  @Step()
  async tickerComboboxValueIsNot(value: string): Promise<void> {
    await expect(this.el.transactionForm.tickerCombobox).not.toHaveValue(value);
  }
}
