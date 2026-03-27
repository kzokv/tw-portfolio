import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export type TSidebarDestination = "dashboard" | "portfolio" | "transactions";

export interface TSideNavigationElements {
  root: Locator;
  dashboard: Locator;
  portfolio: Locator;
  transactions: Locator;
}

export class SideNavigationComponent extends BasePage<TSideNavigationElements> {
  protected initializeElements(): void {
    const root = this.locate("desktop-sidebar", "Desktop Sidebar");

    this._elements = {
      root,
      dashboard: this.withDescription(
        root.getByTestId("sidebar-link-dashboard"),
        "Dashboard Sidebar Link",
      ),
      portfolio: this.withDescription(
        root.getByTestId("sidebar-link-portfolio"),
        "Portfolio Sidebar Link",
      ),
      transactions: this.withDescription(
        root.getByTestId("sidebar-link-transactions"),
        "Transactions Sidebar Link",
      ),
    };
  }
}
