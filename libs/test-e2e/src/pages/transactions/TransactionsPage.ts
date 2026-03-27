import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

import { TransactionFormComponent } from "./TransactionFormComponent.js";

export interface TTransactionsElements {
  transactionsIntro: Locator;
  transactionStatus: Locator;
  verificationPanel: Locator;
  recentTransactionsCard: Locator;
  recentTransactionsTable: Locator;
  tooltipAccountTrigger: Locator;
  tooltipAccountContent: Locator;
  transactionForm: TransactionFormComponent;
}

export class TransactionsPage extends BasePage<TTransactionsElements> {
  protected initializeElements(): void {
    this._elements = {
      transactionsIntro: this.locate("transactions-intro", "Transactions Intro"),
      transactionStatus: this.locate("transaction-status", "Transaction Status"),
      verificationPanel: this.locate("transactions-verification-panel", "Transactions Verification Panel"),
      recentTransactionsCard: this.locate("recent-transactions-card", "Recent Transactions Card"),
      recentTransactionsTable: this.locate("recent-transactions-table", "Recent Transactions Table"),
      tooltipAccountTrigger: this.locate("tooltip-tx-account-trigger", "Tooltip Account Trigger"),
      tooltipAccountContent: this.locate("tooltip-tx-account-content", "Tooltip Account Content"),
      transactionForm: new TransactionFormComponent(this.page),
    };
  }
}
