import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TDeleteDialogElements {
  deleteTransactionButton: Locator;
  confirmationDialog: Locator;
  tradeSummary: Locator;
  impactCounts: Locator;
  negativeLotsWarning: Locator;
  confirmButton: Locator;
}

export class DeleteDialogComponent extends BasePage<TDeleteDialogElements> {
  protected initializeElements(): void {
    this._elements = {
      deleteTransactionButton: this.locate("delete-transaction-button", "Delete Transaction Button"),
      confirmationDialog: this.locate("delete-confirmation-dialog", "Delete Confirmation Dialog"),
      tradeSummary: this.locate("delete-trade-summary", "Delete Trade Summary"),
      impactCounts: this.locate("delete-impact-counts", "Delete Impact Counts"),
      negativeLotsWarning: this.locate("delete-negative-lots-warning", "Delete Negative Lots Warning"),
      confirmButton: this.locate("delete-confirm-button", "Delete Confirm Button"),
    };
  }
}
