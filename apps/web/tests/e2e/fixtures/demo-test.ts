import { test as base } from "@playwright/test";
import { apiUrl, extractCookieValue } from "../helpers/flows";
import { TestEnv } from "@tw-portfolio/config/test";

/**
 * Playwright fixture for demo-session tests that need a pre-seeded demo user
 * without going through the rate-limited /auth/demo/start flow.
 *
 * Uses POST /__e2e/demo-session to create the session server-side, then sets
 * the session cookie on the browser context. Each test gets a fresh demo user.
 */
export const test = base.extend({
  // Empty storage state — demo tests start unauthenticated
  storageState: [{cookies: [], origins: []}, { option: true }],

  page: async ({ page, request }, use) => {
    // Create demo session via E2E-only endpoint (bypasses rate limiter)
    const response = await request.post(apiUrl("/__e2e/demo-session"));
    if (!response.ok()) {
      throw new Error(
        `/__e2e/demo-session failed: ${response.status()} ${await response.text()}`,
      );
    }

    // Extract session cookie from Set-Cookie header and set on browser context
    const setCookieHeader = response.headers()["set-cookie"] ?? "";
    const cookieName = TestEnv.sessionCookieName;
    const cookieValue = extractCookieValue(setCookieHeader, cookieName);
    if (!cookieValue) {
      throw new Error(
        `Session cookie "${cookieName}" not found in Set-Cookie header`,
      );
    }

    await page.context().addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: TestEnv.appBaseUrl,
      },
    ]);

    await use(page);
  },
});

export { expect } from "@playwright/test";
