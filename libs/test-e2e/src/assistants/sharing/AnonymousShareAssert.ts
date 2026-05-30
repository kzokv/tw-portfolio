import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";
import type { AnonymousSharePage } from "../../pages/sharing/AnonymousSharePage.js";

export class AnonymousShareAssert extends BaseAssert {
  declare protected readonly _instance: AnonymousSharePage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async rootIsVisible(): Promise<void> {
    await expect(this.el.root).toBeVisible();
  }

  @Step()
  async headerIsVisible(): Promise<void> {
    await expect(this.el.header).toBeVisible();
  }

  @Step()
  async ownerNameContains(expected: string): Promise<void> {
    await expect(this.el.ownerLabel).toContainText(expected);
  }

  @Step()
  async metaIsVisible(): Promise<void> {
    await expect(this.el.meta).toBeVisible();
  }

  @Step()
  async holdingsSectionIsVisible(): Promise<void> {
    await expect(this.el.holdingsSection).toBeVisible();
  }

  @Step()
  async notFoundStateIsVisible(): Promise<void> {
    await expect(this.el.notFoundState).toBeVisible();
  }

  @Step()
  async holdingRowVisible(ticker: string): Promise<void> {
    await expect(this.el.holding(ticker)).toBeVisible();
  }

  @Step()
  async holdingRowHidden(ticker: string): Promise<void> {
    await expect(this.el.holding(ticker)).toHaveCount(0);
  }

  @Step()
  async totalValueIsVisible(): Promise<void> {
    await expect(this.el.totalValue).toBeVisible();
  }

  @Step()
  async totalReturnIsVisible(): Promise<void> {
    await expect(this.el.totalReturn).toBeVisible();
  }

  @Step()
  async holdingsEmptyIsVisible(): Promise<void> {
    await expect(this.el.holdingsEmpty).toBeVisible();
  }

  @Step()
  async disclosureIsVisible(): Promise<void> {
    await expect(this.el.disclosure).toBeVisible();
  }

  @Step()
  async robotsMetaIsNoIndexNoFollow(): Promise<void> {
    await expect(this.el.robotsNoIndexMeta).toHaveCount(1);
  }

  @Step()
  async domDoesNotContainCostBasis(): Promise<void> {
    // The disclosure text legitimately says "No cost basis …"; we only want to reject
    // a numeric cost-basis value leaking into the page (e.g. "Cost basis: NT$50,071").
    await expect(this.el.body).not.toContainText(/cost[\s-]?basis[\s:：]+[\d$NT]/i);
  }

  @Step()
  async totalValueByCurrencyIsVisible(currency: string): Promise<void> {
    await expect(this.el.totalByCurrency(currency)).toBeVisible();
  }
}
