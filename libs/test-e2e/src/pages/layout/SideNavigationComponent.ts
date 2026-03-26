import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export type TSidebarDestination = "dashboard" | "portfolio" | "transactions";

export interface TSideNavigationElements {
  root: Locator;
  dashboard: Locator;
  portfolio: Locator;
  transactions: Locator;
  link: (destination: TSidebarDestination) => Locator;
}

export class SideNavigationComponent extends BasePage<TSideNavigationElements> {
  protected initializeElements(): void {
    const root = this.locate("desktop-sidebar", "Desktop Sidebar");
    const dashboard = this.withDescription(
      root.getByTestId("sidebar-link-dashboard"),
      "Dashboard Sidebar Link",
    );
    const portfolio = this.withDescription(
      root.getByTestId("sidebar-link-portfolio"),
      "Portfolio Sidebar Link",
    );
    const transactions = this.withDescription(
      root.getByTestId("sidebar-link-transactions"),
      "Transactions Sidebar Link",
    );

    this._elements = {
      root,
      dashboard,
      portfolio,
      transactions,
      link: (destination) => {
        switch (destination) {
          case "dashboard":
            return dashboard;
          case "portfolio":
            return portfolio;
          case "transactions":
            return transactions;
        }
      },
    };
  }
}
