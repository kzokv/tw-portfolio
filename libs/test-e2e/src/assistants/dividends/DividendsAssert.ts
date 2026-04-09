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
    await expect(this.el.row(eventId).locator("..")).toContainText(text);
  }

  @Step()
  async tbdSectionIsVisible(): Promise<void> {
    await expect(this.el.tbdSection).toBeVisible();
  }

  @Step()
  async drawerIsVisible(): Promise<void> {
    await expect(this.el.drawer.elements.dialog).toBeVisible();
  }

  @Step()
  async drawerIsHidden(): Promise<void> {
    await expect(this.el.drawer.elements.dialog).not.toBeVisible();
  }

  @Step()
  async editButtonIsDisabledWithTooltip(eventId: string, text: string | RegExp): Promise<void> {
    await expect(this.el.editButton(eventId)).toBeDisabled();
    await expect(this.el.editButton(eventId)).toHaveAttribute("title", text);
  }

  @Step()
  async sourceLineAmountInputIsVisible(index: number): Promise<void> {
    await expect(this.el.drawer.elements.sourceLines.elements.amountInput(index)).toBeVisible();
  }

  @Step()
  async sourceLineAmountInputIsHidden(index: number): Promise<void> {
    await expect(this.el.drawer.elements.sourceLines.elements.amountInput(index)).not.toBeVisible();
  }

  @Step()
  async formErrorContains(text: string | RegExp): Promise<void> {
    await expect(this.el.drawer.elements.errorBanner).toContainText(text);
  }
}
