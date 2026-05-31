import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";

import { SHARED_TEST_IDS } from "../constants.js";

export interface TBrowserSessionElements {
  globalErrorBanner: Locator;
}

export class BrowserSessionPage extends BasePage<TBrowserSessionElements> {
  protected initializeElements(): void {
    this._elements = {
      globalErrorBanner: this.locate(SHARED_TEST_IDS.globalErrorBanner, "Global Error Banner"),
    };
  }
}
