import type { Response } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseActions } from "@tw-portfolio/test-framework/mixins";

import type { SettingsDrawerPage } from "../../pages/settings/SettingsDrawerPage.js";

export class SettingsActions extends BaseActions {
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
  async getProfileCount(): Promise<number> {
    return await this.el.fees.profileCards.count();
  }

  @Step()
  async setProfileName(index: number, value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.fees.profileName(index), value);
  }
}
