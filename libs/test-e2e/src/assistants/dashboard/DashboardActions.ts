import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseActions } from "@tw-portfolio/test-framework/mixins";

import type { DashboardPage } from "../../pages/dashboard/DashboardPage.js";

export class DashboardActions extends BaseActions {
  declare protected readonly _instance: DashboardPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToDashboard(): Promise<void> {
    await this.mxNavigateToRoute("/", TestEnv.appBaseUrl);
  }

  @Step()
  async clickRecompute(): Promise<void> {
    await this.uiActions.click.perform(this.el.recomputeButton);
  }

  @Step()
  async acceptNextDialog(): Promise<void> {
    this.page.once("dialog", (dialog) => dialog.accept());
  }

  @Step()
  async waitForRecomputePreview(): Promise<import("@playwright/test").Response> {
    return this.page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/portfolio/recompute/preview") && r.ok(),
    );
  }

  @Step()
  async waitForRecomputeConfirm(): Promise<import("@playwright/test").Response> {
    return this.page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/portfolio/recompute/confirm") && r.ok(),
    );
  }
}
