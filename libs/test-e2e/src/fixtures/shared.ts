import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { APIRequestContext, Browser, Page, TestInfo } from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { ActionLogger } from "@tw-portfolio/test-framework/logging";
import { createUIActions } from "@tw-portfolio/test-framework/actions";
import { TestUser } from "@tw-portfolio/test-framework/core";
import type { TUIActions } from "@tw-portfolio/test-framework/core";
import {
  buildDisplayName,
  buildE2EUserId,
  extractCookieValue,
} from "@tw-portfolio/test-framework/shared";

import { registerTestE2EAssistants } from "../config/mapper.js";
import { appUrl } from "../utils/url.js";

registerTestE2EAssistants();

/**
 * Per-worker cache of prewarmed app routes. Intentionally never reset during
 * fixture teardown — prewarming is shared across tests in the same worker to
 * avoid redundant HTTP requests. Use `_resetWarmedRoutes()` only in test
 * isolation scenarios where re-prewarming is needed.
 */
const warmedAppRoutes = new Set<string>();

function resolveJsonlPath(testInfo: TestInfo): string {
  const reportDir = join(testInfo.config.rootDir, "playwright-report");
  mkdirSync(reportDir, { recursive: true });
  return join(reportDir, "actions.jsonl");
}

export function createTestActionLogger(testInfo: TestInfo): ActionLogger {
  return new ActionLogger({
    testName: testInfo.title,
    jsonlPath: resolveJsonlPath(testInfo),
  });
}

export function attachBrowserErrorListener(page: Page, logger: ActionLogger): void {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      logger.pushError(msg.text());
    }
  });
}

export function _resetWarmedRoutes(): void {
  warmedAppRoutes.clear();
}

export function emptyStorageState() {
  return [{ cookies: [], origins: [] }, { scope: "test" }] as [
    { cookies: []; origins: [] },
    { scope: "test" },
  ];
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

export function createFixtureTestUser(options: {
  displayName?: string;
  page?: Page;
  request: APIRequestContext;
  role?: string;
  uiActions?: TUIActions;
  userId: string;
}): TestUser {
  return new TestUser(options);
}

export async function withCreateTestUserFactory(
  context: {
    browser: Browser;
    e2eUserId: string;
    request: APIRequestContext;
  },
  use: (factory: TCreateTestUser) => Promise<void>,
  testInfo: TestInfo,
  initializeTestUser?: (testUser: TestUser, options: { hasPage: boolean }) => Promise<void>,
): Promise<void> {
  const ownedPages: Page[] = [];
  let extraUserCount = 0;

  await use(async (options = {}) => {
    const userId = options.userId ?? `${context.e2eUserId}-extra-${++extraUserCount}`;
    const displayName = options.displayName ?? buildDisplayName(testInfo);
    const page = options.page
      ?? (options.withPage === false ? undefined : await context.browser.newPage());

    if (page && !options.page) {
      ownedPages.push(page);
    }

    const testUser = createFixtureTestUser({
      request: context.request,
      userId,
      displayName,
      ...(page && { page }),
      ...(options.role && { role: options.role }),
      ...(options.uiActions && { uiActions: options.uiActions }),
    });

    if (initializeTestUser) {
      await initializeTestUser(testUser, { hasPage: Boolean(page) });
    }

    return testUser;
  });

  while (ownedPages.length > 0) {
    await ownedPages.pop()?.close();
  }
}

/**
 * Builds the three user-related fixtures (e2eUserId, testUser, createTestUser)
 * parameterized by whether to seed identity (reset + assignIdentity).
 *
 * base.ts uses seedIdentity=true; oauthBase, demoBase, noAuthBase use false.
 */
export function buildUserFixtures(seedIdentity: boolean) {
  const initCallback = seedIdentity
    ? async (testUser: TestUser, opts: { hasPage: boolean }) => {
        await testUser.reset(TestEnv.apiBaseUrl);
        if (opts.hasPage) {
          await testUser.assignIdentity(TestEnv.appBaseUrl);
        }
      }
    : undefined;

  return {
    e2eUserId: async (
      { request: _request }: { request: APIRequestContext },
      use: (id: string) => Promise<void>,
      testInfo: TestInfo,
    ) => {
      await use(buildE2EUserId(testInfo));
    },

    testUser: async (
      {
        page,
        request,
        e2eUserId,
      }: { page: Page; request: APIRequestContext; e2eUserId: string },
      use: (user: TestUser) => Promise<void>,
      testInfo: TestInfo,
    ) => {
      const logger = createTestActionLogger(testInfo);
      const uiActions = createUIActions({ logger });
      attachBrowserErrorListener(page, logger);

      const testUser = createFixtureTestUser({
        page,
        request,
        userId: e2eUserId,
        displayName: buildDisplayName(testInfo),
        uiActions,
      });

      if (seedIdentity) {
        await testUser.reset(TestEnv.apiBaseUrl);
        await testUser.assignIdentity(TestEnv.appBaseUrl);
      }

      await use(testUser);
    },

    createTestUser: async (
      {
        browser,
        request,
        e2eUserId,
      }: { browser: Browser; request: APIRequestContext; e2eUserId: string },
      use: (factory: TCreateTestUser) => Promise<void>,
      testInfo: TestInfo,
    ) => {
      await withCreateTestUserFactory(
        { browser, request, e2eUserId },
        use,
        testInfo,
        initCallback,
      );
    },
  };
}

export async function mintSessionCookieValue(
  request: APIRequestContext,
  endpointPath: string,
): Promise<string> {
  const response = await request.post(new URL(endpointPath, TestEnv.apiBaseUrl).href);
  if (!response.ok()) {
    throw new Error(
      `${endpointPath} failed: ${response.status()} ${await response.text()}`,
    );
  }

  const cookieName = TestEnv.sessionCookieName;
  const setCookieHeader = response.headers()["set-cookie"] ?? "";
  const cookieValue = extractCookieValue(setCookieHeader, cookieName);
  if (!cookieValue) {
    throw new Error(`Session cookie "${cookieName}" not found in Set-Cookie header`);
  }

  return cookieValue;
}

export async function prewarmAppRoute(
  request: APIRequestContext,
  path: string,
): Promise<void> {
  if (warmedAppRoutes.has(path)) {
    return;
  }

  warmedAppRoutes.add(path);
  try {
    await request.get(appUrl(path));
  } catch {
    warmedAppRoutes.delete(path);
  }
}
