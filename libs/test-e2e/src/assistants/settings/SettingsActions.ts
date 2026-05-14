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

  // KZO-183: per-account "Add override" button. Each account card hosts
  // its own button so the helper takes the account id explicitly.
  @Step()
  async addOverrideForAccount(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.addOverride(accountId));
  }

  // KZO-183: expand a per-account card to reveal its inline body (default
  // profile selector, profiles list, overrides list).
  @Step()
  async expandAccountCard(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.cardToggle(accountId));
  }

  // KZO-183: add a new fee profile to the given account card.
  @Step()
  async addFeeProfileToAccount(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.addProfile(accountId));
  }

  // KZO-183: type into the accounts-tab search input.
  @Step()
  async searchAccountsTab(query: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.accountsList.searchInput, query);
  }

  // KZO-183: clear the accounts-tab search input.
  @Step()
  async clearAccountsTabSearch(): Promise<void> {
    await this.el.accountsList.searchInput.clear();
  }

  // KZO-183: click the edit pencil, replace the name, confirm.
  @Step()
  async editProfileName(profileId: string, name: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.profileEditButton(profileId));
    await this.uiActions.fill.perform(this.el.accountsList.profileNameInput(profileId), name);
    await this.uiActions.click.perform(this.el.accountsList.profileEditDoneButton(profileId));
  }

  // KZO-183: open the "Duplicate from another account" picker for an account.
  @Step()
  async clickDuplicateFromAnotherAccount(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.duplicateCta(accountId));
  }

  // KZO-183: select a source account in the duplicate picker's <select>.
  @Step()
  async selectDuplicateSourceAccount(accountId: string): Promise<void> {
    await this.uiActions.select.perform(this.el.accountsList.duplicateSourceSelect, accountId);
  }

  // KZO-183: toggle a profile checkbox in the duplicate picker.
  @Step()
  async checkDuplicateProfile(profileId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.duplicateCheckbox(profileId));
  }

  // KZO-183: click the confirm button in the duplicate picker.
  @Step()
  async confirmDuplicate(): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.duplicateConfirm);
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

  // ── KZO-188: AU ticker discovery ─────────────────────────────────────────

  /**
   * Click a market chip in the InstrumentCatalogSheet (All · TW · US · AU).
   * Must be called after the catalog sheet is open.
   */
  @Step()
  async clickMarketChip(market: "all" | "TW" | "US" | "AU"): Promise<void> {
    await this.uiActions.click.perform(this.el.catalog.marketChip(market));
  }

  // ── KZO-196: AU GICS sector filter ───────────────────────────────────────

  /**
   * Select a GICS sector in the AU catalog sheet's sector dropdown. Pass the
   * empty string to reset to "All sectors".
   *
   * Requires the AU market chip to be active (`clickMarketChip("AU")`); the
   * dropdown is hidden for ALL/TW/US per scope-todo.
   */
  @Step()
  async selectSectorFilter(sector: string): Promise<void> {
    await this.el.catalog.sectorSelect.selectOption(sector);
  }

  /**
   * Pre-attach a wait for the PUT /monitored-tickers response BEFORE clicking
   * the save button. Returns the response promise — caller awaits it after the
   * save click to satisfy the pre-attach contract per
   * `react-useEventStream-preconnect-pattern.md`.
   */
  @Step()
  async waitForSaveTickersResponse(): Promise<import("@playwright/test").Response> {
    return this.mxWaitForResponse(
      (response) =>
        response.request().method() === "PUT"
        && response.url().includes("/monitored-tickers")
        && response.ok(),
      { timeout: 10_000 },
    );
  }

  // ── ui-enhancement — Account deletion lifecycle ─────────────────────────

  @Step()
  async clickAccountDeleteButton(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.deleteButton(accountId));
  }

  @Step()
  async confirmSoftDelete(): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.softDeleteConfirmButton);
  }

  @Step()
  async cancelSoftDelete(): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.softDeleteCancelButton);
  }

  @Step()
  async clickRecentlyDeletedRestore(accountId: string): Promise<void> {
    await this.uiActions.click.perform(
      this.el.accountsList.recentlyDeletedRestoreButton(accountId),
    );
  }

  @Step()
  async clickRecentlyDeletedPurge(accountId: string): Promise<void> {
    await this.uiActions.click.perform(
      this.el.accountsList.recentlyDeletedPurgeButton(accountId),
    );
  }

  @Step()
  async fillPermanentDeleteConfirmation(name: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.accountsList.permanentDeleteInput, name);
  }

  @Step()
  async confirmPermanentDelete(): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.permanentDeleteConfirmButton);
  }
}
