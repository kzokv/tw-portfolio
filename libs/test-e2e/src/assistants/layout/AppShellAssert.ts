import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { AppShellPage } from "../../pages/layout/AppShellPage.js";

export class AppShellAssert extends BaseAssert {
  declare protected readonly _instance: AppShellPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async topBarTitleContains(text: string): Promise<void> {
    await expect(this.el.topBar.elements.title).toContainText(text);
  }

  @Step()
  async isOnRoute(expected: string | RegExp): Promise<void> {
    await this.mxAssertUrlMatches(expected);
  }

  @Step()
  async quotePollValueContains(text: string): Promise<void> {
    await expect(this.el.settings.quotePollValue).toContainText(text);
  }
}
