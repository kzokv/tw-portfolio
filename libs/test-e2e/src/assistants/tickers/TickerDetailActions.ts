import { expect } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { TickerDetailPage } from "../../pages/tickers/TickerDetailPage.js";

export class TickerDetailActions extends AppBaseActions {
  declare protected readonly _instance: TickerDetailPage;

  private get el() {
    return this._instance.elements;
  }

  private async waitForClientReady(): Promise<void> {
    await expect(this.el.clientReady).toBeAttached();
  }

  @Step()
  async navigateToTicker(ticker: string): Promise<void> {
    await this.mxGotoUrl(new URL(`/tickers/${ticker}`, TestEnv.appBaseUrl).href);
    await this.mxWaitForShellClientReady();
    await this.waitForClientReady();
    await expect(this.el.tickerHistorySection).toBeVisible({ timeout: 20_000 });
  }

  @Step()
  async openTransactionsTab(): Promise<void> {
    await this.uiActions.click.perform(this.el.transactionsTab);
  }

  @Step()
  async openFundamentalsTab(): Promise<void> {
    await this.uiActions.click.perform(this.el.fundamentalsTab);
  }

  @Step()
  async selectChartMetric(metricLabel: "Current Price" | "Unrealized P&L"): Promise<void> {
    const button = this.el.chartMetricButton(metricLabel);
    await this.uiActions.click.perform(button);
    await expect(button).toHaveAttribute("data-state", "on");
  }

  private async ensureTransactionsTabVisible(): Promise<void> {
    if (await this.el.transactionRows.first().isVisible().catch(() => false)) {
      return;
    }
    await this.openTransactionsTab();
  }

  @Step()
  async clickDeleteOnRow(rowText: string): Promise<void> {
    await this.waitForClientReady();
    await this.ensureTransactionsTabVisible();
    const row = this.el.transactionRows.filter({ hasText: rowText });
    await this.uiActions.click.perform(row.getByTestId("delete-transaction-button"));
  }

  @Step()
  async confirmDelete(): Promise<import("@playwright/test").Response> {
    const responsePromise = this.mxWaitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "DELETE",
    );
    await this.uiActions.click.perform(this.el.deleteDialog.confirmButton);
    return responsePromise;
  }

  @Step()
  async clickEditOnRow(rowText: string): Promise<void> {
    await this.waitForClientReady();
    await this.ensureTransactionsTabVisible();
    const row = this.el.transactionRows.filter({ hasText: rowText });
    await this.uiActions.click.perform(row.getByTestId("edit-transaction-button"));
  }

  @Step()
  async clickEditOnFirstRow(): Promise<void> {
    await this.waitForClientReady();
    await this.ensureTransactionsTabVisible();
    const row = this.el.transactionRows.first();
    await this.uiActions.click.perform(row.getByTestId("edit-transaction-button"));
  }

  @Step()
  async fillEditQuantity(value: string): Promise<void> {
    await this.mxFill(this.el.editForm.quantityInput, value);
  }

  @Step()
  async fillEditPrice(value: string): Promise<void> {
    await this.mxFill(this.el.editForm.priceInput, value);
  }

  @Step()
  async selectEditSide(value: "BUY" | "SELL"): Promise<void> {
    await this.mxSelectOption(this.el.editForm.sideSelect, value);
  }

  @Step()
  async saveEdit(): Promise<import("@playwright/test").Response> {
    const responsePromise = this.mxWaitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "PATCH",
    );
    await this.uiActions.click.perform(this.el.editForm.saveButton);
    return responsePromise;
  }

  @Step()
  async submitEditForPreview(): Promise<void> {
    await this.uiActions.click.perform(this.el.editForm.saveButton);
  }

  @Step()
  async cancelEdit(): Promise<void> {
    await this.uiActions.click.perform(this.el.editForm.inlineCancelButton);
  }

  @Step()
  async openRecordDialog(): Promise<void> {
    await this.waitForClientReady();
    await this.uiActions.click.perform(this.el.recordDialog.recordTransactionButton);
    await expect(this.el.recordDialog.recordTransactionDialog).toBeVisible();
  }

  @Step()
  async fillRecordPrice(value: string): Promise<void> {
    await this.mxFill(this.el.recordDialog.priceInput, value);
  }

  @Step()
  async submitRecord(): Promise<import("@playwright/test").Response> {
    const responsePromise = this.mxWaitForResponse(
      (r) => r.url().includes("/portfolio/transactions") && r.request().method() === "POST",
    );
    await this.uiActions.click.perform(
      this.el.recordDialog.recordTransactionDialog
        .getByTestId("tx-submit-button"),
    );
    return responsePromise;
  }

  @Step()
  async cancelDelete(): Promise<void> {
    await this.uiActions.click.perform(this.el.deleteDialog.cancelButton);
  }

  @Step()
  async cancelEditConfirmation(): Promise<void> {
    await this.uiActions.click.perform(this.el.editForm.dialogCancelButton);
  }

  @Step()
  async openRepairDialog(): Promise<void> {
    await this.waitForClientReady();
    await this.uiActions.click.perform(this.el.repairButton);
    await expect(this.el.repairDialog).toBeVisible();
  }

  @Step()
  async setRepairDateRange(startDate: string, endDate: string): Promise<void> {
    await this.mxFill(this.el.repairStartDateInput, startDate);
    await this.mxFill(this.el.repairEndDateInput, endDate);
  }

  @Step()
  async setRepairIncludeBars(enabled: boolean): Promise<void> {
    const checked = await this.el.repairIncludeBarsCheckbox.isChecked();
    if (checked !== enabled) {
      await this.uiActions.click.perform(this.el.repairIncludeBarsCheckbox);
    }
  }

  @Step()
  async setRepairIncludeDividends(enabled: boolean): Promise<void> {
    const checked = await this.el.repairIncludeDividendsCheckbox.isChecked();
    if (checked !== enabled) {
      await this.uiActions.click.perform(this.el.repairIncludeDividendsCheckbox);
    }
  }

  @Step()
  async submitRepair(): Promise<import("@playwright/test").Response> {
    const responsePromise = this.mxWaitForResponse(
      (r) => r.url().includes("/backfill/repair") && r.request().method() === "POST",
    );
    await this.uiActions.click.perform(this.el.repairSubmitButton);
    return responsePromise;
  }
}
