import { expect } from "@playwright/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseAssert } from "@vakwen/test-framework/mixins";

import type { LoginPage } from "../../pages/auth/LoginPage.js";

export class LoginAssert extends BaseAssert {
  declare protected readonly _instance: LoginPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async googleSignInButtonIsVisible(): Promise<void> {
    await expect(this.el.googleSignInButton).toBeVisible();
  }

  @Step()
  async isOnLoginPage(): Promise<void> {
    await this.mxAssertUrlMatches(/\/login/);
  }

  @Step()
  async demoSignInButtonIsVisible(): Promise<void> {
    await expect(this.el.demoSignInButton).toBeVisible();
  }

  @Step()
  async errorAlertIsVisible(): Promise<void> {
    await expect(this.el.errorAlert).toBeVisible();
  }

  @Step()
  async errorAlertContains(text: string | RegExp): Promise<void> {
    await expect(this.el.errorAlert).toContainText(text);
  }

  @Step()
  async googleSignInButtonHasHref(expected: string | RegExp): Promise<void> {
    const href = await this.el.googleSignInButton.getAttribute("href");
    if (expected instanceof RegExp) {
      expect(href).toMatch(expected);
    } else {
      expect(href).toContain(expected);
    }
  }

  @Step()
  async demoExpiredMessageIsVisible(): Promise<void> {
    await expect(this.el.demoExpiredMessage).toBeVisible();
  }

  @Step()
  async sessionStorageValueIs(key: string, expectedValue: string): Promise<void> {
    const actualValue = await this.page.evaluate((sessionKey) => sessionStorage.getItem(sessionKey), key);
    expect(actualValue).toBe(expectedValue);
  }
}
