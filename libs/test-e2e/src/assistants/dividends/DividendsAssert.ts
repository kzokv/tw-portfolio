import { expect } from "@playwright/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseAssert } from "@tw-portfolio/test-framework/mixins";
import type { DividendCalendarPage } from "../../pages/dividends/DividendCalendarPage.js";

export class DividendsAssert extends BaseAssert {
  declare protected readonly _instance: DividendCalendarPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async calendarLoaded(): Promise<void> {
    await expect(this.el.calendarPage).toBeVisible();
  }

  @Step()
  async rowBadgeContains(eventId: string, text: string | RegExp): Promise<void> {
    await expect(this.el.badge(eventId)).toContainText(text);
  }

  @Step()
  async rowContains(eventId: string, text: string | RegExp): Promise<void> {
    await expect(this.el.row(eventId)).toContainText(text);
  }

  @Step()
  async tbdSectionIsVisible(): Promise<void> {
    await expect(this.el.tbdSection).toBeVisible();
  }

  @Step()
  async drawerIsVisible(): Promise<void> {
    await expect(this.el.drawer.dialog).toBeVisible();
  }

  @Step()
  async drawerIsHidden(): Promise<void> {
    await expect(this.el.drawer.dialog).not.toBeVisible();
  }

  @Step()
  async sourceLineAmountInputIsVisible(index: number): Promise<void> {
    await expect(this.el.drawer.sourceLines.amountInput(index)).toBeVisible();
  }

  @Step()
  async sourceLineAmountInputIsHidden(index: number): Promise<void> {
    await expect(this.el.drawer.sourceLines.amountInput(index)).not.toBeVisible();
  }

  @Step()
  async formErrorContains(text: string | RegExp): Promise<void> {
    await expect(this.el.drawer.errorBanner).toContainText(text);
  }

  /** KZO-32: edit button is now enabled for all posted rows including stock/mixed. */
  @Step()
  async editButtonIsEnabled(eventId: string): Promise<void> {
    await expect(this.el.editButton(eventId)).toBeEnabled();
  }

  @Step()
  async reconcileSectionIsVisible(): Promise<void> {
    await expect(this.el.drawer.reconcileSection).toBeVisible();
  }

  @Step()
  async reconcileSectionIsHidden(): Promise<void> {
    await expect(this.el.drawer.reconcileSection).not.toBeVisible();
  }

  @Step()
  async amountsFormIsHidden(): Promise<void> {
    await expect(this.el.drawer.form).not.toBeVisible();
  }

  @Step()
  async amountsFormIsVisible(): Promise<void> {
    await expect(this.el.drawer.form).toBeVisible();
  }

  @Step()
  async stockEditDisabledLabelIsVisible(): Promise<void> {
    await expect(this.el.drawer.stockEditDisabledLabel).toBeVisible();
  }

  @Step()
  async reconcileErrorContains(text: string | RegExp): Promise<void> {
    await expect(this.el.drawer.reconcileError).toContainText(text);
  }

  // ─── Source Composition Tab (KZO-134) ─────────────────────────────────────

  @Step()
  async sourceCompositionToggleIsVisible(): Promise<void> {
    await expect(this.el.drawer.sourceCompositionToggle).toBeVisible();
  }

  @Step()
  async sourceCompositionToggleIsHidden(): Promise<void> {
    await expect(this.el.drawer.sourceCompositionToggle).not.toBeVisible();
  }

  @Step()
  async sourceCompositionTabIsVisible(): Promise<void> {
    await expect(this.el.drawer.sourceCompositionTab).toBeVisible();
  }

  @Step()
  async sourceCompositionEstimateWarningIsVisible(): Promise<void> {
    await expect(this.el.drawer.sourceCompositionEstimateWarning).toBeVisible();
  }

  @Step()
  async sourceCompositionEstimateWarningIsHidden(): Promise<void> {
    await expect(this.el.drawer.sourceCompositionEstimateWarning).not.toBeVisible();
  }

  @Step()
  async sourceCompositionNhiSubtotalContains(text: string | RegExp): Promise<void> {
    await expect(this.el.drawer.sourceCompositionNhiSubtotal).toContainText(text);
  }

  @Step()
  async nhiEstimateWarningIsVisible(): Promise<void> {
    await expect(this.el.drawer.nhiEstimateWarning).toBeVisible();
  }

  @Step()
  async nhiEstimateWarningIsHidden(): Promise<void> {
    await expect(this.el.drawer.nhiEstimateWarning).not.toBeVisible();
  }
}
