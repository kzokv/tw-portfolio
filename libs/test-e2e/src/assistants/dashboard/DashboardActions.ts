import { TestEnv } from "@vakwen/config/test";
import { expect } from "@playwright/test";
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

  /**
   * Open the FloatingQuickActions sheet if it is not already open.
   * Phase 5e moved recompute and generate-snapshots actions into a floating
   * Sheet — calling the trigger twice toggles the sheet closed, so each
   * helper that needs sheet contents visible checks state first.
   */
  private async ensureFloatingSheetOpen(): Promise<void> {
    const visible = await this.el.floatingQuickActionsSheet.isVisible().catch(() => false);
    if (!visible) {
      await this.uiActions.click.perform(this.el.floatingQuickActionsTrigger);
      await this.el.floatingQuickActionsSheet.waitFor({ state: "visible" });
    }
  }

  @Step()
  async clickRecompute(): Promise<void> {
    // Phase 5e — Recompute lives inside FloatingQuickActions. Clicking the
    // floating action closes the sheet and opens RecomputeConfirmDialog —
    // confirm via the CTA so the API calls fire (the old `window.confirm`
    // path that `acceptNextDialog` used to handle is retired).
    await this.ensureFloatingSheetOpen();
    await this.uiActions.click.perform(this.el.floatingActionRecompute);
    await this.uiActions.click.perform(this.el.recomputeConfirmDialogCta);
    await expect(this.el.recomputeImpactPreview).toBeVisible();
    await this.uiActions.click.perform(this.el.recomputeConfirmDialogCta);
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
    // Phase 5e — Generate Snapshots lives inside FloatingQuickActions.
    await this.ensureFloatingSheetOpen();
    await this.uiActions.click.perform(this.el.floatingActionGenerateSnapshots);
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

  // --- Phase 5e — floating ⨁ Sheet actions ---

  @Step()
  async openFloatingQuickActions(): Promise<void> {
    await this.uiActions.click.perform(this.el.floatingQuickActionsTrigger);
  }

  @Step()
  async clickFloatingAddTransaction(): Promise<void> {
    await this.uiActions.click.perform(this.el.floatingActionAddTransaction);
  }

  @Step()
  async clickFloatingRecompute(): Promise<void> {
    await this.uiActions.click.perform(this.el.floatingActionRecompute);
  }

  @Step()
  async openRecomputeDialog(): Promise<void> {
    await this.ensureFloatingSheetOpen();
    await this.uiActions.click.perform(this.el.floatingActionRecompute);
    await expect(this.el.recomputeConfirmDialog).toBeVisible();
  }

  @Step()
  async chooseRecomputeMode(mode: "KEEP_RECORDED" | "RECALCULATE_CALCULATED"): Promise<void> {
    const option = mode === "KEEP_RECORDED"
      ? this.el.recomputeModeKeep
      : this.el.recomputeModeRecalculate;
    await this.uiActions.click.perform(option);
  }

  @Step()
  async clickRecomputeDialogAction(): Promise<void> {
    await this.uiActions.click.perform(this.el.recomputeConfirmDialogCta);
  }

  @Step()
  async cancelRecomputeDialog(): Promise<void> {
    await this.uiActions.click.perform(this.el.recomputeConfirmDialogCancel);
  }

  @Step()
  async pressEscapeInRecomputeDialog(): Promise<void> {
    await this.mxFocus(this.el.recomputeConfirmDialogCta);
    await this.mxPressKey("Escape");
  }

  @Step()
  async clickFloatingGenerateSnapshots(): Promise<void> {
    await this.uiActions.click.perform(this.el.floatingActionGenerateSnapshots);
  }
}
