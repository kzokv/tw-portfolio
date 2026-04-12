import type { Response } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
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
    await this.mxNavigateToRoute("/dividends/review", TestEnv.appBaseUrl);
  }

  @Step()
  async navigateToReviewWithParams(params: string): Promise<void> {
    await this.mxNavigateToRoute(`/dividends/review?${params}`, TestEnv.appBaseUrl);
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
    await this.el.tickerInput.press("Enter");
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
    // Granularity buttons are inside the toggle container, identified by their text content
    const button = this.el.granularityToggle.locator("button").filter({
      has: this.page.locator(`text=/${level}/i`),
    });
    await this.uiActions.click.perform(button);
  }

  @Step()
  async selectCurrency(currencyCode: string): Promise<void> {
    await this.uiActions.select.perform(this.el.currencySelect, currencyCode);
  }

  // ─── Table interactions ──────────────────────────────────────────────────

  @Step()
  async clickColumnHeader(field: string): Promise<void> {
    // SortHeader renders as a <th> with onClick — locate by the field name
    // The table header contains the label text and uses onClick(field)
    const th = this.el.table.locator("thead th").filter({
      has: this.page.locator(`text=/${field}/i`),
    });
    await this.uiActions.click.perform(th.first());
  }

  @Step()
  async clickRow(ledgerEntryId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.row(ledgerEntryId));
  }

  @Step()
  async clickMarkMatched(ledgerEntryId: string): Promise<Response> {
    const patchResponsePromise = this.page.waitForResponse(
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
  async clickViewAllDividendsLink(): Promise<void> {
    const link = this.page.getByRole("link", { name: /View all dividends|查看所有股利/i });
    await this.uiActions.click.perform(link);
    await this.mxWaitForAppReady();
  }
}
