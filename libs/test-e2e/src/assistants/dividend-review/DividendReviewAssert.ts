import { expect, type Locator } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";
import type { DividendReviewPage } from "../../pages/dividends/DividendReviewPage.js";

export class DividendReviewAssert extends BaseAssert {
  declare protected readonly _instance: DividendReviewPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async locatorIsVisible(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();
  }

  @Step()
  async locatorIsHidden(locator: Locator): Promise<void> {
    await expect(locator).toHaveCount(0);
  }

  @Step()
  async locatorHasCount(locator: Locator, count: number): Promise<void> {
    await expect(locator).toHaveCount(count);
  }

  @Step()
  async locatorContains(locator: Locator, text: string | RegExp): Promise<void> {
    await expect(locator).toContainText(text);
  }

  @Step()
  async locatorIsFocused(locator: Locator): Promise<void> {
    await expect(locator).toBeFocused();
  }

  @Step()
  async locatorHasAttribute(locator: Locator, name: string, value: string): Promise<void> {
    await expect(locator).toHaveAttribute(name, value);
  }

  @Step()
  valueEquals(actual: unknown, expected: unknown): void {
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  }

  @Step()
  valueDoesNotEqual(actual: unknown, expected: unknown): void {
    expect(JSON.stringify(actual)).not.toBe(JSON.stringify(expected));
  }

  @Step()
  valueContains(actual: string | undefined, expected: string): void {
    expect(actual).toContain(expected);
  }

  @Step()
  valueIsTrue(actual: boolean): void {
    expect(actual).toBe(true);
  }

  @Step()
  valueIsGreaterThan(actual: number, expected: number): void {
    expect(actual).toBeGreaterThan(expected);
  }

  @Step()
  async navigationCountIs(expected: number): Promise<void> {
    expect(await this.page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(expected);
  }

  @Step()
  async urlMatches(pattern: RegExp): Promise<void> {
    await expect(this.page).toHaveURL(pattern);
  }

  @Step()
  async viewportHasNoHorizontalOverflow(): Promise<void> {
    expect(await this.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  // ─── Page state ──────────────────────────────────────────────────────────

  @Step()
  async pageLoaded(): Promise<void> {
    await expect(this.el.page).toBeVisible();
  }

  @Step()
  async removalGuidanceContains(text: string | RegExp): Promise<void> {
    await expect(this.el.removalGuidance).toContainText(text);
  }

  @Step()
  async removalGuidanceHasNoDeleteAction(): Promise<void> {
    await expect(this.el.removalGuidance.getByRole("button", { name: /delete|刪除/i })).toHaveCount(0);
  }

  @Step()
  async openTickerTransactionsHrefContains(parts: string[]): Promise<void> {
    const href = await this.el.openTickerTransactions.getAttribute("href");
    expect(href).not.toBeNull();
    for (const part of parts) expect(href).toContain(part);
  }

  @Step()
  async tableIsVisible(): Promise<void> {
    await expect(this.el.table).toBeVisible();
  }

  // ─── Filter bar assertions ───────────────────────────────────────────────

  @Step()
  async presetIsActive(presetName: string): Promise<void> {
    // Active presets have a distinctive class (bg-white, text-slate-900)
    // Check for aria-pressed or class-based active state
    const preset = this.el.preset(presetName);
    await expect(preset).toBeVisible();
    // The frontend uses className to indicate active state — check for the active class
    await expect(preset).toHaveClass(/bg-sky-100|bg-white.*shadow/);
  }

  @Step()
  async yearRangeTriggerContains(text: string | RegExp): Promise<void> {
    await expect(this.el.yearRangeTrigger).toContainText(text);
  }

  @Step()
  async yearOptionIsChecked(year: number): Promise<void> {
    await expect(this.el.yearOption(year)).toBeChecked();
  }

  @Step()
  async dateFromHasValue(value: string): Promise<void> {
    await expect(this.el.dateFrom).toHaveValue(value);
  }

  @Step()
  async dateToHasValue(value: string): Promise<void> {
    await expect(this.el.dateTo).toHaveValue(value);
  }

  @Step()
  async tickerSummaryContains(text: string | RegExp): Promise<void> {
    await expect(this.el.tickerSummary).toContainText(text);
  }

  @Step()
  async tickerSearchIsVisible(): Promise<void> {
    await expect(this.el.tickerSearch).toBeVisible();
  }

  @Step()
  async tickerOptionIsVisible(ticker: string): Promise<void> {
    await expect(this.el.tickerOption(ticker)).toBeVisible();
  }

  @Step()
  async tickerCheckboxIsChecked(ticker: string): Promise<void> {
    await expect(this.el.tickerCheckbox(ticker)).toBeChecked();
  }

  @Step()
  async tickerCheckboxIsUnchecked(ticker: string): Promise<void> {
    await expect(this.el.tickerCheckbox(ticker)).not.toBeChecked();
  }

  @Step()
  async accountFilterIsOpen(): Promise<void> {
    await expect(this.el.accountDropdown).toHaveAttribute("open", "");
  }

  @Step()
  async accountSummaryIsExpanded(): Promise<void> {
    await expect(this.el.accountSummary).toHaveAttribute("aria-expanded", "true");
  }

  @Step()
  async accountSummaryIsFocused(): Promise<void> {
    await expect(this.el.accountSummary).toBeFocused();
  }

  @Step()
  async accountOptionIsChecked(value: string): Promise<void> {
    await expect(this.el.accountOption(value)).toBeChecked();
  }

  @Step()
  async accountOptionIsUnchecked(value: string): Promise<void> {
    await expect(this.el.accountOption(value)).not.toBeChecked();
  }

  @Step()
  async accountOptionIsFocused(value: string): Promise<void> {
    await expect(this.el.accountOption(value)).toBeFocused();
  }

  @Step()
  async accountAllIsCheckedAndFocused(): Promise<void> {
    await expect(this.el.accountAll).toBeChecked();
    await expect(this.el.accountAll).toBeFocused();
  }

  @Step()
  async accountAnnouncementContains(text: string | RegExp): Promise<void> {
    await expect(this.el.accountAnnouncement).toContainText(text);
  }

  @Step()
  async cashStatusOptionIsChecked(value: string): Promise<void> {
    await expect(this.el.cashStatusOption(value)).toBeChecked();
  }

  @Step()
  async stockStatusOptionIsChecked(value: string): Promise<void> {
    await expect(this.el.stockStatusOption(value)).toBeChecked();
  }

  @Step()
  async mobileSortExcludes(values: string[]): Promise<void> {
    const options = await this.el.mobileSortOptions.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value),
    );
    for (const value of values) expect(options).not.toContain(value);
  }

  @Step()
  async dateErrorIsVisible(): Promise<void> {
    await expect(this.el.dateError).toBeVisible();
  }

  @Step()
  async dateErrorIsHidden(): Promise<void> {
    await expect(this.el.dateError).not.toBeVisible();
  }

  // ─── URL assertions ──────────────────────────────────────────────────────

  @Step()
  async urlContains(paramSubstring: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(paramSubstring.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  @Step()
  async urlDoesNotContain(paramSubstring: string): Promise<void> {
    const url = this.page.url();
    expect(url).not.toContain(paramSubstring);
  }

  @Step()
  async urlPathIs(path: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?|$)`));
  }

  // ─── Table assertions ────────────────────────────────────────────────────

  @Step()
  async tableHasAtLeastRows(minCount: number): Promise<void> {
    await expect.poll(async () => this.el.rows.count()).toBeGreaterThanOrEqual(minCount);
  }

  @Step()
  async tableRowCount(exactCount: number): Promise<void> {
    await expect(this.el.rows).toHaveCount(exactCount);
  }

  @Step()
  async orderedRowIdsAre(expectedIds: string[]): Promise<void> {
    await expect.poll(async () => this.el.rows.evaluateAll((rows) => rows.map((row) => (
      row.getAttribute("data-testid")?.replace(/^review-row-/, "") ?? ""
    )))).toEqual(expectedIds);
  }

  @Step()
  async orderedRowIds(): Promise<string[]> {
    return this.el.rows.evaluateAll((rows) => rows.map((row) => (
      row.getAttribute("data-testid")?.replace(/^review-row-/, "") ?? ""
    )));
  }

  @Step()
  async tableBusy(expected: boolean): Promise<void> {
    await expect(this.el.table).toHaveAttribute("aria-busy", String(expected));
  }

  @Step()
  async skeletonsAreVisible(): Promise<void> {
    await expect(this.el.rowSkeletons.first()).toBeVisible();
  }

  @Step()
  async skeletonsAreHidden(): Promise<void> {
    await expect(this.el.rowSkeletons).toHaveCount(0);
  }

  @Step()
  async rowContainsText(ledgerEntryId: string, text: string | RegExp): Promise<void> {
    await expect(this.el.row(ledgerEntryId)).toContainText(text);
  }

  @Step()
  async rowStatusContains(ledgerEntryId: string, text: string | RegExp): Promise<void> {
    await expect(this.el.rowStatusBadge(ledgerEntryId)).toContainText(text);
  }

  @Step()
  async markMatchedButtonIsVisible(ledgerEntryId: string): Promise<void> {
    await expect(this.el.markMatchedButton(ledgerEntryId)).toBeVisible();
  }

  @Step()
  async markMatchedButtonIsHidden(ledgerEntryId: string): Promise<void> {
    await expect(this.el.markMatchedButton(ledgerEntryId)).not.toBeVisible();
  }

  @Step()
  async allRowsContainText(text: string | RegExp): Promise<void> {
    // Filter submits trigger an async refetch — the row count is unstable
    // while the response is in flight. Snapshot via `.all()` once Playwright's
    // strictness has settled, then assert each row exists in the snapshot
    // rather than counting + indexing (which races the DOM update).
    await expect.poll(async () => (await this.el.rows.all()).length).toBeGreaterThan(0);
    const snapshot = await this.el.rows.all();
    for (const row of snapshot) {
      await expect(row).toContainText(text);
    }
  }

  @Step()
  async noRowContainsText(text: string | RegExp): Promise<void> {
    // Snapshot rows up-front so the loop iterates a stable list.
    const snapshot = await this.el.rows.all();
    for (const row of snapshot) {
      await expect(row).not.toContainText(text);
    }
  }

  // ─── Sort assertions ─────────────────────────────────────────────────────

  @Step()
  async sortIndicatorOnColumn(field: string): Promise<void> {
    await expect(this.el.tableHeader(field).first()).toContainText(/[↑↓]/);
  }

  @Step()
  async sortDirectionIs(field: string, direction: "ascending" | "descending" | "none"): Promise<void> {
    await expect(this.el.tableHeaderCell(field)).toHaveAttribute("aria-sort", direction);
  }

  // ─── Pagination assertions ───────────────────────────────────────────────

  @Step()
  async pageInfoContains(text: string | RegExp): Promise<void> {
    await expect(this.el.pagination).toContainText(text);
  }

  @Step()
  async paginationIsDisabled(): Promise<void> {
    await expect(this.el.paginationNext).toBeDisabled();
  }

  @Step()
  async primaryErrorIsVisible(): Promise<void> {
    await expect(this.el.primaryError).toBeVisible();
  }

  @Step()
  async enrichmentErrorIsVisible(): Promise<void> {
    await expect(this.el.enrichmentError).toBeVisible();
  }

  @Step()
  async enrichmentLoadingIsVisible(): Promise<void> {
    await expect(this.el.enrichmentLoading).toBeVisible();
  }

  // ─── Stats tile assertions ───────────────────────────────────────────────

  @Step()
  async statTilesAreVisible(): Promise<void> {
    await expect(this.el.statTiles).toBeVisible();
  }

  @Step()
  async statOpenContains(text: string | RegExp): Promise<void> {
    await expect(this.el.statOpenItems).toContainText(text);
  }

  // ─── Chart assertions ────────────────────────────────────────────────────

  @Step()
  async chartContainerIsVisible(): Promise<void> {
    await expect(this.el.chartsContainer).toBeVisible();
  }

  @Step()
  async chartHasAreaSeries(): Promise<void> {
    const count = await this.el.chartsAreaPaths.count();
    expect(count).toBeGreaterThan(0);
  }

  @Step()
  async chartHasBarSeries(): Promise<void> {
    const count = await this.el.chartsBars.count();
    expect(count).toBeGreaterThan(0);
  }

  @Step()
  async chartHasNoBarSeries(): Promise<void> {
    await expect(this.el.chartsBars).toHaveCount(0);
  }

  @Step()
  async granularityIsActive(level: string): Promise<void> {
    await expect(this.el.chartGranularityButton(level).first()).toHaveClass(/bg-sky-100/);
  }

  @Step()
  async currencySelectIsVisible(): Promise<void> {
    await expect(this.el.currencySelect).toBeVisible();
  }

  @Step()
  async currencySelectIsHidden(): Promise<void> {
    await expect(this.el.currencySelect).not.toBeVisible();
  }

  // ─── Network assertions ──────────────────────────────────────────────────

  @Step()
  async noLedgerRequestsFired(capturedRequests: string[], countBefore: number): Promise<void> {
    expect(capturedRequests.length).toBe(countBefore);
  }

  // ─── Response assertions ─────────────────────────────────────────────────

  @Step()
  async responseStatusIs(response: { status(): number }, expectedStatus: number): Promise<void> {
    expect(response.status()).toBe(expectedStatus);
  }

  @Step()
  async responseUrlContains(response: { url(): string }, substring: string): Promise<void> {
    expect(response.url()).toContain(substring);
  }

  @Step()
  async responseUrlMatches(response: { url(): string }, pattern: RegExp): Promise<void> {
    expect(response.url()).toMatch(pattern);
  }

  // ─── Drawer assertions ───────────────────────────────────────────────────

  @Step()
  async drawerIsVisible(): Promise<void> {
    await expect(this.el.drawer.dialog).toBeVisible();
  }

  @Step()
  async drawerIsHidden(): Promise<void> {
    await expect(this.el.drawer.dialog).not.toBeVisible();
  }

  @Step()
  async drawerContains(text: string | RegExp): Promise<void> {
    await expect(this.el.drawer.dialog).toContainText(text);
  }

  @Step()
  async drawerLoadingIsVisible(): Promise<void> {
    await expect(this.el.drawerLoading).toBeVisible();
    await expect(this.el.drawerLoading).toHaveAttribute("aria-busy", "true");
  }

  @Step()
  async drawerErrorIsVisible(): Promise<void> {
    await expect(this.el.drawerError).toBeVisible();
  }

  // ─── NHI Rollup (KZO-134) ──────────────────────────────────────────────

  @Step()
  async nhiRollupSectionIsVisible(): Promise<void> {
    await expect(this.el.nhiRollupSection).toBeVisible();
  }

  @Step()
  async nhiRollupEmptyIsVisible(): Promise<void> {
    await expect(this.el.nhiRollupEmpty).toBeVisible();
  }

  @Step()
  async nhiRollupPendingLinkIsVisible(): Promise<void> {
    await expect(this.el.nhiRollupPendingLink).toBeVisible();
  }

  @Step()
  async nhiRollupPendingLinkContains(text: string | RegExp): Promise<void> {
    await expect(this.el.nhiRollupPendingLink).toContainText(text);
  }

  @Step()
  async nhiRollupPremiumContains(text: string | RegExp): Promise<void> {
    await expect(this.el.nhiRollupPremium).toContainText(text);
  }

  @Step()
  async nhiRollupSectionContains(text: string | RegExp): Promise<void> {
    await expect(this.el.nhiRollupSection).toContainText(text);
  }
}
