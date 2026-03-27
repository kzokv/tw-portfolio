/**
 * oauthBase — per-test OAuth session fixture for specs-oauth/ tests.
 * Mints a session via /__e2e/oauth-session and plants it as a browser cookie.
 * Provides testUser (with page) for createWebFixture to work.
 */
import { test as base } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import {
  buildDisplayName,
  buildE2EUserId,
  createFixtureTestUser,
  emptyStorageState,
  mintSessionCookieValue,
  type TBaseFixtures,
  withCreateTestUserFactory,
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

  e2eUserId: async ({ request }, use, testInfo) => {
    void request;
    await use(buildE2EUserId(testInfo));
  },

  testUser: async ({ page, request, e2eUserId }, use, testInfo) => {
    const testUser = createFixtureTestUser({
      page,
      request,
      userId: e2eUserId,
      displayName: buildDisplayName(testInfo),
    });

    await use(testUser);
  },

  createTestUser: async ({ browser, request, e2eUserId }, use, testInfo) => {
    await withCreateTestUserFactory({ browser, request, e2eUserId }, use, testInfo);
  },
});

export { expect } from "@playwright/test";
