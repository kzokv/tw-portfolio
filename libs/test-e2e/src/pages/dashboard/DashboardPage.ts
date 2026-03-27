import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TDashboardElements {
  recomputeButton: Locator;
  recomputeStatus: Locator;
  demoBanner: Locator;
  appReady: Locator;
}

export class DashboardPage extends BasePage<TDashboardElements> {
  protected initializeElements(): void {
    this._elements = {
      recomputeButton: this.locate("recompute-button", "Recompute Button"),
      recomputeStatus: this.locate("recompute-status", "Recompute Status"),
      demoBanner: this.locate("demo-banner", "Demo Banner"),
      appReady: this.locate("app-shell-ready", "App Shell Ready Marker"),
    };
  }
}
