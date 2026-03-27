import { expect } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
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
    await this.page.goto(
      new URL(`/tickers/${ticker}`, TestEnv.appBaseUrl).href,
      { waitUntil: "domcontentloaded" },
    );
    await this.mxWaitForShellClientReady();
    await this.waitForClientReady();
    await expect(this.el.symbolHistorySection).toBeVisible({ timeout: 20_000 });
  }

  @Step()
  async clickDeleteOnRow(rowText: string): Promise<void> {
    await this.waitForClientReady();
    const row = this.el.transactionRows.filter({ hasText: rowText });
    await this.uiActions.click.perform(row.getByTestId("delete-transaction-button"));
  }

  @Step()
  async confirmDelete(): Promise<import("@playwright/test").Response> {
    const responsePromise = this.page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "DELETE",
    );
    await this.uiActions.click.perform(this.el.deleteDialog.elements.confirmButton);
    return responsePromise;
  }

  @Step()
  async clickEditOnRow(rowText: string): Promise<void> {
    await this.waitForClientReady();
    const row = this.el.transactionRows.filter({ hasText: rowText });
    await this.uiActions.click.perform(row.getByTestId("edit-transaction-button"));
  }

  @Step()
  async clickEditOnFirstRow(): Promise<void> {
    await this.waitForClientReady();
    const row = this.el.transactionRows.first();
    await this.uiActions.click.perform(row.getByTestId("edit-transaction-button"));
  }

  @Step()
  async fillEditQuantity(value: string): Promise<void> {
    await this.mxFill(this.el.editForm.elements.quantityInput, value);
  }

  @Step()
  async fillEditPrice(value: string): Promise<void> {
    await this.mxFill(this.el.editForm.elements.priceInput, value);
  }

  @Step()
  async selectEditSide(value: "BUY" | "SELL"): Promise<void> {
    await this.mxSelectOption(this.el.editForm.elements.sideSelect, value);
  }

  @Step()
  async saveEdit(): Promise<import("@playwright/test").Response> {
    const responsePromise = this.page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions/") && r.request().method() === "PATCH",
    );
    await this.uiActions.click.perform(this.el.editForm.elements.saveButton);
    return responsePromise;
  }

  @Step()
  async submitEditForPreview(): Promise<void> {
    await this.uiActions.click.perform(this.el.editForm.elements.saveButton);
  }

  @Step()
  async cancelEdit(): Promise<void> {
    await this.uiActions.click.perform(this.el.editForm.elements.inlineCancelButton);
  }

  @Step()
  async openRecordDialog(): Promise<void> {
    await this.waitForClientReady();
    await this.uiActions.click.perform(this.el.recordDialog.elements.recordTransactionButton);
    await expect(this.el.recordDialog.elements.recordTransactionDialog).toBeVisible();
  }

  @Step()
  async fillRecordPrice(value: string): Promise<void> {
    await this.mxFill(this.el.recordDialog.elements.priceInput, value);
  }

  @Step()
  async submitRecord(): Promise<import("@playwright/test").Response> {
    const responsePromise = this.page.waitForResponse(
      (r) => r.url().includes("/portfolio/transactions") && r.request().method() === "POST",
    );
    await this.uiActions.click.perform(
      this.el.recordDialog.elements.recordTransactionDialog
        .getByTestId("tx-submit-button"),
    );
    return responsePromise;
  }

  @Step()
  async cancelDelete(): Promise<void> {
    await this.uiActions.click.perform(this.el.deleteDialog.elements.cancelButton);
  }

  @Step()
  async cancelEditConfirmation(): Promise<void> {
    await this.uiActions.click.perform(this.el.editForm.elements.dialogCancelButton);
  }
}
