import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { BaseActions } from "@tw-portfolio/test-framework/mixins";

import type { AuthErrorPage } from "../../pages/auth/AuthErrorPage.js";

export class AuthErrorActions extends BaseActions {
  declare protected readonly _instance: AuthErrorPage;

  @Step()
  async navigateToAuthError(reason: string): Promise<void> {
    await this.page.goto(new URL(`/auth/error?reason=${reason}`, TestEnv.appBaseUrl).href, {
      waitUntil: "domcontentloaded",
    });
  }
}
