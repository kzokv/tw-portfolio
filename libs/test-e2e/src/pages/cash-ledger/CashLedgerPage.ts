import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

export interface TCashLedgerElements {
  table: Locator;
  filterToolbar: Locator;
  summary: Locator;
  emptyState: Locator;
  drawer: Locator;
  row: (index: number) => Locator;
}

export class CashLedgerPage extends BasePage<TCashLedgerElements> {
  protected initializeElements(): void {
    this._elements = {
      table: this.locate("cash-ledger-table", "Cash Ledger Table"),
      filterToolbar: this.locate("cash-ledger-filter-toolbar", "Cash Ledger Filter Toolbar"),
      summary: this.locate("cash-ledger-summary", "Cash Ledger Summary"),
      emptyState: this.locate("cash-ledger-empty", "Cash Ledger Empty State"),
      drawer: this.locate("cash-ledger-drawer", "Cash Ledger Drawer"),
      row: (index: number) => this.page.locator(`[data-testid^="cash-ledger-row-"]`).nth(index),
    };
  }
}
