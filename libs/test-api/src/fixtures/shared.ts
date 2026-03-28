import type { APIRequestContext, TestInfo } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { TestUser } from "@tw-portfolio/test-framework/core";
import { buildDisplayName, buildE2EUserId, extractCookieValue } from "@tw-portfolio/test-framework/shared";
import { registerTestApiAssistants } from "../config/mapper.js";

registerTestApiAssistants();

export interface TApiBaseFixtures {
  e2eUserId: string;
  testUser: TestUser;
}

export function buildApiUserFixtures(seedIdentity: boolean) {
  return {
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

      if (seedIdentity) {
        await testUser.reset(TestEnv.apiBaseUrl);
      }

      await use(testUser);
    },
  };
}

export type TApiSessionMode = "oauth" | "demo";

export async function mintApiSessionCookie(
  request: APIRequestContext,
  endpointPath: string,
): Promise<string> {
  const response = await request.post(new URL(endpointPath, TestEnv.apiBaseUrl).href);
  if (!response.ok()) {
    throw new Error(`${endpointPath} failed: ${response.status()} ${await response.text()}`);
  }

  const cookieName = TestEnv.sessionCookieName;
  const cookieValue = extractCookieValue(response.headers()["set-cookie"] ?? "", cookieName);
  if (!cookieValue) {
    throw new Error(`Session cookie "${cookieName}" not found in Set-Cookie header`);
  }

  return `${cookieName}=${cookieValue}`;
}
