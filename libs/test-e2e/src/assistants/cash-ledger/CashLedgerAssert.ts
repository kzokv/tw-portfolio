import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";
import type { CashLedgerPage } from "../../pages/cash-ledger/CashLedgerPage.js";

export class CashLedgerAssert extends BaseAssert {
  declare protected readonly _instance: CashLedgerPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async pageLoaded(): Promise<void> {
    await expect(this.el.tableOrEmpty.first()).toBeVisible();
  }

  @Step()
  async filterToolbarIsVisible(): Promise<void> {
    await expect(this.el.filterToolbar).toBeVisible();
  }

  @Step()
  async filterAccountSelectIsVisible(): Promise<void> {
    await expect(this.el.filterAccountSelect).toBeVisible();
  }

  @Step()
  async filterAccountSelectContains(text: string | RegExp): Promise<void> {
    await expect(this.el.filterAccountSelect).toContainText(text);
  }

  @Step()
  async tableIsVisible(): Promise<void> {
    await expect(this.el.table).toBeVisible();
  }

  @Step()
  async tableHasRows(count: number): Promise<void> {
    await expect(this.el.rows).toHaveCount(count);
  }

  @Step()
  async tableHasAtLeastRows(minCount: number): Promise<void> {
    const count = await this.el.rows.count();
    expect(count).toBeGreaterThanOrEqual(minCount);
  }

  @Step()
  async drawerIsVisible(): Promise<void> {
    await expect(this.el.drawer).toBeVisible();
  }

  @Step()
  async drawerIsHidden(): Promise<void> {
    await expect(this.el.drawer).not.toBeVisible();
  }

  @Step()
  async drawerContains(text: string | RegExp): Promise<void> {
    await expect(this.el.drawer).toContainText(text);
  }

  @Step()
  async summaryVisible(): Promise<void> {
    await expect(this.el.summary).toBeVisible();
  }

  @Step()
  async emptyStateVisible(): Promise<void> {
    await expect(this.el.emptyState).toBeVisible();
  }

  @Step()
  async navLinkVisible(): Promise<void> {
    await expect(this.el.navLink).toBeVisible();
  }

  @Step()
  async rowContainsText(index: number, text: string | RegExp): Promise<void> {
    await expect(this.el.row(index)).toContainText(text);
  }

  @Step()
  async paginationVisible(): Promise<void> {
    await expect(this.el.pagination).toBeVisible();
  }

  @Step()
  async pageInfoContains(text: string | RegExp): Promise<void> {
    await expect(this.el.paginationInfo).toContainText(text);
  }

  @Step()
  async prevButtonDisabled(): Promise<void> {
    await expect(this.el.paginationPrev).toBeDisabled();
  }

  @Step()
  async nextButtonDisabled(): Promise<void> {
    await expect(this.el.paginationNext).toBeDisabled();
  }

  @Step()
  async prevButtonEnabled(): Promise<void> {
    await expect(this.el.paginationPrev).toBeEnabled();
  }

  @Step()
  async nextButtonEnabled(): Promise<void> {
    await expect(this.el.paginationNext).toBeEnabled();
  }

  @Step()
  async sortIndicatorOnColumn(field: string): Promise<void> {
    await expect(this.el.columnHeader(field)).toContainText(/[↑↓▲▼]/);
  }

  @Step()
  async summaryText(): Promise<string> {
    return (await this.el.summary.textContent()) ?? "";
  }

  @Step()
  async summaryMatchesSnapshot(snapshot: string): Promise<void> {
    const current = (await this.el.summary.textContent()) ?? "";
    expect(current).toBe(snapshot);
  }
}
