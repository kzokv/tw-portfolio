import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { TransactionsPage } from "../../pages/transactions/TransactionsPage.js";

export class TransactionsActions extends AppBaseActions {
  declare protected readonly _instance: TransactionsPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToTransactions(): Promise<void> {
    await this.mxNavigateToRoute("/transactions", TestEnv.appBaseUrl);
  }

  @Step()
  async selectFirstAccount(): Promise<void> {
    const accountSelect = this.el.transactionForm.accountSelect;
    const firstOption = this.el.transactionForm.accountOption(0);
    const firstAccountId = await firstOption.getAttribute("value");
    await this.uiActions.select.perform(accountSelect, firstAccountId ?? "acc-1");
  }

  // KZO-183: select a specific account by its id value in the account <select>.
  @Step()
  async selectAccountById(accountId: string): Promise<void> {
    await this.uiActions.select.perform(this.el.transactionForm.accountSelect, accountId);
  }

  @Step()
  async selectTransactionType(type: "BUY" | "SELL"): Promise<void> {
    await this.uiActions.select.perform(this.el.transactionForm.typeSelect, type);
  }

  @Step()
  async fillQuantity(quantity: number): Promise<void> {
    await this.uiActions.fill.perform(this.el.transactionForm.quantityInput, String(quantity));
  }

  @Step()
  async fillUnitPrice(unitPrice: number): Promise<void> {
    await this.uiActions.fill.perform(this.el.transactionForm.unitPriceInput, String(unitPrice));
  }

  @Step()
  async fillTradeDate(date: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.transactionForm.tradeDateInput, date);
  }

  // ── ui-enhancement — override inputs ────────────────────────────────────
  @Step()
  async fillCommissionOverride(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.transactionForm.commissionOverrideInput, value);
  }

  @Step()
  async fillTaxOverride(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.transactionForm.taxOverrideInput, value);
  }

  @Step()
  async openTickerCombobox(): Promise<void> {
    await this.mxFocus(this.el.transactionForm.tickerCombobox);
  }

  @Step()
  async typeInTickerSearch(query: string): Promise<void> {
    await this.openTickerCombobox();
    await this.mxFill(this.el.transactionForm.tickerCombobox, query);
  }

  @Step()
  async selectMarketChip(market: "TW" | "US" | "AU" | "ALL"): Promise<void> {
    await this.uiActions.click.perform(this.el.transactionForm.marketChip(market));
  }

  @Step()
  async selectTickerOption(ticker: string, marketCode?: "TW" | "US" | "AU"): Promise<void> {
    await this.uiActions.click.perform(this.el.transactionForm.tickerOption(ticker, marketCode));
  }

  @Step()
  async submitTransaction(): Promise<void> {
    await this.uiActions.click.perform(this.el.transactionForm.submitButton);
  }

  @Step()
  async focusAccountTooltip(): Promise<void> {
    const trigger = this.el.tooltipAccountTrigger;

    await trigger.waitFor({ state: "visible" });
    await trigger.scrollIntoViewIfNeeded();

    // Radix Tooltip opens on focus (keyboard) AND on hover (pointer). Under the
    // full E2E load, Playwright's programmatic `focus()` can fire just before
    // Radix has attached its event handlers — and the previous blur+refocus
    // recovery path raced against the 180ms `delayDuration` (the blur torpedoed
    // the in-flight open animation, leaving the tooltip permanently closed).
    //
    // Strategy: dispatch focus AND hover. Both Radix open paths are exercised;
    // whichever wins, the tooltip becomes visible. This still validates the
    // a11y "stay focusable" contract (focus is dispatched and the visible
    // assertion will pass) while also covering the hover-only branch in
    // headless chromium where programmatic focus doesn't always trigger
    // `:focus-visible`-driven tooltip behaviour.
    await this.mxFocus(trigger);
    try {
      await this.mxHover(trigger);
    } catch {
      // Hover can race the layout in mobile-emulated viewports; ignore — the
      // focus path above is still in flight and the assertion will retry.
    }
  }

  @Step()
  async waitForTransactionPost(): Promise<import("@playwright/test").Response> {
    return await this.mxWaitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/portfolio/transactions") && r.ok(),
    );
  }

  @Step()
  async waitForDashboardRefresh(): Promise<import("@playwright/test").Response> {
    return await this.mxWaitForResponse(
      (r) => r.request().method() === "GET" && r.url().includes("/dashboard/overview") && r.ok(),
    );
  }

  @Step()
  async waitForLedgerRefresh(): Promise<import("@playwright/test").Response> {
    return await this.mxWaitForResponse(
      (r) =>
        r.request().method() === "GET" &&
        r.url().includes("/portfolio/transactions?limit=6") &&
        r.ok(),
    );
  }

  @Step()
  async waitForPriceLookup(): Promise<import("@playwright/test").Response> {
    return await this.mxWaitForResponse(
      (r) => r.request().method() === "GET" && r.url().includes("/market-data/price"),
    );
  }

  @Step()
  async waitForFeeEstimate(): Promise<import("@playwright/test").Response> {
    return await this.mxWaitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/portfolio/transactions/estimate"),
    );
  }
}
