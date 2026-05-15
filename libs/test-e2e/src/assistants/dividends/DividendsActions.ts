import { randomUUID } from "node:crypto";
import type { APIResponse, Response } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { DividendCalendarPage } from "../../pages/dividends/DividendCalendarPage.js";

export class DividendsActions extends AppBaseActions {
  declare protected readonly _instance: DividendCalendarPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToCalendar(): Promise<void> {
    await this.mxNavigateToRoute("/dividends", TestEnv.appBaseUrl);
  }

  @Step()
  async openPostingDrawerForEvent(eventId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.postButton(eventId));
  }

  @Step()
  async openEditDrawerForEvent(eventId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.editButton(eventId));
  }

  @Step()
  async fillReceivedCash(value: number): Promise<void> {
    await this.uiActions.fill.perform(this.el.drawer.receivedCashInput, String(value));
  }

  @Step()
  async fillReceivedStock(value: number): Promise<void> {
    await this.uiActions.fill.perform(this.el.drawer.receivedStockInput, String(value));
  }

  @Step()
  async addSourceLine(amount: number, bucket = "DIVIDEND_INCOME"): Promise<void> {
    await this.uiActions.click.perform(this.el.drawer.sourceLines.addButton);
    await this.uiActions.select.perform(this.el.drawer.sourceLines.bucketSelect(0), bucket);
    await this.uiActions.fill.perform(this.el.drawer.sourceLines.amountInput(0), String(amount));
  }

  @Step()
  async toggleUnknownSourceDisclosure(enabled?: boolean): Promise<void> {
    const toggle = this.el.drawer.sourceLines.unknownToggle;
    const isChecked = await toggle.isChecked();
    if (enabled === undefined || isChecked !== enabled) {
      await this.uiActions.click.perform(toggle);
    }
  }

  @Step()
  async clickSaveButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.drawer.saveButton);
  }

  @Step()
  async submitPostingForm(): Promise<Response> {
    const postingResponsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "POST"
        && response.url().includes("/portfolio/dividends/postings"),
    );

    await this.clickSaveButton();
    return await postingResponsePromise;
  }

  @Step()
  async clickMarkMatchedInline(eventId: string): Promise<Response> {
    const patchResponsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "PATCH"
        && response.url().includes("/portfolio/dividends/postings/")
        && response.url().includes("/reconciliation"),
    );

    await this.uiActions.click.perform(this.el.markMatchedButton(eventId));
    return await patchResponsePromise;
  }

  @Step()
  async selectReconcileStatus(status: "open" | "matched" | "explained" | "resolved"): Promise<void> {
    await this.uiActions.select.perform(this.el.drawer.reconcileStatusSelect, status);
  }

  @Step()
  async fillReconcileNote(note: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.drawer.reconcileNote, note);
  }

  @Step()
  async submitReconciliationForm(): Promise<Response> {
    const patchResponsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "PATCH"
        && response.url().includes("/portfolio/dividends/postings/")
        && response.url().includes("/reconciliation"),
    );

    await this.uiActions.click.perform(this.el.drawer.reconcileSaveButton);
    return await patchResponsePromise;
  }

  @Step()
  async clickReconcileSaveButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.drawer.reconcileSaveButton);
  }

  @Step()
  async clickSourceCompositionToggle(): Promise<void> {
    await this.uiActions.click.perform(this.el.drawer.sourceCompositionToggle);
  }

  @Step()
  async updatePostedDividendViaApi(data: Record<string, unknown>): Promise<APIResponse> {
    if (!this.userId) throw new Error("updatePostedDividendViaApi requires userId");

    return await this.request.post(new URL("/portfolio/dividends/postings", TestEnv.apiBaseUrl).href, {
      headers: {
        "content-type": "application/json",
        "idempotency-key": `background-dividend-${randomUUID()}`,
        "x-user-id": this.userId,
      },
      data,
    });
  }
}
