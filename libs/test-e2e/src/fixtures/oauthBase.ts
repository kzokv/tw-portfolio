/**
 * oauthBase — per-test OAuth session fixture for specs-oauth/ tests.
 * Mints a session via /__e2e/oauth-session and plants it as a browser cookie.
 * Provides testUser (with page) for createWebFixture to work.
 */
import { test as base } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import {
  buildUserFixtures,
  emptyStorageState,
  mintSessionCookieValue,
  type TBaseFixtures,
} from "./shared.js";

export const test = base.extend<TBaseFixtures>({
  // Empty storage state — no shared session; each test mints its own
  storageState: emptyStorageState(),

  page: async ({ page, request }, use) => {
    const cookieValue = await mintSessionCookieValue(request, "/__e2e/oauth-session");
    const cookieName = TestEnv.sessionCookieName;
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

  ...buildUserFixtures(false),
});

export { expect } from "@playwright/test";
