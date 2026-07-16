import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";

import type { TickerDetailPage } from "../../pages/tickers/TickerDetailPage.js";

const MUTATION_REFRESH_TIMEOUT_MS = 20_000;

export class TickerDetailAssert extends BaseAssert {
  declare protected readonly _instance: TickerDetailPage;

  private get el() {
    return this._instance.elements;
  }

  private async ensureTransactionsTabVisible(): Promise<void> {
    if (await this.el.transactionRows.first().isVisible().catch(() => false)) {
      return;
    }
    await this.uiActions.click.perform(this.el.transactionsTab);
  }

  @Step()
  async rowCountIs(count: number): Promise<void> {
    await this.ensureTransactionsTabVisible();
    await expect(this.el.transactionRows).toHaveCount(count, { timeout: MUTATION_REFRESH_TIMEOUT_MS });
  }

  @Step()
  async emptyStateIsVisible(): Promise<void> {
    await this.ensureTransactionsTabVisible();
    await expect(this.el.tickerHistoryEmpty).toBeVisible({ timeout: 10_000 });
  }

  @Step()
  async mutationStatusContains(text: string | RegExp, options?: { timeout?: number }): Promise<void> {
    await expect(this.el.mutationStatus).toContainText(text, options);
  }

  @Step()
  async recomputeSettles(): Promise<void> {
    await expect(this.el.mutationStatus).toContainText(
      /recomputed successfully|Portfolio updated/i,
      { timeout: 15_000 },
    );
  }

  @Step()
  async deleteDialogIsVisible(): Promise<void> {
    await expect(this.el.deleteDialog.confirmationDialog).toBeVisible();
  }

  @Step()
  async deleteDialogIsHidden(): Promise<void> {
    await expect(this.el.deleteDialog.confirmationDialog).toBeHidden();
  }

  @Step()
  async deleteDialogContainsFocus(): Promise<void> {
    expect(await this.el.deleteDialog.confirmationDialog.evaluate(
      (dialog) => dialog.contains(document.activeElement),
    )).toBe(true);
  }

  @Step()
  valueEquals(actual: unknown, expected: unknown): void {
    expect(actual).toEqual(expected);
  }

  @Step()
  valueMatchesObject(actual: unknown, expected: Record<string, unknown>): void {
    expect(actual).toMatchObject(expected);
  }

  @Step()
  async eventuallyValueEquals(read: () => unknown | Promise<unknown>, expected: unknown): Promise<void> {
    await expect.poll(read).toEqual(expected);
  }

  @Step()
  async deleteTradeSummaryContains(text: string | RegExp): Promise<void> {
    await expect(this.el.deleteDialog.tradeSummary).toContainText(text);
  }

  @Step()
  async deleteImpactCountsAreVisible(): Promise<void> {
    await expect(this.el.deleteDialog.impactCounts).toBeVisible();
  }

  @Step()
  async deleteDividendImpactIsVisible(): Promise<void> {
    await expect(this.el.deleteDialog.dividendImpact).toBeVisible();
  }

  @Step()
  async deleteConfirmContains(text: string | RegExp): Promise<void> {
    await expect(this.el.deleteDialog.confirmButton).toContainText(text);
  }

  @Step()
  async deleteControlsAreDisabled(): Promise<void> {
    await expect(this.el.deleteDialog.confirmButton).toBeDisabled();
    await expect(this.el.deleteDialog.cancelButton).toBeDisabled();
  }

  @Step()
  async deleteStatusContains(text: string | RegExp): Promise<void> {
    await expect(this.el.deleteDialog.statusMessage).toContainText(text);
  }

  @Step()
  async deleteErrorContains(text: string | RegExp): Promise<void> {
    await expect(this.el.deleteDialog.errorMessage).toContainText(text);
  }

  @Step()
  async transactionsTabIsActive(): Promise<void> {
    await expect(this.el.transactionsTab).toHaveAttribute("data-state", "active");
  }

  @Step()
  async viewportHasNoHorizontalOverflow(): Promise<void> {
    expect(await this.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  @Step()
  async deleteSnapshotImpactIsVisible(): Promise<void> {
    await expect(this.el.deleteDialog.snapshotImpact).toBeVisible({ timeout: 5_000 });
  }

  @Step()
  async deleteConfirmButtonIsDisabled(): Promise<void> {
    await expect(this.el.deleteDialog.confirmButton).toBeDisabled();
  }

  @Step()
  async deleteNegativeLotsWarningIsVisible(): Promise<void> {
    await expect(this.el.deleteDialog.negativeLotsWarning).toBeVisible({ timeout: 10_000 });
  }

  @Step()
  async deleteNegativeLotsWarningIsHidden(): Promise<void> {
    await expect(this.el.deleteDialog.negativeLotsWarning).toBeHidden();
  }

  @Step()
  async editableRowIsVisible(): Promise<void> {
    await this.ensureTransactionsTabVisible();
    await expect(this.el.editForm.editableRow).toBeVisible({ timeout: 5_000 });
  }

  @Step()
  async editableRowIsHidden(): Promise<void> {
    await expect(this.el.editForm.editableRow).toBeHidden();
  }

  @Step()
  async editConfirmDialogIsVisible(): Promise<void> {
    await expect(this.el.editForm.confirmationDialog).toBeVisible({ timeout: 10_000 });
  }

  @Step()
  async editConfirmDialogIsHidden(): Promise<void> {
    await expect(this.el.editForm.confirmationDialog).toBeHidden();
  }

  @Step()
  async editNegativeLotsWarningIsVisible(): Promise<void> {
    await expect(this.el.editForm.negativeLotsWarning).toBeVisible();
  }

  @Step()
  async editNegativeLotsWarningContains(text: string | RegExp): Promise<void> {
    await expect(this.el.editForm.negativeLotsWarning).toContainText(text);
  }

  @Step()
  async editCancelButtonIsVisible(): Promise<void> {
    await expect(this.el.editForm.dialogCancelButton).toBeVisible();
  }

  @Step()
  async titleContains(text: string | RegExp): Promise<void> {
    await expect(this.el.tickerHistoryTitle).toContainText(text, { timeout: 15_000 });
  }

  @Step()
  async chartPanelIsVisible(): Promise<void> {
    await expect(this.el.chartPanel).toBeVisible();
  }

  @Step()
  async chartMetricIsSelected(metricLabel: "Current Price" | "Unrealized P&L"): Promise<void> {
    await expect(this.el.chartMetricButton(metricLabel)).toHaveAttribute("data-state", "on");
  }

  @Step()
  async chartLineCurvesCountIsAtLeast(count: number): Promise<void> {
    await expect.poll(async () => this.el.chartLineCurves.count()).toBeGreaterThanOrEqual(count);
    await expect(this.el.chartLineCurves.first()).toBeVisible();
  }

  @Step()
  async chartYAxisTickLabelsCountIsAtLeast(count: number): Promise<void> {
    await expect.poll(async () => this.el.chartYAxisTickLabels.count()).toBeGreaterThanOrEqual(count);
    await expect(this.el.chartYAxisTickLabels.first()).toBeVisible();
  }

  @Step()
  async fundamentalsPanelIsVisible(): Promise<void> {
    await this.uiActions.click.perform(this.el.fundamentalsTab);
    await expect(this.el.fundamentalsPanel).toBeVisible();
  }

  @Step()
  async dividendsPanelIsVisible(): Promise<void> {
    await expect(this.el.dividendsPanel).toBeVisible();
  }

  @Step()
  async dividendsPanelContains(text: string | RegExp): Promise<void> {
    await expect(this.el.dividendsPanel).toContainText(text);
  }

  @Step()
  async dividendsOpenReviewHrefContains(ticker: string, marketCode: string): Promise<void> {
    await expect(this.el.dividendsOpenReview).toHaveAttribute(
      "href",
      new RegExp(`ticker=${ticker}.*marketCode=${marketCode}|marketCode=${marketCode}.*ticker=${ticker}`),
    );
  }

  @Step()
  async dividendsUpcomingReviewLinkPreservesMarket(ticker: string, marketCode: string): Promise<void> {
    const hrefPattern = new RegExp(`ticker=${ticker}.*marketCode=${marketCode}|marketCode=${marketCode}.*ticker=${ticker}`);
    await expect(this.el.dividendsUpcomingReviewLink(0)).toHaveAttribute("href", hrefPattern);
  }

  @Step()
  async dividendsPostedReviewButtonIsVisible(index: number): Promise<void> {
    await expect(this.el.dividendsPostedReviewButton(index)).toBeVisible();
  }

  @Step()
  async summaryPositionContains(quantity: string, totalCost: string | RegExp): Promise<void> {
    await expect(this.el.summaryQuantity).toContainText(quantity);
    await expect(this.el.summaryTotalCost).toContainText(totalCost);
  }

  @Step()
  async dividendReconciliationMarkMatchedIsHidden(dividendLedgerEntryId: string): Promise<void> {
    await expect(this.el.dividendsReconciliationMarkMatched(dividendLedgerEntryId)).toHaveCount(0);
  }

  @Step()
  async sectionIsVisible(): Promise<void> {
    await expect(this.el.clientReady).toBeAttached({ timeout: 20_000 });
    await expect(this.el.tickerHistorySection).toBeVisible({ timeout: 20_000 });
  }

  @Step()
  async rowMatchingTextsCount(
    texts: string[],
    count: number,
  ): Promise<void> {
    await this.ensureTransactionsTabVisible();
    let locator = this.el.transactionRows;
    for (const text of texts) {
      locator = locator.filter({ hasText: text });
    }
    await expect(locator).toHaveCount(count, { timeout: MUTATION_REFRESH_TIMEOUT_MS });
  }

  @Step()
  async firstRowHasMutationControls(): Promise<void> {
    await this.ensureTransactionsTabVisible();
    const firstRow = this.el.transactionRows.first();
    await expect(firstRow.getByTestId("edit-transaction-button")).toBeVisible();
    await expect(firstRow.getByTestId("delete-transaction-button")).toBeVisible();
  }

  @Step()
  async sectionContains(text: string | RegExp): Promise<void> {
    await expect(this.el.tickerHistorySection).toContainText(text);
  }

  @Step()
  async statsBarContains(text: string | RegExp): Promise<void> {
    await expect(this.el.tickerStatsBar).toContainText(text);
  }

  @Step()
  async statsBarNotContains(text: string | RegExp): Promise<void> {
    await expect(this.el.tickerStatsBar).not.toContainText(text);
  }

  @Step()
  async quantityStatContains(text: string | RegExp): Promise<void> {
    await expect(this.el.tickerQuantityStat).toContainText(text, { timeout: MUTATION_REFRESH_TIMEOUT_MS });
  }

  @Step()
  async avgCostStatContains(text: string | RegExp): Promise<void> {
    await expect(this.el.tickerAvgCostStat).toContainText(text, { timeout: MUTATION_REFRESH_TIMEOUT_MS });
  }

  @Step()
  async avgCostStatNotContains(text: string | RegExp): Promise<void> {
    await expect(this.el.tickerAvgCostStat).not.toContainText(text, { timeout: MUTATION_REFRESH_TIMEOUT_MS });
  }

  @Step()
  async firstRowContains(text: string | RegExp): Promise<void> {
    await this.ensureTransactionsTabVisible();
    await expect(this.el.transactionRows.first()).toContainText(text, { timeout: MUTATION_REFRESH_TIMEOUT_MS });
  }

  @Step()
  async rowContainingTextContains(rowText: string, expected: string | RegExp): Promise<void> {
    await this.ensureTransactionsTabVisible();
    await expect(this.el.transactionRows.filter({ hasText: rowText })).toContainText(expected, {
      timeout: MUTATION_REFRESH_TIMEOUT_MS,
    });
  }

  @Step()
  async recordDialogIsHidden(): Promise<void> {
    await expect(this.el.recordDialog.recordTransactionDialog).toBeHidden({ timeout: 10_000 });
  }

  @Step()
  async recordDialogFieldValueIs(field: "ticker" | "account" | "quantity" | "tradeDate", expected: string): Promise<void> {
    const fields = {
      ticker: this.el.recordDialog.tickerCombobox,
      account: this.el.recordDialog.accountSelect,
      quantity: this.el.recordDialog.quantityInput,
      tradeDate: this.el.recordDialog.tradeDateInput,
    };
    if (field === "ticker") {
      await expect(fields[field]).toHaveValue(new RegExp(expected));
      return;
    }
    await expect(fields[field]).toHaveValue(expected);
  }

  @Step()
  async recordDialogFieldHasAttribute(
    field: "price" | "quantity",
    name: string,
    expected: string | RegExp,
  ): Promise<void> {
    const fields = {
      price: this.el.recordDialog.priceInput,
      quantity: this.el.recordDialog.quantityInput,
    };
    await expect(fields[field]).toHaveAttribute(name, expected);
  }

  @Step()
  async editPriceInputIsVisible(): Promise<void> {
    await this.ensureTransactionsTabVisible();
    await expect(this.el.editForm.priceInput).toBeVisible();
  }

  @Step()
  async recordDialogTickerIsReadOnly(): Promise<void> {
    await expect(this.el.recordDialog.tickerCombobox).toHaveAttribute("readonly", "");
  }

  @Step()
  async repairButtonIsVisible(): Promise<void> {
    await expect(this.el.repairButton).toBeVisible();
  }

  @Step()
  async repairDialogIsVisible(): Promise<void> {
    await expect(this.el.repairDialog).toBeVisible();
  }

  @Step()
  async repairDialogIsHidden(): Promise<void> {
    await expect(this.el.repairDialog).not.toBeVisible();
  }

  @Step()
  async repairStatusBadgeContains(text: string | RegExp): Promise<void> {
    await expect(this.el.repairStatusBadge).toContainText(text);
  }

  @Step()
  async repairSuccessToastContains(text: string | RegExp): Promise<void> {
    await expect(this.el.repairSuccessToast).toContainText(text);
  }

  @Step()
  async repairErrorToastContains(text: string | RegExp): Promise<void> {
    await expect(this.el.repairErrorToast).toContainText(text);
  }
}
