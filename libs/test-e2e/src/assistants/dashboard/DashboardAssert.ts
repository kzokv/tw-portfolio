import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";

import type { DashboardPage } from "../../pages/dashboard/DashboardPage.js";

export class DashboardAssert extends BaseAssert {
  declare protected readonly _instance: DashboardPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async demoBannerIsVisible(): Promise<void> {
    await expect(this.el.demoBanner).toBeVisible();
  }

  @Step()
  async demoBannerContains(text: string | RegExp): Promise<void> {
    await expect(this.el.demoBanner).toContainText(text);
  }

  @Step()
  async recomputeStatusContains(text: string | RegExp): Promise<void> {
    await expect(this.el.recomputeStatus).toContainText(text);
  }

  @Step()
  async appIsReady(): Promise<void> {
    await expect(this.el.appReady).toBeAttached({ timeout: 30_000 });
  }

  @Step()
  async isOnDashboard(): Promise<void> {
    await this.mxAssertUrlMatches(/\/dashboard/);
  }
}
