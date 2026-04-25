import { TestEnv } from "@tw-portfolio/config/test";
import { Step } from "@tw-portfolio/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { ContextSwitcherPage } from "../../pages/sharing/ContextSwitcherPage.js";

const CONTEXT_COOKIE_NAME = "tw_context_user_id";

export class ContextSwitcherActions extends AppBaseActions {
  declare protected readonly _instance: ContextSwitcherPage;

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async openDropdown(): Promise<void> {
    await this.mxClick(this.el.switcherRoot);
    await this.el.dropdown.waitFor({ state: "visible" });
  }

  @Step()
  async selectOwner(ownerUserId: string): Promise<void> {
    await this.openDropdown();
    await this.mxClick(this._instance.optionForOwner(ownerUserId));
    await this.el.dropdown.waitFor({ state: "hidden" });
  }

  @Step()
  async selectSelf(): Promise<void> {
    await this.openDropdown();
    await this.mxClick(this.el.optionSelf);
    await this.el.dropdown.waitFor({ state: "hidden" });
  }

  /**
   * Direct cookie write + reload — bypasses the dropdown UI when the test only
   * needs the resulting state (e.g. SSE revoke arrange). For tests asserting
   * the dropdown click flow itself, use `selectOwner` instead.
   *
   * Cookie scope follows `playwright-oauth-cookie-patterns.md`: the cookie
   * is written on TestEnv.host (not 127.0.0.1) so it lives where the web
   * app reads it.
   */
  @Step()
  async switchTo(ownerUserId: string): Promise<void> {
    await this.mxAddCookies([
      {
        name: CONTEXT_COOKIE_NAME,
        value: ownerUserId,
        domain: TestEnv.host,
        path: "/",
        sameSite: "Lax",
      },
    ]);
    await this.mxReloadPage();
  }

  @Step()
  async switchToSelf(): Promise<void> {
    await this.mxClearCookie(CONTEXT_COOKIE_NAME);
    await this.mxReloadPage();
  }
}
