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

  @Step()
  async rowCountIs(count: number): Promise<void> {
    await expect(this.el.transactionRows).toHaveCount(count, { timeout: MUTATION_REFRESH_TIMEOUT_MS });
  }

  @Step()
  async emptyStateIsVisible(): Promise<void> {
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
  async deleteTradeSummaryContains(text: string | RegExp): Promise<void> {
    await expect(this.el.deleteDialog.tradeSummary).toContainText(text);
  }

  @Step()
  async deleteImpactCountsAreVisible(): Promise<void> {
    await expect(this.el.deleteDialog.impactCounts).toBeVisible();
  }

  @Step()
  async deleteSnapshotImpactIsVisible(): Promise<void> {
    await expect(this.el.deleteDialog.snapshotImpact).toBeVisible({ timeout: 5_000 });
  }

  @Step()
  async deleteConfirmButtonIsHidden(): Promise<void> {
    await expect(this.el.deleteDialog.confirmButton).toBeHidden();
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
  async sectionIsVisible(): Promise<void> {
    await expect(this.el.clientReady).toBeAttached({ timeout: 20_000 });
    await expect(this.el.tickerHistorySection).toBeVisible({ timeout: 20_000 });
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
    await expect(locator).toHaveCount(count, { timeout: MUTATION_REFRESH_TIMEOUT_MS });
  }

  @Step()
  async firstRowHasMutationControls(): Promise<void> {
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
    await expect(this.el.transactionRows.first()).toContainText(text, { timeout: MUTATION_REFRESH_TIMEOUT_MS });
  }

  @Step()
  async rowContainingTextContains(rowText: string, expected: string | RegExp): Promise<void> {
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
