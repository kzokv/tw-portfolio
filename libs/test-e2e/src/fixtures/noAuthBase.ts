/**
 * noAuthBase — like base.ts but skips testUser.reset() and testUser.assignIdentity().
 * Use for tests that start unauthenticated (e.g. login page flow tests).
 */
import { test as base } from "@playwright/test";
import { buildUserFixtures, type TBaseFixtures } from "./shared.js";

export const test = base.extend<TBaseFixtures>({
  // No reset() or assignIdentity() — page starts unauthenticated
  ...buildUserFixtures(false),
});

export { expect } from "@playwright/test";
