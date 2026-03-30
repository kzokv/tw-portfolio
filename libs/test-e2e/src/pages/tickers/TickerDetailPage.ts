import type { Locator } from "@playwright/test";
import { BasePage } from "@tw-portfolio/test-framework/core";

import { TransactionFormComponent } from "../shared/TransactionFormComponent.js";
import { DeleteDialogComponent } from "./DeleteDialogComponent.js";
import { EditFormComponent } from "./EditFormComponent.js";

export interface TTickerDetailElements {
  clientReady: Locator;
  tickerHistorySection: Locator;
  tickerHistoryTitle: Locator;
  tickerHistoryEmpty: Locator;
  tickerStatsBar: Locator;
  tickerQuantityStat: Locator;
  tickerAvgCostStat: Locator;
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
      tickerHistorySection: this.locate("ticker-history-section", "Ticker History Section"),
      tickerHistoryTitle: this.locate("ticker-history-title", "Ticker History Title"),
      tickerHistoryEmpty: this.locate("ticker-history-empty", "Ticker History Empty State"),
      tickerStatsBar: this.locate("ticker-stats-bar", "Ticker Stats Bar"),
      tickerQuantityStat: this.locate("ticker-history-quantity", "Ticker Quantity Stat"),
      tickerAvgCostStat: this.locate("ticker-history-avg-cost", "Ticker Average Cost Stat"),
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
