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
  accountSelect: Locator;
  quantityInput: Locator;
  priceInput: Locator;
  tradeDateInput: Locator;
  submitButton: Locator;
}

export class TransactionFormComponent extends BasePage<TTransactionFormElements> {
  protected initializeElements(): void {
    this._elements = {
      recordTransactionButton: this.locate("record-transaction-button", "Record Transaction Button"),
      recordTransactionDialog: this.locate("record-transaction-dialog", "Record Transaction Dialog"),
      tickerCombobox: this.locate("tx-ticker-combobox", "Ticker Combobox"),
      tickerListbox: this.locate("tx-ticker-listbox", "Ticker Listbox"),
      tickerEmptyState: this.locate("tx-ticker-empty-state", "Ticker Empty State"),
      tickerMatchCount: this.locate("tx-ticker-match-count", "Ticker Match Count"),
      tickerOption: (ticker: string) => this.locate(`tx-ticker-option-${ticker}`, `Ticker Option ${ticker}`),
      accountSelect: this.locate("tx-account-select", "Account Select"),
      quantityInput: this.locate("tx-quantity-input", "Quantity Input"),
      priceInput: this.locate("tx-price-input", "Price Input"),
      tradeDateInput: this.locate("tx-trade-date-input", "Trade Date Input"),
      submitButton: this.locate("tx-submit-button", "Submit Button"),
    };
  }
}
