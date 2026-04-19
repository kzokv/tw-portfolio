import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TAnonymousShareElements {
  root: Locator;
  header: Locator;
  ownerName: Locator;
  ownerLabel: Locator;
  meta: Locator;
  totalValue: Locator;
  totalReturn: Locator;
  holdingsSection: Locator;
  holdingsTable: Locator;
  holdingsEmpty: Locator;
  notFoundState: Locator;
  disclosure: Locator;
}

export class AnonymousSharePage extends BasePage<TAnonymousShareElements> {
  protected initializeElements(): void {
    this._elements = {
      root: this.locate("public-share-root", "Public share root"),
      header: this.locate("public-share-header", "Public share header"),
      ownerName: this.locate("public-share-owner-name", "Public share owner display name"),
      ownerLabel: this.locate("public-share-owner", "Public share owner label"),
      meta: this.locate("public-share-meta", "Public share meta"),
      totalValue: this.locate("public-share-summary-total", "Public share total value summary"),
      totalReturn: this.locate("public-share-summary-return", "Public share return summary"),
      holdingsSection: this.locate("public-share-holdings", "Public share holdings section"),
      holdingsTable: this.locate("public-share-holdings-table", "Public share holdings table"),
      holdingsEmpty: this.locate("public-share-empty", "Public share holdings empty state"),
      notFoundState: this.locate("public-share-not-found", "Public share not-found state"),
      disclosure: this.locate("public-share-disclosure", "Public share disclosure"),
    };
  }
}
