import { test as base, expect } from "@playwright/test";
import type { APIRequestContext, TestInfo } from "@playwright/test";
import { TestUser } from "@tw-portfolio/test-framework/core";
import { buildDisplayName, buildE2EUserId } from "@tw-portfolio/test-framework/shared";
import { registerTestApiAssistants } from "../config/mapper.js";
import { mintApiSessionCookie, type TApiBaseFixtures, type TApiSessionMode } from "./shared.js";

registerTestApiAssistants();

const SESSION_ENDPOINTS: Record<TApiSessionMode, string> = {
  oauth: "/__e2e/oauth-session",
  demo: "/__e2e/demo-session",
};

export function createApiSessionTest(mode: TApiSessionMode) {
  return base.extend<TApiBaseFixtures>({
    e2eUserId: async (
      { request: _request }: { request: APIRequestContext },
      use: (id: string) => Promise<void>,
      testInfo: TestInfo,
    ) => {
      await use(buildE2EUserId(testInfo));
    },

    testUser: async (
      { request, e2eUserId }: { request: APIRequestContext; e2eUserId: string },
      use: (user: TestUser) => Promise<void>,
      testInfo: TestInfo,
    ) => {
      const testUser = new TestUser({
        request,
        userId: e2eUserId,
        displayName: buildDisplayName(testInfo),
      });
      testUser.setSessionCookie(await mintApiSessionCookie(request, SESSION_ENDPOINTS[mode]));
      await use(testUser);
    },
  });
}

export { expect };
