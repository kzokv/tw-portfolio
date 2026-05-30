/**
 * sessionBase — parameterized session fixture factory.
 * Unifies the session-minting logic shared by oauthBase and demoBase.
 */
import { test as base } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { E2E_ENDPOINTS } from "../constants/index.js";
import {
  buildUserFixtures,
  emptyStorageState,
  mintSessionCookieValue,
  type TBaseFixtures,
} from "./shared.js";

export type TSessionFixtureMode = "oauth" | "demo";

export interface TSessionFixtureConfig {
  endpoint: string;
  cookieMode: "domain" | "url";
}

const SESSION_CONFIGS: Record<TSessionFixtureMode, TSessionFixtureConfig> = {
  oauth: {
    endpoint: E2E_ENDPOINTS.OAUTH_SESSION,
    cookieMode: "domain",
  },
  demo: {
    endpoint: E2E_ENDPOINTS.DEMO_SESSION,
    cookieMode: "url",
  },
};

export function createSessionFixtureConfig(mode: TSessionFixtureMode): TSessionFixtureConfig {
  return SESSION_CONFIGS[mode];
}

export function createSessionTest(mode: TSessionFixtureMode) {
  const config = SESSION_CONFIGS[mode];

  return base.extend<TBaseFixtures>({
    storageState: emptyStorageState(),

    page: async ({ page, request }, use) => {
      const cookieValue = await mintSessionCookieValue(request, config.endpoint);
      const cookieName = TestEnv.sessionCookieName;

      if (config.cookieMode === "domain") {
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
      } else {
        await page.context().addCookies([
          {
            name: cookieName,
            value: cookieValue,
            url: TestEnv.appBaseUrl,
          },
        ]);
      }

      await use(page);
    },

    ...buildUserFixtures(false),
  });
}
