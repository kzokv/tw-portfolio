import { test as base } from "@playwright/test";
import { apiUrl, extractCookieValue, TestEnv } from "../helpers/flows";

/**
 * Playwright fixture for OAuth tests that need a per-test authenticated session.
 * Mints a fresh session via /__e2e/oauth-session for every test, replacing the
 * shared auth.setup.ts + storageState approach. Safe for fullyParallel: true.
 */
export const test = base.extend({
  // Empty storage state — no shared session file; each test mints its own
  storageState: [{ cookies: [], origins: [] }, { scope: "test" }],

  page: async ({ page, request }, use) => {
    const response = await request.post(apiUrl("/__e2e/oauth-session"));
    if (!response.ok()) {
      throw new Error(
        `/__e2e/oauth-session failed: ${response.status()} ${await response.text()}`,
      );
    }

    const setCookieHeader = response.headers()["set-cookie"] ?? "";
    const cookieName = TestEnv.sessionCookieName;
    const cookieValue = extractCookieValue(setCookieHeader, cookieName);
    if (!cookieValue) {
      throw new Error(`Session cookie "${cookieName}" not found in Set-Cookie header`);
    }

    await page.context().addCookies([
      {
        name: cookieName,
        value: cookieValue,
        domain: TestEnv.host,
        path: "/",
        httpOnly: true,
        secure: cookieName.startsWith("__Host-"),
        sameSite: "Lax",
      },
    ]);

    await use(page);
  },
});

export { expect } from "@playwright/test";
