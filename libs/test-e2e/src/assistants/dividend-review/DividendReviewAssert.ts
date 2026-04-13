import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";
import type { DividendReviewPage } from "../../pages/dividends/DividendReviewPage.js";

export class DividendReviewAssert extends BaseAssert {
  declare protected readonly _instance: DividendReviewPage;

  private get el() {
    return this._instance.elements;
  }

  // ─── Page state ──────────────────────────────────────────────────────────

  @Step()
  async pageLoaded(): Promise<void> {
    await expect(this.el.page).toBeVisible();
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
  async dateFromHasValue(value: string): Promise<void> {
    await expect(this.el.dateFrom).toHaveValue(value);
  }

  @Step()
  async dateToHasValue(value: string): Promise<void> {
    await expect(this.el.dateTo).toHaveValue(value);
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
    const rows = this.page.locator('[data-testid^="review-row-"]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(minCount);
  }

  @Step()
  async tableRowCount(exactCount: number): Promise<void> {
    const rows = this.page.locator('[data-testid^="review-row-"]');
    await expect(rows).toHaveCount(exactCount);
  }

  @Step()
  async rowContainsText(ledgerEntryId: string, text: string | RegExp): Promise<void> {
    await expect(this.el.row(ledgerEntryId)).toContainText(text);
  }

  @Step()
  async rowStatusContains(ledgerEntryId: string, text: string | RegExp): Promise<void> {
    // Status badge is inside the row — look for the badge span
    const row = this.el.row(ledgerEntryId);
    const badge = row.locator("span.inline-flex");
    await expect(badge).toContainText(text);
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
    const rows = this.page.locator('[data-testid^="review-row-"]');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toContainText(text);
    }
  }

  @Step()
  async noRowContainsText(text: string | RegExp): Promise<void> {
    const rows = this.page.locator('[data-testid^="review-row-"]');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).not.toContainText(text);
    }
  }

  // ─── Sort assertions ─────────────────────────────────────────────────────

  @Step()
  async sortIndicatorOnColumn(field: string): Promise<void> {
    // SortHeader renders as <th> with "↑" or "↓" when active
    const th = this.el.table.locator("thead th").filter({
      has: this.page.locator(`text=/${field}/i`),
    });
    await expect(th.first()).toContainText(/[↑↓]/);
  }

  // ─── Pagination assertions ───────────────────────────────────────────────

  @Step()
  async pageInfoContains(text: string | RegExp): Promise<void> {
    await expect(this.el.pagination).toContainText(text);
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
    const areas = this.el.chartsContainer.locator(".recharts-area");
    const count = await areas.count();
    expect(count).toBeGreaterThan(0);
  }

  @Step()
  async chartHasBarSeries(): Promise<void> {
    const bars = this.el.chartsContainer.locator(".recharts-bar");
    const count = await bars.count();
    expect(count).toBeGreaterThan(0);
  }

  @Step()
  async chartHasNoBarSeries(): Promise<void> {
    const bars = this.el.chartsContainer.locator(".recharts-bar");
    await expect(bars).toHaveCount(0);
  }

  @Step()
  async granularityIsActive(level: string): Promise<void> {
    // Active granularity button has bg-sky-100 class
    const button = this.el.granularityToggle.locator("button").filter({
      has: this.page.locator(`text=/${level}/i`),
    });
    await expect(button.first()).toHaveClass(/bg-sky-100/);
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
    await expect(this.el.drawer.elements.dialog).toBeVisible();
  }

  @Step()
  async drawerIsHidden(): Promise<void> {
    await expect(this.el.drawer.elements.dialog).not.toBeVisible();
  }

  @Step()
  async drawerContains(text: string | RegExp): Promise<void> {
    await expect(this.el.drawer.elements.dialog).toContainText(text);
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
