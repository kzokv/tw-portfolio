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
  transactionsTab: Locator;
  overviewTab: Locator;
  dividendsTab: Locator;
  dividendsTabOption: Locator;
  tabSelect: Locator;
  fundamentalsTab: Locator;
  dividendsPanel: Locator;
  dividendsOpenReview: Locator;
  dividendsPostedReviewLink: (index: number) => Locator;
  dividendsReconciliationReviewLink: (index: number) => Locator;
  dividendsReconciliationMarkMatched: (ledgerEntryId: string) => Locator;
  chartPanel: Locator;
  chartMetricControls: Locator;
  chartLineCurves: Locator;
  chartYAxisTickLabels: Locator;
  chartMetricButton: (metricLabel: string) => Locator;
  fundamentalsPanel: Locator;
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
      transactionsTab: this.locate("ticker-tab-transactions", "Ticker Transactions Tab"),
      overviewTab: this.locate("ticker-tab-overview", "Ticker Overview Tab"),
      dividendsTab: this.locate("ticker-tab-dividends", "Ticker Dividends Tab"),
      dividendsTabOption: this.withDescription(
        this.page.getByTestId("ticker-tab-select-dividends"),
        "Ticker Dividends Tab Select Option",
      ),
      tabSelect: this.locate("ticker-tab-select", "Ticker Tab Select"),
      fundamentalsTab: this.locate("ticker-tab-fundamentals", "Ticker Fundamentals Tab"),
      dividendsPanel: this.locate("ticker-detail-dividends-tab", "Ticker Dividends Panel"),
      dividendsOpenReview: this.locate("ticker-dividends-open-review", "Ticker Dividends Open Review Link"),
      dividendsPostedReviewLink: (index: number) =>
        this.locate(`ticker-posted-dividend-review-${index}`, `Ticker Posted Dividend Review Link ${index}`),
      dividendsReconciliationReviewLink: (index: number) =>
        this.locate(`ticker-open-reconciliation-review-${index}`, `Ticker Reconciliation Review Link ${index}`),
      dividendsReconciliationMarkMatched: (ledgerEntryId: string) =>
        this.locate(`ticker-reconciliation-mark-matched-${ledgerEntryId}`, `Ticker Dividends Mark Matched ${ledgerEntryId}`),
      chartPanel: this.locate("ticker-detail-chart", "Ticker Chart Panel"),
      chartMetricControls: this.locate("ticker-chart-metric-controls", "Ticker Chart Metric Controls"),
      chartLineCurves: this.withinByCss(
        this.locate("ticker-detail-chart"),
        ".recharts-line-curve",
        "Ticker Chart Line Curves",
      ),
      chartYAxisTickLabels: this.withinByCss(
        this.locate("ticker-detail-chart"),
        ".recharts-yAxis .recharts-cartesian-axis-tick-value",
        "Ticker Chart Y Axis Tick Labels",
      ),
      chartMetricButton: (metricLabel: string) =>
        this.withDescription(
          this.locate("ticker-chart-metric-controls").getByRole("button", { name: metricLabel, exact: true }),
          `Ticker Chart Metric Button ${metricLabel}`,
        ),
      fundamentalsPanel: this.locate("ticker-detail-fundamentals", "Ticker Fundamentals Panel"),
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
