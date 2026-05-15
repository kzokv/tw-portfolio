import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";

import type { AuthErrorPage } from "../../pages/auth/AuthErrorPage.js";

export class AuthErrorAssert extends BaseAssert {
  declare protected readonly _instance: AuthErrorPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async tryAgainButtonIsVisible(): Promise<void> {
    await expect(this.el.tryAgainButton).toBeVisible();
  }

  @Step()
  async tryAgainButtonLinksTo(href: string): Promise<void> {
    await expect(this.el.tryAgainButton).toHaveAttribute("href", href);
  }

  @Step()
  async isOnAuthErrorPage(reason: string): Promise<void> {
    await this.mxAssertUrlMatches(new RegExp(`/auth/error.*reason=${reason}`));
  }

  @Step()
  async pageContains(text: string | RegExp): Promise<void> {
    await expect(this.el.text(text, "Auth Error Page Text")).toBeVisible();
  }

  @Step()
  async tryAgainButtonContains(text: string | RegExp): Promise<void> {
    await expect(this.el.tryAgainButton).toContainText(text);
  }
}
