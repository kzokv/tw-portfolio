import type { Response } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { DividendReviewPage } from "../../pages/dividends/DividendReviewPage.js";

export class DividendReviewActions extends AppBaseActions {
  declare protected readonly _instance: DividendReviewPage;

  private get el() {
    return this._instance.elements;
  }

  // ─── Navigation ──────────────────────────────────────────────────────────

  @Step()
  async navigateToReview(): Promise<void> {
    // Phase 5a — /dividends/review was merged into /dividends?view=ledger.
    await this.mxNavigateToRoute("/dividends?view=ledger", TestEnv.appBaseUrl);
  }

  @Step()
  async navigateToReviewWithParams(params: string): Promise<void> {
    // Phase 5a — caller-supplied params are merged with view=ledger.
    const prefix = params.includes("view=") ? "" : "view=ledger&";
    await this.mxNavigateToRoute(`/dividends?${prefix}${params}`, TestEnv.appBaseUrl);
  }

  @Step()
  async navigateToCalendar(): Promise<void> {
    await this.mxNavigateToRoute("/dividends", TestEnv.appBaseUrl);
  }

  // ─── Filter bar — presets ────────────────────────────────────────────────

  @Step()
  async clickPreset(presetName: string): Promise<void> {
    await this.uiActions.click.perform(this.el.preset(presetName));
  }

  // ─── Filter bar — date inputs ────────────────────────────────────────────

  @Step()
  async fillDateFrom(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.dateFrom, value);
  }

  @Step()
  async fillDateTo(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.dateTo, value);
  }

  @Step()
  async clearDateTo(): Promise<void> {
    await this.el.dateTo.clear();
    await this.el.dateTo.blur();
  }

  @Step()
  async blurDateInputs(): Promise<void> {
    await this.el.dateTo.blur();
  }

  // ─── Filter bar — ticker ─────────────────────────────────────────────────

  @Step()
  async fillTicker(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.tickerInput, value);
  }

  @Step()
  async submitTickerFilter(): Promise<void> {
    // Filter submit triggers an async fetch against
    // /portfolio/dividends/review — wait for the response before returning
    // so downstream assertions race-free observe the filtered row set.
    const responsePromise = this.mxWaitForResponse(
      (r) => r.url().includes("/portfolio/dividends/review") && r.ok(),
    ).catch(() => undefined);
    await this.mxPressKey("Enter");
    await responsePromise;
  }

  // ─── Filter bar — dropdowns ──────────────────────────────────────────────

  @Step()
  async selectStatus(value: string): Promise<void> {
    await this.uiActions.select.perform(this.el.statusSelect, value);
  }

  @Step()
  async selectAccount(value: string): Promise<void> {
    await this.uiActions.select.perform(this.el.accountSelect, value);
  }

  // ─── Chart interactions ���─────────────────────────────────────────────────

  @Step()
  async clickChartTab(tab: "monthly" | "accumulated" | "byTicker"): Promise<void> {
    await this.uiActions.click.perform(this.el.chartTab(tab));
  }

  @Step()
  async clickGranularity(level: "month" | "quarter" | "year"): Promise<void> {
    await this.uiActions.click.perform(this.el.chartGranularityButton(level));
  }

  @Step()
  async selectCurrency(currencyCode: string): Promise<void> {
    await this.uiActions.select.perform(this.el.currencySelect, currencyCode);
  }

  // ─── Table interactions ──────────────────────────────────────────────────

  @Step()
  async clickColumnHeader(field: string): Promise<void> {
    await this.uiActions.click.perform(this.el.tableHeader(field).first());
  }

  @Step()
  async clickRow(ledgerEntryId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.row(ledgerEntryId));
  }

  @Step()
  async clickMarkMatched(ledgerEntryId: string): Promise<Response> {
    const patchResponsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "PATCH"
        && response.url().includes("/portfolio/dividends/postings/")
        && response.url().includes("/reconciliation"),
    );

    await this.uiActions.click.perform(this.el.markMatchedButton(ledgerEntryId));
    return await patchResponsePromise;
  }

  // ─── Pagination ──────────────────────────────────────────────────────────

  @Step()
  async clickNextPage(): Promise<void> {
    await this.uiActions.click.perform(this.el.paginationNext);
  }

  @Step()
  async clickPreviousPage(): Promise<void> {
    await this.uiActions.click.perform(this.el.paginationPrev);
  }

  // ─── Calendar page navigation ───��────────────────────────────────────────

  @Step()
  async clickNhiRollupPendingLink(): Promise<void> {
    await this.uiActions.click.perform(this.el.nhiRollupPendingLink);
  }

  @Step()
  async clickViewAllDividendsLink(): Promise<void> {
    await this.uiActions.click.perform(this.el.pendingLink);
    await this.mxWaitForAppReady();
  }
}
