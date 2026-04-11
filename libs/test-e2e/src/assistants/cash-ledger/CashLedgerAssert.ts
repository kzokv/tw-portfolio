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
    // Either the table or the empty state should be visible
    const tableOrEmpty = this.page.locator(
      '[data-testid="cash-ledger-table"], [data-testid="cash-ledger-empty"]',
    );
    await expect(tableOrEmpty.first()).toBeVisible();
  }

  @Step()
  async tableIsVisible(): Promise<void> {
    await expect(this.el.table).toBeVisible();
  }

  @Step()
  async tableHasRows(count: number): Promise<void> {
    const rows = this.page.locator('[data-testid^="cash-ledger-row-"]');
    await expect(rows).toHaveCount(count);
  }

  @Step()
  async tableHasAtLeastRows(minCount: number): Promise<void> {
    const rows = this.page.locator('[data-testid^="cash-ledger-row-"]');
    const count = await rows.count();
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
    await expect(
      this.page.getByTestId("desktop-sidebar").getByTestId("sidebar-link-cash-ledger"),
    ).toBeVisible();
  }

  @Step()
  async rowContainsText(index: number, text: string | RegExp): Promise<void> {
    await expect(this.el.row(index)).toContainText(text);
  }
}
