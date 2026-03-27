import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

import { TransactionFormComponent } from "../shared/TransactionFormComponent.js";
import { DeleteDialogComponent } from "./DeleteDialogComponent.js";
import { EditFormComponent } from "./EditFormComponent.js";

export interface TTickerDetailElements {
  clientReady: Locator;
  symbolHistorySection: Locator;
  symbolHistoryTitle: Locator;
  symbolHistoryEmpty: Locator;
  symbolStatsBar: Locator;
  symbolQuantityStat: Locator;
  symbolAvgCostStat: Locator;
  transactionRows: Locator;
  mutationStatus: Locator;
  deleteDialog: DeleteDialogComponent;
  editForm: EditFormComponent;
  recordDialog: TransactionFormComponent;
}

export class TickerDetailPage extends BasePage<TTickerDetailElements> {
  protected initializeElements(): void {
    this._elements = {
      clientReady: this.locate("ticker-history-client-ready", "Ticker History Client Ready Marker"),
      symbolHistorySection: this.locate("symbol-history-section", "Symbol History Section"),
      symbolHistoryTitle: this.locate("symbol-history-title", "Symbol History Title"),
      symbolHistoryEmpty: this.locate("symbol-history-empty", "Symbol History Empty State"),
      symbolStatsBar: this.locate("symbol-stats-bar", "Symbol Stats Bar"),
      symbolQuantityStat: this.locate("symbol-history-quantity", "Symbol Quantity Stat"),
      symbolAvgCostStat: this.locate("symbol-history-avg-cost", "Symbol Average Cost Stat"),
      transactionRows: this.withDescription(
        this.page.getByTestId("transaction-row"),
        "Transaction Rows",
      ),
      mutationStatus: this.withDescription(
        this.page.getByTestId("mutation-status").first(),
        "Mutation Status",
      ),
      deleteDialog: new DeleteDialogComponent(this.page),
      editForm: new EditFormComponent(this.page),
      recordDialog: new TransactionFormComponent(this.page),
    };
  }
}
