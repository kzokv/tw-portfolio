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
    await this.el.general.localeTooltipTrigger.focus();
  }

  @Step()
  async focusCostBasisTooltip(): Promise<void> {
    await this.el.general.costBasisTooltipTrigger.focus();
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
    const patchPromise = this.page.waitForResponse(
      (response) => response.url().includes("/api/profile") && response.request().method() === "PATCH",
    );
    await this.uiActions.click.perform(this.el.profile.saveEmailButton);
    return await patchPromise;
  }

  @Step()
  async closeWithEscape(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  @Step()
  async cancel(): Promise<void> {
    await this.page.getByRole("button", { name: /Cancel|取消/ }).click();
  }

  @Step()
  async keepEditing(): Promise<void> {
    await this.page.getByRole("button", { name: /Keep Editing|繼續編輯/ }).click();
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
    await this.el.catalog.item(ticker).locator("input[type=checkbox]").click();
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
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.request().method() === "PUT"
        && response.url().includes("/monitored-tickers")
        && response.ok(),
      { timeout: 10_000 },
    );

    await this.uiActions.click.perform(this.el.tickers.saveButton);
    await responsePromise;
  }
}
