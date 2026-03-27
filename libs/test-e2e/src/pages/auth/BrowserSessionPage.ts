import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TBrowserSessionElements {
  globalErrorBanner: Locator;
}

export class BrowserSessionPage extends BasePage<TBrowserSessionElements> {
  protected initializeElements(): void {
    this._elements = {
      globalErrorBanner: this.locate("global-error-banner", "Global Error Banner"),
    };
  }
}
