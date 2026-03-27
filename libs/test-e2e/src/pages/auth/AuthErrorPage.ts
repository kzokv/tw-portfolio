import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TAuthErrorElements {
  tryAgainButton: Locator;
  globalErrorBanner: Locator;
}

export class AuthErrorPage extends BasePage<TAuthErrorElements> {
  protected initializeElements(): void {
    this._elements = {
      tryAgainButton: this.locate("auth-error-try-again", "Try Again Button"),
      globalErrorBanner: this.locate("global-error-banner", "Global Error Banner"),
    };
  }
}
