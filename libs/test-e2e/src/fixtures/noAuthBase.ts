/**
 * noAuthBase — like base.ts but skips testUser.reset() and testUser.assignIdentity().
 * Use for tests that start unauthenticated (e.g. login page flow tests).
 */
import { test as base } from "@playwright/test";
import {
  buildDisplayName,
  buildE2EUserId,
  createFixtureTestUser,
  type TBaseFixtures,
  withCreateTestUserFactory,
} from "./shared.js";

export const test = base.extend<TBaseFixtures>({
  e2eUserId: async ({ request }, use, testInfo) => {
    void request;
    await use(buildE2EUserId(testInfo));
  },

  // No reset() or assignIdentity() — page starts unauthenticated
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
