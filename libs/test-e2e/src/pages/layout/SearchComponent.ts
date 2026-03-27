import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TSearchElements {
  desktopSearch: Locator;
  desktopResults: Locator;
  mobileSearchButton: Locator;
  mobileSheet: Locator;
  mobileSheetInput: Locator;
  mobileResults: Locator;
  quickSearchItem: (kind: string, id: string) => Locator;
}

export class SearchComponent extends BasePage<TSearchElements> {
  protected initializeElements(): void {
    this._elements = {
      desktopSearch: this.locate("topbar-search", "Desktop Search Input"),
      desktopResults: this.locate("topbar-search-results", "Desktop Search Results"),
      mobileSearchButton: this.locate("topbar-search-button", "Mobile Search Button"),
      mobileSheet: this.locate("topbar-search-sheet", "Mobile Search Sheet"),
      mobileSheetInput: this.locate("topbar-search-sheet-input", "Mobile Search Sheet Input"),
      mobileResults: this.locate("topbar-search-sheet-results", "Mobile Search Results"),
      quickSearchItem: (kind: string, id: string) =>
        this.locate(`quick-search-item-${kind}-${id}`, `Quick Search Item ${kind}/${id}`),
    };
  }
}
