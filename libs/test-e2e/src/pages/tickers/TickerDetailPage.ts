import type { Locator } from "@playwright/test";
import { BasePage } from "@vakwen/test-framework/core";

import { TransactionFormComponent, type TTransactionFormElements } from "../shared/TransactionFormComponent.js";
import { DeleteDialogComponent, type TDeleteDialogElements } from "./DeleteDialogComponent.js";
import { EditFormComponent, type TEditFormElements } from "./EditFormComponent.js";

export interface TTickerDetailElements {
  clientReady: Locator;
  tickerHistorySection: Locator;
  tickerHistoryTitle: Locator;
  tickerHistoryEmpty: Locator;
  tickerStatsBar: Locator;
  tickerQuantityStat: Locator;
  tickerAvgCostStat: Locator;
  repairButton: Locator;
  repairStatusBadge: Locator;
  repairDialog: Locator;
  repairStartDateInput: Locator;
  repairEndDateInput: Locator;
  repairIncludeBarsCheckbox: Locator;
  repairIncludeDividendsCheckbox: Locator;
  repairSubmitButton: Locator;
  repairSuccessToast: Locator;
  repairErrorToast: Locator;
  transactionRows: Locator;
  mutationStatus: Locator;
  deleteDialog: TDeleteDialogElements;
  editForm: TEditFormElements;
  recordDialog: TTransactionFormElements;
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
      repairButton: this.withDescription(
        this.page.getByTestId("repair-button"),
        "Ticker Repair Button",
      ),
      repairStatusBadge: this.withDescription(
        this.page.getByTestId("repair-status-badge"),
        "Ticker Repair Status Badge",
      ),
      repairDialog: this.withDescription(
        this.page.getByTestId("repair-modal"),
        "Ticker Repair Dialog",
      ),
      repairStartDateInput: this.withDescription(
        this.page.getByTestId("repair-start-date"),
        "Ticker Repair Start Date Input",
      ),
      repairEndDateInput: this.withDescription(
        this.page.getByTestId("repair-end-date"),
        "Ticker Repair End Date Input",
      ),
      repairIncludeBarsCheckbox: this.withDescription(
        this.page.getByTestId("repair-include-bars"),
        "Ticker Repair Include Bars Checkbox",
      ),
      repairIncludeDividendsCheckbox: this.withDescription(
        this.page.getByTestId("repair-include-dividends"),
        "Ticker Repair Include Dividends Checkbox",
      ),
      repairSubmitButton: this.withDescription(
        this.page.getByTestId("repair-submit"),
        "Ticker Repair Submit Button",
      ),
      repairSuccessToast: this.withDescription(
        this.page.locator('[data-testid="repair-status"], [data-testid="mutation-status"]').first(),
        "Ticker Repair Success Toast",
      ),
      repairErrorToast: this.withDescription(
        this.page.locator('[data-testid="repair-error"], [data-testid="mutation-error"]').first(),
        "Ticker Repair Error Toast",
      ),
      transactionRows: this.withDescription(
        this.page.getByTestId("transaction-row"),
        "Transaction Rows",
      ),
      mutationStatus: this.withDescription(
        this.page.getByTestId("mutation-status").first(),
        "Mutation Status",
      ),
      deleteDialog: new DeleteDialogComponent(this.page).elements,
      editForm: new EditFormComponent(this.page).elements,
      recordDialog: new TransactionFormComponent(this.page).elements,
    };
  }
}
