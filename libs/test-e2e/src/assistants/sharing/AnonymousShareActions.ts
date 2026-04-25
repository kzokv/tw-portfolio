import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { AnonymousSharePage } from "../../pages/sharing/AnonymousSharePage.js";

export class AnonymousShareActions extends AppBaseActions {
  declare protected readonly _instance: AnonymousSharePage;

  @Step()
  async navigateToPublicShare(token: string, clearCookies: boolean = true): Promise<void> {
    if (clearCookies) {
      await this.mxClearCookies();
    }
    await this.mxGotoUrl(new URL(`/share/${token}`, TestEnv.appBaseUrl).href);
  }
}
