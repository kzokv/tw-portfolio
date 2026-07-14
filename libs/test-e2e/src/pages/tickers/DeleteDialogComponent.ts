import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";

export interface TDeleteDialogElements {
  deleteTransactionButton: Locator;
  confirmationDialog: Locator;
  tradeSummary: Locator;
  impactCounts: Locator;
  dividendImpact: Locator;
  snapshotImpact: Locator;
  negativeLotsWarning: Locator;
  statusMessage: Locator;
  errorMessage: Locator;
  confirmButton: Locator;
  cancelButton: Locator;
}

export class DeleteDialogComponent extends BasePage<TDeleteDialogElements> {
  protected initializeElements(): void {
    this._elements = {
      deleteTransactionButton: this.locate("delete-transaction-button", "Delete Transaction Button"),
      confirmationDialog: this.locate("delete-confirmation-dialog", "Delete Confirmation Dialog"),
      tradeSummary: this.locate("delete-trade-summary", "Delete Trade Summary"),
      impactCounts: this.locate("delete-impact-counts", "Delete Impact Counts"),
      dividendImpact: this.locate("delete-dividend-impact", "Delete Dividend Impact"),
      snapshotImpact: this.locate("delete-snapshot-impact", "Delete Snapshot Impact"),
      negativeLotsWarning: this.locate("delete-negative-lots-warning", "Delete Negative Lots Warning"),
      statusMessage: this.locate("delete-status-message", "Delete Status Message"),
      errorMessage: this.locate("delete-error-message", "Delete Error Message"),
      confirmButton: this.locate("delete-confirm-button", "Delete Confirm Button"),
      cancelButton: this.locate("delete-cancel-button", "Delete Cancel Button"),
    };
  }
}
