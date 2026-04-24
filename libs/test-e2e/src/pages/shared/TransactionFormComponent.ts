import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

/** Shared form used on both TransactionsPage and TickerDetailPage record dialog. */
export interface TTransactionFormElements {
  recordTransactionButton: Locator;
  recordTransactionDialog: Locator;
  tickerCombobox: Locator;
  tickerListbox: Locator;
  tickerEmptyState: Locator;
  tickerMatchCount: Locator;
  tickerOption: (ticker: string) => Locator;
  accountSelector: Locator;
  accountSelect: Locator;
  selectedAccountOption: Locator;
  typeSelect: Locator;
  quantityInput: Locator;
  priceInput: Locator;
  unitPriceInput: Locator;
  priceSourceHint: Locator;
  priceUnavailableHint: Locator;
  tradeDateInput: Locator;
  commissionEstimateSection: Locator;
  commissionEstimateValue: Locator;
  commissionOverrideInput: Locator;
  taxEstimateSection: Locator;
  taxEstimateValue: Locator;
  taxOverrideInput: Locator;
  submitButton: Locator;
}

export class TransactionFormComponent extends BasePage<TTransactionFormElements> {
  protected initializeElements(): void {
    const accountSelect = this.locate("tx-account-select", "Account Select");
    const unitPriceInput = this.withDescription(
      this.page.locator('[data-testid="unit-price-input"], [data-testid="tx-price-input"]'),
      "Unit Price Input",
    );

    this._elements = {
      recordTransactionButton: this.locate("record-transaction-button", "Record Transaction Button"),
      recordTransactionDialog: this.locate("record-transaction-dialog", "Record Transaction Dialog"),
      tickerCombobox: this.locate("tx-ticker-combobox", "Ticker Combobox"),
      tickerListbox: this.locate("tx-ticker-listbox", "Ticker Listbox"),
      tickerEmptyState: this.locate("tx-ticker-empty-state", "Ticker Empty State"),
      tickerMatchCount: this.locate("tx-ticker-match-count", "Ticker Match Count"),
      tickerOption: (ticker: string) => this.locate(`tx-ticker-option-${ticker}`, `Ticker Option ${ticker}`),
      accountSelector: this.locate("account-selector", "Account Selector"),
      accountSelect,
      selectedAccountOption: this.withDescription(accountSelect.locator("option:checked"), "Selected Account Option"),
      typeSelect: this.locate("tx-type-select", "Transaction Type Select"),
      quantityInput: this.locate("tx-quantity-input", "Quantity Input"),
      priceInput: unitPriceInput,
      unitPriceInput,
      priceSourceHint: this.locate("price-source-hint", "Price Source Hint"),
      priceUnavailableHint: this.locate("price-unavailable-hint", "Price Unavailable Hint"),
      tradeDateInput: this.locate("tx-trade-date-input", "Trade Date Input"),
      commissionEstimateSection: this.locate("commission-estimate-section", "Commission Estimate Section"),
      commissionEstimateValue: this.locate("commission-estimate-value", "Commission Estimate Value"),
      commissionOverrideInput: this.locate("commission-override-input", "Commission Override Input"),
      taxEstimateSection: this.locate("tax-estimate-section", "Tax Estimate Section"),
      taxEstimateValue: this.locate("tax-estimate-value", "Tax Estimate Value"),
      taxOverrideInput: this.locate("tax-override-input", "Tax Override Input"),
      submitButton: this.locate("tx-submit-button", "Submit Button"),
    };
  }
}
