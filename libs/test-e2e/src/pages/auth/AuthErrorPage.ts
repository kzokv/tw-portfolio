import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

import { SHARED_TEST_IDS } from "../constants.js";

export interface TAuthErrorElements {
  tryAgainButton: Locator;
  globalErrorBanner: Locator;
}

export class AuthErrorPage extends BasePage<TAuthErrorElements> {
  protected initializeElements(): void {
    this._elements = {
      tryAgainButton: this.locate("auth-error-try-again", "Try Again Button"),
      globalErrorBanner: this.locate(SHARED_TEST_IDS.globalErrorBanner, "Global Error Banner"),
    };
  }
}
