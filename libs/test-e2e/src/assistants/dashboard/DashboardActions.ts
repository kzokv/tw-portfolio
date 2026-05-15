import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { DashboardPage } from "../../pages/dashboard/DashboardPage.js";

export class DashboardActions extends AppBaseActions {
  declare protected readonly _instance: DashboardPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async navigateToDashboard(): Promise<void> {
    await this.mxNavigateToRoute("/dashboard", TestEnv.appBaseUrl);
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
    return await this.mxWaitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/portfolio/recompute/preview") && r.ok(),
    );
  }

  @Step()
  async waitForRecomputeConfirm(): Promise<import("@playwright/test").Response> {
    return await this.mxWaitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/portfolio/recompute/confirm") && r.ok(),
    );
  }

  @Step()
  async clickGenerateSnapshots(): Promise<void> {
    await this.uiActions.click.perform(this.el.generateSnapshotsButton);
  }

  @Step()
  async waitForSnapshotGeneration(): Promise<import("@playwright/test").Response> {
    return await this.mxWaitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/portfolio/snapshots/generate") && r.status() === 202,
    );
  }

  @Step()
  async generateSnapshotsAndWait(): Promise<void> {
    const responsePromise = this.waitForSnapshotGeneration();
    await this.clickGenerateSnapshots();
    await responsePromise;
  }
}
