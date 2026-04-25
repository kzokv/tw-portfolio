import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@tw-portfolio/test-framework/core";

export interface TCashLedgerElements extends TElementLocatorHelpers {
  tableOrEmpty: Locator;
  table: Locator;
  filterToolbar: Locator;
  summary: Locator;
  emptyState: Locator;
  drawer: Locator;
  row: (index: number) => Locator;
  rows: Locator;
  columnHeader: (field: string) => Locator;
  navLink: Locator;
  pagination: Locator;
  paginationPrev: Locator;
  paginationNext: Locator;
  paginationInfo: Locator;
}

export class CashLedgerPage extends BasePage<TCashLedgerElements> {
  protected initializeElements(): void {
    this._elements = {
      ...this.locatorHelpers(),
      tableOrEmpty: this.withDescription(
        this.locate("cash-ledger-table").or(this.locate("cash-ledger-empty")),
        "Cash Ledger Table Or Empty State",
      ),
      table: this.locate("cash-ledger-table", "Cash Ledger Table"),
      filterToolbar: this.locate("cash-ledger-filter-toolbar", "Cash Ledger Filter Toolbar"),
      summary: this.locate("cash-ledger-summary", "Cash Ledger Summary"),
      emptyState: this.locate("cash-ledger-empty", "Cash Ledger Empty State"),
      drawer: this.locate("cash-ledger-drawer", "Cash Ledger Drawer"),
      row: (index: number) =>
        this.withDescription(
          this.scope.locator(`[data-testid^="cash-ledger-row-"]`).nth(index),
          `Cash Ledger Row ${index}`,
        ),
      rows: this.withDescription(
        this.scope.locator('[data-testid^="cash-ledger-row-"]'),
        "Cash Ledger Rows",
      ),
      columnHeader: (field: string) =>
        this.withDescription(
          this.locate("cash-ledger-table").locator("th").filter({ hasText: new RegExp(field, "i") }),
          `Cash Ledger ${field} Column Header`,
        ),
      navLink: this.withDescription(
        this.locate("desktop-sidebar").getByTestId("sidebar-link-cash-ledger"),
        "Cash Ledger Sidebar Link",
      ),
      pagination: this.locate("pagination", "Pagination Controls"),
      paginationPrev: this.locate("pagination-prev", "Pagination Previous"),
      paginationNext: this.locate("pagination-next", "Pagination Next"),
      paginationInfo: this.locate("pagination-info", "Pagination Info"),
    };
  }
}
