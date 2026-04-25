import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@tw-portfolio/test-framework/core";

import { SHARED_TEST_IDS } from "../constants.js";

export interface TAuthErrorElements extends TElementLocatorHelpers {
  tryAgainButton: Locator;
  globalErrorBanner: Locator;
}

export class AuthErrorPage extends BasePage<TAuthErrorElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      tryAgainButton: this.locate("auth-error-try-again", "Try Again Button"),
      globalErrorBanner: this.locate(SHARED_TEST_IDS.globalErrorBanner, "Global Error Banner"),
    };
  }
}
