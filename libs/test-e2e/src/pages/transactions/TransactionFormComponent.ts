import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

/** Shared form used on both TransactionsPage and TickerDetailPage record dialog. */
export interface TTransactionFormElements {
  recordTransactionButton: Locator;
  recordTransactionDialog: Locator;
  symbolSelect: Locator;
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
      symbolSelect: this.locate("tx-symbol-select", "Symbol Select"),
      accountSelect: this.locate("tx-account-select", "Account Select"),
      quantityInput: this.locate("tx-quantity-input", "Quantity Input"),
      priceInput: this.locate("tx-price-input", "Price Input"),
      tradeDateInput: this.locate("tx-trade-date-input", "Trade Date Input"),
      submitButton: this.locate("tx-submit-button", "Submit Button"),
    };
  }
}
