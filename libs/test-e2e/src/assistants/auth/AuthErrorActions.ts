import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { AuthErrorPage } from "../../pages/auth/AuthErrorPage.js";

export class AuthErrorActions extends AppBaseActions {
  declare protected readonly _instance: AuthErrorPage;

  @Step()
  async navigateToAuthError(reason: string): Promise<void> {
    await this.mxGotoUrl(new URL(`/auth/error?reason=${reason}`, TestEnv.appBaseUrl).href);
  }
}
