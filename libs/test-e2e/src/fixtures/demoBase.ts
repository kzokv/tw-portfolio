/**
 * demoBase — per-test demo session fixture.
 * Mints a session via /__e2e/demo-session (bypasses rate limiter) and plants it
 * as a browser cookie. Provides testUser for createWebFixture to work.
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
  storageState: emptyStorageState(),

  page: async ({ page, request }, use) => {
    const cookieValue = await mintSessionCookieValue(request, "/__e2e/demo-session");
    await page.context().addCookies([
      {
        name: TestEnv.sessionCookieName,
        value: cookieValue,
        url: TestEnv.appBaseUrl,
      },
    ]);
    await use(page);
  },

  ...buildUserFixtures(false),
});

export { expect } from "@playwright/test";
