import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";

export interface TEditFormElements {
  editTransactionButton: Locator;
  editableRow: Locator;
  quantityInput: Locator;
  priceInput: Locator;
  sideSelect: Locator;
  saveButton: Locator;
  inlineCancelButton: Locator;
  confirmationDialog: Locator;
  confirmButton: Locator;
  negativeLotsWarning: Locator;
  dialogCancelButton: Locator;
}

export class EditFormComponent extends BasePage<TEditFormElements> {
  protected initializeElements(): void {
    const editableRow = this.locate("editable-transaction-row", "Editable Transaction Row");

    this._elements = {
      editTransactionButton: this.locate("edit-transaction-button", "Edit Transaction Button"),
      editableRow,
      quantityInput: this.withDescription(
        editableRow.getByTestId("edit-quantity-input"),
        "Edit Quantity Input",
      ),
      priceInput: this.withDescription(
        editableRow.getByTestId("edit-price-input"),
        "Edit Price Input",
      ),
      sideSelect: this.withDescription(
        editableRow.getByTestId("edit-side-select"),
        "Edit Side Select",
      ),
      saveButton: this.withDescription(
        editableRow.getByTestId("edit-save-button"),
        "Edit Save Button",
      ),
      inlineCancelButton: this.withDescription(
        editableRow.getByRole("button", { name: /cancel/i }),
        "Inline Edit Cancel Button",
      ),
      confirmationDialog: this.locate("edit-confirmation-dialog", "Edit Confirmation Dialog"),
      confirmButton: this.locate("edit-confirm-button", "Edit Confirmation Save Button"),
      negativeLotsWarning: this.locate("edit-negative-lots-warning", "Edit Negative Lots Warning"),
      dialogCancelButton: this.withDescription(
        this.locate("edit-confirmation-dialog", "Edit Confirmation Dialog")
          .getByTestId("edit-cancel-button"),
        "Edit Confirmation Cancel Button",
      ),
    };
  }
}
