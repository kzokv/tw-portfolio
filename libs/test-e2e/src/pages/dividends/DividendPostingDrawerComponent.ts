import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";
import { DeductionSubFormComponent } from "./DeductionSubFormComponent.js";
import { SourceLineSubFormComponent } from "./SourceLineSubFormComponent.js";

export interface TDividendPostingDrawerElements {
  dialog: Locator;
  body: Locator;
  form: Locator;
  closeButton: Locator;
  receivedCashInput: Locator;
  receivedStockInput: Locator;
  saveButton: Locator;
  cancelButton: Locator;
  errorBanner: Locator;
  deductions: DeductionSubFormComponent;
  sourceLines: SourceLineSubFormComponent;
  // Reconciliation section elements (KZO-32)
  reconcileSection: Locator;
  reconcileStatusSelect: Locator;
  reconcileNote: Locator;
  reconcileError: Locator;
  reconcileSaveButton: Locator;
  stockEditDisabledLabel: Locator;
}

export class DividendPostingDrawerComponent extends BasePage<TDividendPostingDrawerElements> {
  protected initializeElements(): void {
    this._elements = {
      dialog: this.locate("ui-drawer", "Dividend Posting Drawer"),
      body: this.locate("ui-drawer-body", "Dividend Posting Drawer Body"),
      form: this.locate("dividend-posting-form", "Dividend Posting Form"),
      closeButton: this.locate("ui-drawer-close", "Close Dividend Drawer"),
      receivedCashInput: this.locate("dividend-received-cash", "Dividend Received Cash Input"),
      receivedStockInput: this.locate("dividend-received-stock", "Dividend Received Stock Input"),
      saveButton: this.locate("dividend-save", "Save Dividend Posting"),
      cancelButton: this.locate("dividend-cancel", "Cancel Dividend Posting"),
      errorBanner: this.locate("dividend-form-error", "Dividend Form Error"),
      deductions: new DeductionSubFormComponent(this.page),
      sourceLines: new SourceLineSubFormComponent(this.page),
      // Reconciliation section (KZO-32)
      reconcileSection: this.locate("dividend-reconcile-section", "Dividend Reconcile Section"),
      reconcileStatusSelect: this.locate("dividend-reconcile-status-select", "Dividend Reconcile Status Select"),
      reconcileNote: this.locate("dividend-reconcile-note", "Dividend Reconcile Note"),
      reconcileError: this.locate("dividend-reconcile-error", "Dividend Reconcile Error"),
      reconcileSaveButton: this.locate("dividend-reconcile-save", "Save Dividend Reconciliation"),
      stockEditDisabledLabel: this.locate("dividend-stock-edit-disabled-label", "Stock Edit Disabled Label"),
    };
  }
}
