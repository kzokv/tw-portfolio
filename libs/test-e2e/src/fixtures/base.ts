import { faker } from "@faker-js/faker";
import { test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { TestUser } from "@tw-portfolio/test-framework/core";
import type { TUIActions } from "@tw-portfolio/test-framework/core";

import { registerTestE2EAssistants } from "../config/mapper.js";

registerTestE2EAssistants();

/**
 * Derive an acronym from the spec filename stem.
 * `settings-aaa.spec.ts` → `sa`, `portfolio-transactions.spec.ts` → `pt`
 */
function buildAcronym(filename: string): string {
  const stem = (filename.split("/").pop() ?? "spec")
    .replace(/\.spec\.[jt]s$/, "")
    .replace(/\.[jt]s$/, "");
  return stem.split("-").map((s) => s[0] ?? "").join("").toLowerCase();
}

/**
 * `{acronym}:{workerIndex}:{firstName}` — e.g. `sa:0:Alice`
 * First name is randomly generated per call (not seeded).
 */
function buildDisplayName(testInfo: TestInfo): string {
  const acronym = buildAcronym(testInfo.file);
  const name = faker.person.firstName();
  return `${acronym}:${testInfo.workerIndex}:${name}`;
}

function buildE2EUserId(testInfo: TestInfo): string {
  const fileName = testInfo.file.split("/").pop() ?? "spec";
  const slug = `${fileName}-${testInfo.title}-${testInfo.workerIndex}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return `qa-${slug || "e2e"}`;
}

export interface TCreateTestUserOptions {
  displayName?: string;
  page?: Page;
  role?: string;
  uiActions?: TUIActions;
  userId?: string;
  withPage?: boolean;
}

export type TCreateTestUser = (options?: TCreateTestUserOptions) => Promise<TestUser>;

export interface TBaseFixtures {
  e2eUserId: string;
  testUser: TestUser;
  createTestUser: TCreateTestUser;
}

export const test = base.extend<TBaseFixtures>({
  e2eUserId: async ({}, use, testInfo) => {
    await use(buildE2EUserId(testInfo));
  },
  testUser: async ({ page, request, e2eUserId }, use, testInfo) => {
    const testUser = new TestUser({
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
    const ownedPages: Page[] = [];
    let extraUserCount = 0;

    await use(async (options = {}) => {
      const userId = options.userId ?? `${e2eUserId}-extra-${++extraUserCount}`;
      const displayName = options.displayName ?? buildDisplayName(testInfo);
      const page = options.page
        ?? (options.withPage === false ? undefined : await browser.newPage());

      if (page && !options.page) {
        ownedPages.push(page);
      }

      const testUser = new TestUser({
        request,
        userId,
        displayName,
        ...(page && { page }),
        ...(options.role && { role: options.role }),
        ...(options.uiActions && { uiActions: options.uiActions }),
      });

      await testUser.reset(TestEnv.apiBaseUrl);
      if (page) {
        await testUser.assignIdentity(TestEnv.appBaseUrl);
      }

      return testUser;
    });

    while (ownedPages.length > 0) {
      const page = ownedPages.pop();
      await page?.close();
    }
  },
});

export { expect } from "@playwright/test";
