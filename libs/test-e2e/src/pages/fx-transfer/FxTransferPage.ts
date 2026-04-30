import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@tw-portfolio/test-framework/core";

export interface TFxTransferElements extends TElementLocatorHelpers {
  newTransferButton: Locator;
  dialog: Locator;
  fromAccountSelect: Locator;
  toAccountSelect: Locator;
  fromAmountInput: Locator;
  toAmountInput: Locator;
  rateInput: Locator;
  entryDateInput: Locator;
  notesInput: Locator;
  submitButton: Locator;
  cancelButton: Locator;
  gauge: Locator;
  summary: Locator;
  fxOutBadge: Locator;
  fxInBadge: Locator;
  blockBandText: Locator;
}

export class FxTransferPage extends BasePage<TFxTransferElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      newTransferButton: this.locate("new-fx-transfer-button", "New FX Transfer Button"),
      dialog: this.locate("record-fx-transfer-dialog", "Record FX Transfer Dialog"),
      fromAccountSelect: this.locate("fx-from-account-select", "FX From Account Select"),
      toAccountSelect: this.locate("fx-to-account-select", "FX To Account Select"),
      fromAmountInput: this.locate("fx-from-amount-input", "FX From Amount Input"),
      toAmountInput: this.locate("fx-to-amount-input", "FX To Amount Input"),
      rateInput: this.locate("fx-rate-input", "FX Rate Input"),
      entryDateInput: this.locate("fx-entry-date-input", "FX Entry Date Input"),
      notesInput: this.locate("fx-notes-input", "FX Notes Input"),
      submitButton: this.locate("fx-transfer-submit", "FX Transfer Submit"),
      cancelButton: this.locate("fx-transfer-cancel", "FX Transfer Cancel"),
      gauge: this.locate("fx-rate-gauge", "FX Rate Gauge"),
      summary: this.locate("fx-transfer-summary", "FX Transfer Summary"),
      fxOutBadge: this.withDescription(
        this.scope.getByText(/FX Out/),
        "FX Out Badge",
      ),
      fxInBadge: this.withDescription(
        this.scope.getByText(/FX In/),
        "FX In Badge",
      ),
      blockBandText: this.withDescription(
        this.scope.getByText(/outside the allowed band/i),
        "FX Gauge Block-State Copy",
      ),
    };
  }
}
