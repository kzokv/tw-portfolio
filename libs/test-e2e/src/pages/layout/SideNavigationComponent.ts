import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";

// Phase 3c: sidebar nav items renamed from sidebar-link-{key} → app-sidebar-nav-{key}.
// Root element renamed from desktop-sidebar → app-sidebar.
// Destination union expanded to cover all nav items (including settings, admin).
export type TSidebarDestination =
  | "dashboard"
  | "portfolio"
  | "transactions"
  | "cash-ledger"
  | "dividends"
  | "sharing"
  | "tickers"
  | "settings"
  | "admin";

export interface TSideNavigationElements {
  root: Locator;
  dashboard: Locator;
  portfolio: Locator;
  transactions: Locator;
  "cash-ledger": Locator;
  dividends: Locator;
  sharing: Locator;
  tickers: Locator;
  settings: Locator;
  admin: Locator;
}

export class SideNavigationComponent extends BasePage<TSideNavigationElements> {
  protected initializeElements(): void {
    // 3c: renamed from desktop-sidebar → app-sidebar (shadcn Sidebar root)
    const root = this.locate("app-sidebar", "App Sidebar");

    this._elements = {
      root,
      dashboard: this.withDescription(
        root.getByTestId("app-sidebar-nav-dashboard"),
        "Dashboard Sidebar Nav",
      ),
      portfolio: this.withDescription(
        root.getByTestId("app-sidebar-nav-portfolio"),
        "Portfolio Sidebar Nav",
      ),
      transactions: this.withDescription(
        root.getByTestId("app-sidebar-nav-transactions"),
        "Transactions Sidebar Nav",
      ),
      "cash-ledger": this.withDescription(
        root.getByTestId("app-sidebar-nav-cash-ledger"),
        "Cash Ledger Sidebar Nav",
      ),
      dividends: this.withDescription(
        root.getByTestId("app-sidebar-nav-dividends"),
        "Dividends Sidebar Nav",
      ),
      sharing: this.withDescription(
        root.getByTestId("app-sidebar-nav-sharing"),
        "Sharing Sidebar Nav",
      ),
      tickers: this.withDescription(
        root.getByTestId("app-sidebar-nav-tickers"),
        "Tickers Sidebar Nav",
      ),
      settings: this.withDescription(
        root.getByTestId("app-sidebar-nav-settings"),
        "Settings Sidebar Nav",
      ),
      admin: this.withDescription(
        root.getByTestId("app-sidebar-nav-admin"),
        "Admin Sidebar Nav",
      ),
    };
  }
}
