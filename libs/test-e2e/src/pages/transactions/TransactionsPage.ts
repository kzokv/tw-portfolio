import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@tw-portfolio/test-framework/core";

import { TransactionFormComponent, type TTransactionFormElements } from "../shared/TransactionFormComponent.js";

export interface TTransactionsElements extends TElementLocatorHelpers {
  transactionsIntro: Locator;
  transactionStatus: Locator;
  verificationPanel: Locator;
  recentTransactionsCard: Locator;
  recentTransactionsTable: Locator;
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
      recentTransactionsCard: this.locate("recent-transactions-card", "Recent Transactions Card"),
      recentTransactionsTable: this.locate("recent-transactions-table", "Recent Transactions Table"),
      readOnlyMessage: this.locate("transactions-readonly", "Transactions Read Only Message"),
      tooltipAccountTrigger: this.locate("tooltip-tx-account-trigger", "Tooltip Account Trigger"),
      tooltipAccountContent: this.locate("tooltip-tx-account-content", "Tooltip Account Content"),
      transactionForm: new TransactionFormComponent(this.page).elements,
    };
  }
}
