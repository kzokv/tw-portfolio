import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";
import type { FxTransferPage } from "../../pages/fx-transfer/FxTransferPage.js";

export class FxTransferAssert extends BaseAssert {
  declare protected readonly _instance: FxTransferPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async newTransferButtonVisible(): Promise<void> {
    await expect(this.el.newTransferButton).toBeVisible();
  }

  @Step()
  async dialogVisible(): Promise<void> {
    await expect(this.el.dialog).toBeVisible();
  }

  @Step()
  async dialogHidden(): Promise<void> {
    await expect(this.el.dialog).toBeHidden();
  }

  @Step()
  async submitEnabled(timeoutMs?: number): Promise<void> {
    await expect(this.el.submitButton).toBeEnabled(timeoutMs ? { timeout: timeoutMs } : undefined);
  }

  @Step()
  async submitDisabled(): Promise<void> {
    await expect(this.el.submitButton).toBeDisabled();
  }

  @Step()
  async fxOutBadgeVisible(timeoutMs?: number): Promise<void> {
    await expect(this.el.fxOutBadge.first()).toBeVisible(
      timeoutMs ? { timeout: timeoutMs } : undefined,
    );
  }

  @Step()
  async fxInBadgeVisible(timeoutMs?: number): Promise<void> {
    await expect(this.el.fxInBadge.first()).toBeVisible(
      timeoutMs ? { timeout: timeoutMs } : undefined,
    );
  }

  @Step()
  async gaugeShowsBlockState(timeoutMs?: number): Promise<void> {
    await expect(this.el.blockBandText.first()).toBeVisible(
      timeoutMs ? { timeout: timeoutMs } : undefined,
    );
  }
}
