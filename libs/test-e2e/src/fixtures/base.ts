import { test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { TestUser } from "@tw-portfolio/test-framework/core";
import type { TUIActions } from "@tw-portfolio/test-framework/core";

import { registerTestE2EAssistants } from "../config/mapper.js";

registerTestE2EAssistants();

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
  testUser: async ({ page, request, e2eUserId }, use) => {
    const testUser = new TestUser({
      page,
      request,
      userId: e2eUserId,
    });

    await testUser.reset(TestEnv.apiBaseUrl);
    await testUser.assignIdentity(TestEnv.appBaseUrl);

    await use(testUser);
  },
  createTestUser: async ({ browser, request, e2eUserId }, use) => {
    const ownedPages: Page[] = [];
    let extraUserCount = 0;

    await use(async (options = {}) => {
      const userId = options.userId ?? `${e2eUserId}-extra-${++extraUserCount}`;
      const page = options.page
        ?? (options.withPage === false ? undefined : await browser.newPage());

      if (page && !options.page) {
        ownedPages.push(page);
      }

      const testUser = new TestUser({
        request,
        userId,
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
