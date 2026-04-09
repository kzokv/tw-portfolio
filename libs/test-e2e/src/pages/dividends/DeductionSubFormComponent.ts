import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TDeductionSubFormElements {
  addButton: Locator;
  typeSelect: (index: number) => Locator;
  amountInput: (index: number) => Locator;
  removeButton: (index: number) => Locator;
}

export class DeductionSubFormComponent extends BasePage<TDeductionSubFormElements> {
  protected initializeElements(): void {
    this._elements = {
      addButton: this.locate("dividend-add-deduction", "Add Dividend Deduction"),
      typeSelect: (index: number) => this.locate(`dividend-deduction-type-${index}`, `Dividend Deduction Type ${index}`),
      amountInput: (index: number) => this.locate(`dividend-deduction-amount-${index}`, `Dividend Deduction Amount ${index}`),
      removeButton: (index: number) => this.locate(`dividend-remove-deduction-${index}`, `Remove Dividend Deduction ${index}`),
    };
  }
}
