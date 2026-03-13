import { test as base } from "@playwright/test";
import { assignE2EUser, buildE2EUserId, resetE2EUser } from "../helpers/flows";

type AppFixtures = {
  e2eUserId: string;
};

export const test = base.extend<AppFixtures>({
  e2eUserId: async ({ }, use, testInfo) => {
    await use(buildE2EUserId(testInfo));
  },
  page: async ({ page, request, e2eUserId }, use) => {
    await resetE2EUser(request, e2eUserId);
    await assignE2EUser(page, e2eUserId);
    await use(page);
  },
});

export { expect } from "@playwright/test";
