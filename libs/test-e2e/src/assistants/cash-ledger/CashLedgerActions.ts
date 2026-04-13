import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { CashLedgerPage } from "../../pages/cash-ledger/CashLedgerPage.js";

export class CashLedgerActions extends AppBaseActions {
  declare protected readonly _instance: CashLedgerPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToCashLedger(): Promise<void> {
    await this.mxNavigateToRoute("/cash-ledger", TestEnv.appBaseUrl);
  }

  @Step()
  async clickEntry(index: number): Promise<void> {
    await this.uiActions.click.perform(this.el.row(index));
  }

  @Step()
  async closeDrawer(): Promise<void> {
    // Press Escape to close the drawer
    await this.page.keyboard.press("Escape");
  }

  @Step()
  async filterByEntryType(typeLabel: string | RegExp): Promise<void> {
    // Click the entry type toggle button that contains the label text
    const button = this.el.filterToolbar.getByRole("button", { name: typeLabel });
    await this.uiActions.click.perform(button);
  }

  @Step()
  async goToNextPage(): Promise<void> {
    await this.uiActions.click.perform(this.el.paginationNext);
  }

  @Step()
  async goToPrevPage(): Promise<void> {
    await this.uiActions.click.perform(this.el.paginationPrev);
  }

  @Step()
  async clickColumnHeader(field: string): Promise<void> {
    const header = this.el.table.locator("th").filter({ hasText: new RegExp(field, "i") });
    await this.uiActions.click.perform(header);
  }
}
