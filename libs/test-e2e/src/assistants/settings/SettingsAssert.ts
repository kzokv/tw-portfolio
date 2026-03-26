import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { SettingsDrawerPage } from "../../pages/settings/SettingsDrawerPage.js";

export class SettingsAssert extends BaseAssert {
  private get el() {
    return (this._instance as SettingsDrawerPage).elements;
  }

  @Step()
  async drawerIsClosed(): Promise<void> {
    await this.mxAssertUrlNotMatches("drawer=settings");
    await expect(this.el.drawer).not.toBeVisible();
  }

  @Step()
  async validationErrorIsVisible(): Promise<void> {
    await expect(this.el.footer.validationError).toBeVisible();
  }

  @Step()
  async drawerIsVisible(): Promise<void> {
    await expect(this.el.drawer).toBeVisible();
  }
}
