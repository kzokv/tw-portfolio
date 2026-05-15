import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseArrange } from "@vakwen/test-framework/mixins";

import { extractCookieValue } from "../../utils/cookie.js";
import { extractOAuthStateFromUrl, tamperSignedValue as tamperSignedValueUtil } from "../../utils/oauth.js";
import type { BrowserSessionPage } from "../../pages/auth/BrowserSessionPage.js";

export class SessionArrange extends BaseArrange {
  declare protected readonly _instance: BrowserSessionPage;

  @Step()
  async currentSessionCookie() {
    const cookies = await this.page.context().cookies();
    return cookies.find((cookie) => cookie.name === TestEnv.sessionCookieName);
  }

  @Step()
  async currentSessionCookieValue(): Promise<string | undefined> {
    return (await this.currentSessionCookie())?.value;
  }

  @Step()
  async extractSessionCookieValueFromHeader(setCookieHeader: string): Promise<string | null> {
    return extractCookieValue(setCookieHeader, TestEnv.sessionCookieName);
  }

  @Step()
  async oauthRedirectLocation(response: import("@playwright/test").APIResponse): Promise<string> {
    return response.headers()["location"] ?? "";
  }

  @Step()
  async oauthState(response: import("@playwright/test").APIResponse): Promise<string> {
    const location = await this.oauthRedirectLocation(response);
    return extractOAuthStateFromUrl(location);
  }

  @Step()
  async tamperSignedValue(value: string): Promise<string> {
    return tamperSignedValueUtil(value);
  }

  @Step()
  async sessionStorageValue(key: string): Promise<string | null> {
    return await this.page.evaluate((sessionKey) => sessionStorage.getItem(sessionKey), key);
  }
}
