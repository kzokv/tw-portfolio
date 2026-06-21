import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

import { TransactionFormComponent, type TTransactionFormElements } from "../shared/TransactionFormComponent.js";

export interface TTransactionsElements extends TElementLocatorHelpers {
  transactionsIntro: Locator;
  transactionStatus: Locator;
  verificationPanel: Locator;
  recentTransactionsCard: Locator;
  recentTransactionsTable: Locator;
  transactionHistoryTickerFilter: Locator;
  readOnlyMessage: Locator;
  tooltipAccountTrigger: Locator;
  tooltipAccountContent: Locator;
  transactionForm: TTransactionFormElements;
}

export class TransactionsPage extends BasePage<TTransactionsElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      transactionsIntro: this.locate("transactions-intro", "Transactions Intro"),
      transactionStatus: this.locate("transaction-status", "Transaction Status"),
      verificationPanel: this.locate("transactions-verification-panel", "Transactions Verification Panel"),
      recentTransactionsCard: this.locate("transaction-history-browser", "Transaction History Browser"),
      recentTransactionsTable: this.locate("transaction-history-table", "Transaction History Table"),
      transactionHistoryTickerFilter: this.locate("transaction-history-ticker-filter", "Transaction History Ticker Filter"),
      readOnlyMessage: this.locate("transactions-readonly", "Transactions Read Only Message"),
      tooltipAccountTrigger: this.locate("tooltip-tx-account-trigger", "Tooltip Account Trigger"),
      tooltipAccountContent: this.locate("tooltip-tx-account-content", "Tooltip Account Content"),
      transactionForm: new TransactionFormComponent(this.page).elements,
    };
  }
}
