import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseArrange } from "@tw-portfolio/test-framework/mixins";

import type { SettingsDrawerPage } from "../../pages/settings/SettingsDrawerPage.js";

export class SettingsArrange extends BaseArrange {
  declare protected readonly _instance: SettingsDrawerPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async openFeesTab(): Promise<void> {
    await this.uiActions.click.perform(this.el.tabs.fees);
  }
}
