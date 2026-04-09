import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TSourceLineSubFormElements {
  unknownToggle: Locator;
  addButton: Locator;
  bucketSelect: (index: number) => Locator;
  amountInput: (index: number) => Locator;
  removeButton: (index: number) => Locator;
}

export class SourceLineSubFormComponent extends BasePage<TSourceLineSubFormElements> {
  protected initializeElements(): void {
    this._elements = {
      unknownToggle: this.locate("dividend-source-unknown-toggle", "Unknown Dividend Source Toggle"),
      addButton: this.locate("dividend-add-source-line", "Add Dividend Source Line"),
      bucketSelect: (index: number) => this.locate(`dividend-source-bucket-${index}`, `Dividend Source Bucket ${index}`),
      amountInput: (index: number) => this.locate(`dividend-source-amount-${index}`, `Dividend Source Amount ${index}`),
      removeButton: (index: number) => this.locate(`dividend-remove-source-line-${index}`, `Remove Dividend Source Line ${index}`),
    };
  }
}
