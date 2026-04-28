import type { Response } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { SettingsDrawerPage } from "../../pages/settings/SettingsDrawerPage.js";

export class SettingsActions extends AppBaseActions {
  declare protected readonly _instance: SettingsDrawerPage;

  private static readonly saveOutcomeTimeoutMs = 10_000;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async getQuotePollValue(): Promise<string> {
    return await this.el.general.quotePollInput.inputValue();
  }

  @Step()
  async changeLocale(locale: string): Promise<void> {
    await this.uiActions.select.perform(this.el.general.localeSelect, locale);
  }

  @Step()
  async changeQuotePollInterval(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.general.quotePollInput, value);
  }

  @Step()
  async focusLocaleTooltip(): Promise<void> {
    await this.mxFocus(this.el.general.localeTooltipTrigger);
  }

  @Step()
  async focusCostBasisTooltip(): Promise<void> {
    await this.mxFocus(this.el.general.costBasisTooltipTrigger);
  }

  @Step()
  async save(): Promise<void> {
    const outcomeTimeoutMs = SettingsActions.saveOutcomeTimeoutMs;
    const saveResponsePredicate = (response: Response) =>
      response.request().method() === "PUT"
      && response.url().includes("/settings/full")
      && response.ok();

    await this.uiActions.click.perform(this.el.footer.saveButton);

    await Promise.any([
      this.mxWaitForResponse(saveResponsePredicate, undefined, outcomeTimeoutMs).then(() => undefined),
      this.el.drawer.waitFor({ state: "hidden", timeout: outcomeTimeoutMs }).then(() => undefined),
      this.el.footer.validationError.waitFor({ state: "visible", timeout: outcomeTimeoutMs }).then(() => undefined),
    ]);
  }

  @Step()
  async addFeeProfile(): Promise<void> {
    await this.uiActions.click.perform(this.el.fees.addProfileButton);
  }

  @Step()
  async openProfileTab(): Promise<void> {
    await this.uiActions.click.perform(this.el.tabs.profile);
  }

  @Step()
  async clearProfileEmail(): Promise<void> {
    await this.el.profile.emailInput.clear();
  }

  @Step()
  async fillProfileEmail(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.profile.emailInput, value);
  }

  @Step()
  async saveProfileEmail(): Promise<Response> {
    const patchPromise = this.mxWaitForResponse(
      (response) => {
        const pathname = new URL(response.url()).pathname;
        return response.request().method() === "PATCH"
          && (pathname === "/profile" || pathname === "/api/profile");
      },
    );
    await this.uiActions.click.perform(this.el.profile.saveEmailButton);
    return await patchPromise;
  }

  @Step()
  async closeWithEscape(): Promise<void> {
    await this.mxPressKey("Escape");
  }

  @Step()
  async cancel(): Promise<void> {
    await this.mxClick(this.el.unsavedChangesDialog.cancel);
  }

  @Step()
  async keepEditing(): Promise<void> {
    await this.mxClick(this.el.unsavedChangesDialog.keepEditing);
  }

  @Step()
  async discardChanges(): Promise<void> {
    await this.uiActions.click.perform(this.el.footer.discardButton);
  }

  @Step()
  async getProfileCount(): Promise<number> {
    return await this.el.fees.profileCards.count();
  }

  @Step()
  async setProfileName(index: number, value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.fees.profileName(index), value);
  }

  // --- KZO-179: Account Create form (Accounts tab) ---

  @Step()
  async fillAccountCreateName(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.accountCreate.nameInput, value);
  }

  @Step()
  async selectAccountCreateType(type: "broker" | "bank" | "wallet"): Promise<void> {
    await this.uiActions.click.perform(this.el.accountCreate.typePill(type));
  }

  @Step()
  async selectAccountCreateCurrency(currency: "TWD" | "USD" | "AUD"): Promise<void> {
    await this.uiActions.click.perform(this.el.accountCreate.currencyCard(currency));
  }

  // KZO-182: click "Add Override" in the Fees tab to append a fresh
  // SecurityBinding row whose account dropdown lists every live account.
  @Step()
  async addBinding(): Promise<void> {
    await this.uiActions.click.perform(this.el.fees.addBindingButton);
  }

  @Step()
  async submitAccountCreate(): Promise<Response> {
    const responsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "POST"
        && response.url().endsWith("/accounts")
        && response.ok(),
      { timeout: 10_000 },
    );
    await this.uiActions.click.perform(this.el.accountCreate.submit);
    return await responsePromise;
  }

  // --- Monitored Symbols ---

  @Step()
  async openTickersTab(): Promise<void> {
    await this.uiActions.click.perform(this.el.tabs.tickers);
  }

  @Step()
  async openCatalog(): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.browseCatalogButton);
  }

  @Step()
  async closeCatalog(): Promise<void> {
    await this.uiActions.click.perform(this.el.catalog.backButton);
  }

  @Step()
  async toggleCatalogItem(ticker: string): Promise<void> {
    await this.mxClick(this.el.catalog.itemCheckbox(ticker));
  }

  @Step()
  async filterCatalogByType(type: "all" | "stock" | "etf" | "bond_etf"): Promise<void> {
    const filterMap = {
      all: this.el.catalog.filterAll,
      stock: this.el.catalog.filterStock,
      etf: this.el.catalog.filterEtf,
      bond_etf: this.el.catalog.filterBondEtf,
    };
    await this.uiActions.click.perform(filterMap[type]);
  }

  @Step()
  async searchCatalog(query: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.catalog.search, query);
  }

  @Step()
  async saveTickers(): Promise<void> {
    const responsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "PUT"
        && response.url().includes("/monitored-tickers")
        && response.ok(),
      { timeout: 10_000 },
    );

    await this.uiActions.click.perform(this.el.tickers.saveButton);
    await responsePromise;
  }

  @Step()
  async retryBackfill(ticker: string): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.retryBackfillButton(ticker));
  }

  @Step()
  async enterRepairMode(): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.repairModeButton);
  }

  @Step()
  async cancelRepairMode(): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.repairCancelButton);
  }

  @Step()
  async selectTickerForRepair(ticker: string): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.repairSelection(ticker));
  }

  @Step()
  async continueToRepairModal(): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.repairContinueButton);
  }

  @Step()
  async setRepairDateRange(startDate: string, endDate: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.repairModal.startDateInput, startDate);
    await this.uiActions.fill.perform(this.el.repairModal.endDateInput, endDate);
  }

  @Step()
  async setRepairIncludeBars(enabled: boolean): Promise<void> {
    const checkbox = this.el.repairModal.includeBarsCheckbox;
    const checked = await checkbox.isChecked();
    if (checked !== enabled) {
      await this.uiActions.click.perform(checkbox);
    }
  }

  @Step()
  async setRepairIncludeDividends(enabled: boolean): Promise<void> {
    const checkbox = this.el.repairModal.includeDividendsCheckbox;
    const checked = await checkbox.isChecked();
    if (checked !== enabled) {
      await this.uiActions.click.perform(checkbox);
    }
  }

  @Step()
  async setRepairMode(mode: "apply-all" | "per-ticker"): Promise<void> {
    if (mode === "apply-all") {
      await this.uiActions.click.perform(this.el.repairModal.applyAllToggle);
      return;
    }
    await this.uiActions.click.perform(this.el.repairModal.perTickerToggle);
  }

  @Step()
  async submitRepair(): Promise<void> {
    const responsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "POST"
        && response.url().includes("/backfill/repair"),
      { timeout: 10_000 },
    );

    await this.uiActions.click.perform(this.el.repairModal.submitButton);
    await responsePromise;
  }
}
