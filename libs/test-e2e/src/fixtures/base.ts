import { test as base } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import {
  buildDisplayName,
  buildE2EUserId,
  createFixtureTestUser,
  prewarmAppRoute,
  type TBaseFixtures,
  withCreateTestUserFactory,
} from "./shared.js";

export const test = base.extend<TBaseFixtures>({
  page: async ({ page, request }, use) => {
    await Promise.all([
      prewarmAppRoute(request, "/dashboard"),
      prewarmAppRoute(request, "/dashboard?drawer=settings"),
      prewarmAppRoute(request, "/portfolio"),
      prewarmAppRoute(request, "/transactions"),
      prewarmAppRoute(request, "/tickers/2330"),
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

    await testUser.reset(TestEnv.apiBaseUrl);
    await testUser.assignIdentity(TestEnv.appBaseUrl);

    await use(testUser);
  },
  createTestUser: async ({ browser, request, e2eUserId }, use, testInfo) => {
    await withCreateTestUserFactory(
      { browser, request, e2eUserId },
      use,
      testInfo,
      async (testUser, options) => {
        await testUser.reset(TestEnv.apiBaseUrl);
        if (options.hasPage) {
          await testUser.assignIdentity(TestEnv.appBaseUrl);
        }
      },
    );
  },
});

export { expect } from "@playwright/test";
