import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { TickerDetailPage } from "../../pages/tickers/TickerDetailPage.js";

export class TickerDetailAssert extends BaseAssert {
  declare protected readonly _instance: TickerDetailPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async rowCountIs(count: number): Promise<void> {
    await expect(this.el.transactionRows).toHaveCount(count);
  }

  @Step()
  async emptyStateIsVisible(): Promise<void> {
    await expect(this.el.symbolHistoryEmpty).toBeVisible({ timeout: 10_000 });
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
    await expect(this.el.deleteDialog.elements.confirmationDialog).toBeVisible();
  }

  @Step()
  async deleteDialogIsHidden(): Promise<void> {
    await expect(this.el.deleteDialog.elements.confirmationDialog).toBeHidden();
  }

  @Step()
  async deleteTradeSummaryContains(text: string | RegExp): Promise<void> {
    await expect(this.el.deleteDialog.elements.tradeSummary).toContainText(text);
  }

  @Step()
  async deleteImpactCountsAreVisible(): Promise<void> {
    await expect(this.el.deleteDialog.elements.impactCounts).toBeVisible();
  }

  @Step()
  async deleteConfirmButtonIsHidden(): Promise<void> {
    await expect(this.el.deleteDialog.elements.confirmButton).toBeHidden();
  }

  @Step()
  async deleteNegativeLotsWarningIsVisible(): Promise<void> {
    await expect(this.el.deleteDialog.elements.negativeLotsWarning).toBeVisible({ timeout: 10_000 });
  }

  @Step()
  async deleteNegativeLotsWarningIsHidden(): Promise<void> {
    await expect(this.el.deleteDialog.elements.negativeLotsWarning).toBeHidden();
  }

  @Step()
  async editableRowIsVisible(): Promise<void> {
    await expect(this.el.editForm.elements.editableRow).toBeVisible({ timeout: 5_000 });
  }

  @Step()
  async editableRowIsHidden(): Promise<void> {
    await expect(this.el.editForm.elements.editableRow).toBeHidden();
  }

  @Step()
  async editConfirmDialogIsVisible(): Promise<void> {
    await expect(this.el.editForm.elements.confirmationDialog).toBeVisible({ timeout: 10_000 });
  }

  @Step()
  async editConfirmDialogIsHidden(): Promise<void> {
    await expect(this.el.editForm.elements.confirmationDialog).toBeHidden();
  }

  @Step()
  async editNegativeLotsWarningIsVisible(): Promise<void> {
    await expect(this.el.editForm.elements.negativeLotsWarning).toBeVisible();
  }

  @Step()
  async editNegativeLotsWarningContains(text: string | RegExp): Promise<void> {
    await expect(this.el.editForm.elements.negativeLotsWarning).toContainText(text);
  }

  @Step()
  async editCancelButtonIsVisible(): Promise<void> {
    await expect(this.el.editForm.elements.dialogCancelButton).toBeVisible();
  }

  @Step()
  async titleContains(text: string | RegExp): Promise<void> {
    await expect(this.el.symbolHistoryTitle).toContainText(text, { timeout: 15_000 });
  }

  @Step()
  async sectionIsVisible(): Promise<void> {
    await expect(this.el.clientReady).toBeAttached({ timeout: 20_000 });
    await expect(this.el.symbolHistorySection).toBeVisible({ timeout: 20_000 });
  }

  @Step()
  async rowMatchingTextsCount(
    texts: string[],
    count: number,
  ): Promise<void> {
    let locator = this.el.transactionRows;
    for (const text of texts) {
      locator = locator.filter({ hasText: text });
    }
    await expect(locator).toHaveCount(count);
  }

  @Step()
  async firstRowHasMutationControls(): Promise<void> {
    const firstRow = this.el.transactionRows.first();
    await expect(firstRow.getByTestId("edit-transaction-button")).toBeVisible();
    await expect(firstRow.getByTestId("delete-transaction-button")).toBeVisible();
  }

  @Step()
  async sectionContains(text: string | RegExp): Promise<void> {
    await expect(this.el.symbolHistorySection).toContainText(text);
  }

  @Step()
  async statsBarContains(text: string | RegExp): Promise<void> {
    await expect(this.el.symbolStatsBar).toContainText(text);
  }

  @Step()
  async statsBarNotContains(text: string | RegExp): Promise<void> {
    await expect(this.el.symbolStatsBar).not.toContainText(text);
  }

  @Step()
  async quantityStatContains(text: string | RegExp): Promise<void> {
    await expect(this.el.symbolQuantityStat).toContainText(text);
  }

  @Step()
  async avgCostStatContains(text: string | RegExp): Promise<void> {
    await expect(this.el.symbolAvgCostStat).toContainText(text);
  }

  @Step()
  async avgCostStatNotContains(text: string | RegExp): Promise<void> {
    await expect(this.el.symbolAvgCostStat).not.toContainText(text);
  }

  @Step()
  async firstRowContains(text: string | RegExp): Promise<void> {
    await expect(this.el.transactionRows.first()).toContainText(text);
  }

  @Step()
  async rowContainingTextContains(rowText: string, expected: string | RegExp): Promise<void> {
    await expect(this.el.transactionRows.filter({ hasText: rowText })).toContainText(expected);
  }

  @Step()
  async recordDialogIsHidden(): Promise<void> {
    await expect(this.el.recordDialog.elements.recordTransactionDialog).toBeHidden({ timeout: 10_000 });
  }

  @Step()
  async recordDialogFieldValueIs(field: "symbol" | "account" | "quantity" | "tradeDate", expected: string): Promise<void> {
    const fields = {
      symbol: this.el.recordDialog.elements.symbolSelect,
      account: this.el.recordDialog.elements.accountSelect,
      quantity: this.el.recordDialog.elements.quantityInput,
      tradeDate: this.el.recordDialog.elements.tradeDateInput,
    };
    await expect(fields[field]).toHaveValue(expected);
  }

  @Step()
  async recordDialogFieldHasAttribute(
    field: "price" | "quantity",
    name: string,
    expected: string | RegExp,
  ): Promise<void> {
    const fields = {
      price: this.el.recordDialog.elements.priceInput,
      quantity: this.el.recordDialog.elements.quantityInput,
    };
    await expect(fields[field]).toHaveAttribute(name, expected);
  }

  @Step()
  async editPriceInputIsVisible(): Promise<void> {
    await expect(this.el.editForm.elements.priceInput).toBeVisible();
  }
}
