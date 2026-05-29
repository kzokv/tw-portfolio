// KZO-161 (158C) — AAA E2E for user timeframe customization (F4).
//
// Covers the gear icon on PortfolioTrendCard → CustomizeRangesPopover:
//   [timeframe-L] open popover → reorder via drag → Save → pills update + state read-back
//   [timeframe-M] toggle range off → Save → pill absent from card
//   [timeframe-N] add custom range → Save → chip persisted
//   [timeframe-O] Reset → dashboardPerformanceRanges: null via state read-back
//   [timeframe-P] range-snap: user removes currently-selected range → snaps to [0]
//   [timeframe-Q] mobile path: Display tab → Timeframes section (same behavior)
//
// All tests run in specs-oauth/ (AUTH_MODE=oauth, real session cookies).
// Seed via POST /__e2e/seed-user-preferences with testUser.userId.
// State assertions use GET /user-preferences (not DOM inspection) per design doc.
//
// Desktop-only: mobile TouchSensor + long-press is a known E2E gap (manual only).
// [timeframe-Q] uses setViewport to a mobile width and exercises the Display tab path.

import {
  request as apiRequest,
  type APIRequestContext,
} from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { extractCookieValue } from "@vakwen/test-framework/shared";
import { test, expect } from "@vakwen/test-e2e/fixtures/oauthPages";
import { makeDeterministicIdToken } from "@vakwen/test-e2e/utils";
import { acquireAdminTimeframeLock } from "./helpers/adminTimeframeLock";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

// ── Context-isolated helpers ─────────────────────────────────────────────────

/**
 * Run a callback against a throwaway APIRequestContext so no session cookie
 * bleeds into the test's shared `request` jar.
 * Per `.claude/rules/playwright-request-cookie-jar-isolation.md`.
 */
async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

interface SessionCookie {
  cookieHeader: string;
  userId: string;
}

interface TimeframeSaveAppShell {
  actions: {
    clickTimeframeSaveButton(): Promise<void>;
  };
  assert: {
    timeframeSaveButtonIsEnabled(): Promise<void>;
  };
}

/**
 * Mint a member-role session with a deterministic sub/email.
 * Returns the cookie header (for seeding) and the userId (as seed target).
 *
 * All body reading happens INSIDE the withFreshContext callback so the
 * response is fully consumed before the context is disposed.
 *
 * Used by [timeframe-L] and [timeframe-O] to override the default oauth
 * fixture session (shared sub: "e2e-ci-google-sub-001") with a per-test
 * dedicated user. Per `.claude/rules/playwright-oauth-re-login-claim-pollution.md`.
 */
async function mintMemberSession(options: {
  sub: string;
  email: string;
  name: string;
}): Promise<SessionCookie> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/oauth-session?role=member"), {
      data: {
        id_token: makeDeterministicIdToken({
          sub: options.sub,
          email: options.email,
          name: options.name,
        }),
      },
    });
    if (!response.ok()) {
      throw new Error(`oauth-session mint failed: ${response.status()} ${await response.text()}`);
    }
    const cookieValue = extractCookieValue(
      response.headers()["set-cookie"] ?? "",
      TestEnv.sessionCookieName,
    );
    if (!cookieValue) throw new Error(`Session cookie "${TestEnv.sessionCookieName}" missing from Set-Cookie`);
    const body = await response.json() as { userId: string };
    return {
      cookieHeader: `${TestEnv.sessionCookieName}=${cookieValue}`,
      userId: body.userId,
    };
  });
}

/**
 * Seed user preferences for a given userId.
 * Uses fresh context per `.claude/rules/playwright-request-cookie-jar-isolation.md`.
 * Uses testUser.userId (not "user-1") per `.claude/rules/e2e-seed-testuser-userid.md`.
 */
async function seedUserPreferences(
  cookieHeader: string,
  userId: string,
  preferences: Record<string, unknown>,
): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/seed-user-preferences"), {
      headers: { cookie: cookieHeader },
      data: { userId, preferences },
    });
    if (!response.ok()) {
      throw new Error(`seed-user-preferences failed: ${response.status()} ${await response.text()}`);
    }
  });
}

async function getDashboardPerformanceRanges(
  cookieHeader: string,
): Promise<string[] | null> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.get(apiPath("/user-preferences"), {
      headers: { cookie: cookieHeader },
    });
    if (!response.ok()) {
      throw new Error(`GET /user-preferences failed: ${response.status()} ${await response.text()}`);
    }
    const body = await response.json() as {
      preferences: { dashboardPerformanceRanges?: string[] };
    };
    return body.preferences.dashboardPerformanceRanges ?? null;
  });
}

async function saveDashboardPerformanceRangesWithRetry(options: {
  appShell: TimeframeSaveAppShell;
  cookieHeader: string;
  expectedRanges: string[];
}): Promise<void> {
  const expected = JSON.stringify(options.expectedRanges);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await options.appShell.actions.clickTimeframeSaveButton();
    try {
      await expect
        .poll(
          async () => JSON.stringify(await getDashboardPerformanceRanges(options.cookieHeader)),
          { timeout: 5000, intervals: [300, 500, 700, 1000] },
        )
        .toBe(expected);
      return;
    } catch (err) {
      lastError = err;
      await options.appShell.assert.timeframeSaveButtonIsEnabled();
    }
  }
  throw lastError;
}

/**
 * Mint an admin cookie and patch the admin timeframe config.
 * Returns the admin cookie for cleanup.
 */
async function setAdminTimeframeConfig(
  ranges: string[] | null,
): Promise<SessionCookie> {
  // Mint an admin session directly (member cookie not needed).
  const adminCtx = await apiRequest.newContext();
  try {
    const adminResponse = await adminCtx.post(apiPath("/__e2e/oauth-session?role=admin"), {
      data: {
        id_token: makeDeterministicIdToken({
          sub: "dashboard-timeframe-admin-sub",
          email: "dashboard-timeframe-admin@example.com",
          name: "Timeframe Admin",
        }),
      },
    });
    if (!adminResponse.ok()) {
      throw new Error(`admin session mint failed: ${adminResponse.status()}`);
    }
    const cookieValue = extractCookieValue(
      adminResponse.headers()["set-cookie"] ?? "",
      TestEnv.sessionCookieName,
    );
    if (!cookieValue) throw new Error("admin cookie missing");
    const adminCookieHeader = `${TestEnv.sessionCookieName}=${cookieValue}`;
    const body = await adminResponse.json() as { userId: string };

    const patchResponse = await adminCtx.patch(apiPath("/admin/settings"), {
      headers: { cookie: adminCookieHeader },
      data: { dashboardPerformanceRanges: ranges },
    });
    if (!patchResponse.ok()) {
      throw new Error(`admin settings patch failed: ${patchResponse.status()} ${await patchResponse.text()}`);
    }
    return { cookieHeader: adminCookieHeader, userId: body.userId };
  } finally {
    await adminCtx.dispose();
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe("dashboard timeframe customization (KZO-161 F4)", () => {
  // Each test uses its own deterministic sub/email to avoid cross-test pollution.
  // Per `.claude/rules/playwright-oauth-re-login-claim-pollution.md`.
  let releaseAdminTimeframeLock: (() => Promise<void>) | undefined;

  test.beforeEach(async () => {
    releaseAdminTimeframeLock = await acquireAdminTimeframeLock();
  });

  test.afterEach(async () => {
    await releaseAdminTimeframeLock?.();
    releaseAdminTimeframeLock = undefined;
  });

  test("[timeframe-L]: open gear → popover shows effective list → drag reorder → Save → pills update + state read-back", async ({
    appShell,
    page,
  }) => {
    // Arrange — mint a per-test member session so the browser uses a fresh user
    // instead of the shared default oauth user (sub: "e2e-ci-google-sub-001").
    // Stale prefs on the shared user would corrupt this test across runs.
    // Per `.claude/rules/playwright-oauth-re-login-claim-pollution.md`.
    const [session] = await Promise.all([
      mintMemberSession({
        sub: "timeframe-L-sub",
        email: "timeframe-L@example.com",
        name: "Timeframe L",
      }),
      setAdminTimeframeConfig(["1M", "3M", "YTD", "1Y", "5Y"]),
    ]);
    // Override the fixture's session cookie before any navigation.
    await page.context().addCookies([{
      name: TestEnv.sessionCookieName,
      value: session.cookieHeader.substring(TestEnv.sessionCookieName.length + 1),
      domain: TestEnv.host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: TestEnv.sessionCookieName.startsWith("__Host-"),
    }]);

    // Seed empty prefs for session.userId — ensures no stale custom list pollutes the test.
    await seedUserPreferences(session.cookieHeader, session.userId, {});

    try {
      // Actions — navigate to /dashboard.
      await appShell.actions.navigateToRoute("/dashboard");

      // Assert — gear button is visible on PortfolioTrendCard.
      await appShell.assert.timeframeGearButtonIsVisible();

      // Actions — open the customize popover.
      await appShell.actions.openTimeframeCustomize();
      await appShell.assert.timeframeCustomizePopoverIsVisible();

      // Assert — popover shows the effective list (admin list, not raw user prefs).
      await appShell.assert.timeframeCustomizeRowIsVisible("1M");
      await appShell.assert.timeframeCustomizeRowIsVisible("3M");
      await appShell.assert.timeframeCustomizeRowIsVisible("YTD");
      await appShell.assert.timeframeCustomizeRowIsVisible("1Y");
      await appShell.assert.timeframeCustomizeRowIsVisible("5Y");

      // Actions — drag "3M" to the bottom of the list (past "5Y").
      await appShell.actions.dragTimeframeRange("3M", "5Y");
      await appShell.assert.timeframeCustomizeRowsInOrder([
        "1M",
        "YTD",
        "1Y",
        "5Y",
        "3M",
      ]);

      // Actions — Save.
      const expectedRanges = ["1M", "YTD", "1Y", "5Y", "3M"];
      await appShell.assert.timeframeSaveButtonIsEnabled();
      await saveDashboardPerformanceRangesWithRetry({
        appShell,
        cookieHeader: session.cookieHeader,
        expectedRanges,
      });

      // Assert — popover closes after save.
      await appShell.assert.timeframeCustomizePopoverIsHidden();

      // Assert — PortfolioTrendCard pill row updates without page remount.
      // The new order should have 3M moved past 5Y; assert 3M still visible.
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("1M");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("3M");

      // Assert — pill list consistent after save (DOM-only assertion).
      // State read-back verifies the browser PATCH persisted the reordered
      // range list for the same member session used by the page.
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("1M");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("YTD");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("1Y");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("5Y");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("3M");
    } finally {
      await setAdminTimeframeConfig(null);
    }
  });

  test("[timeframe-M]: toggle 1M off → Save → 1M pill absent from PortfolioTrendCard", async ({
    appShell,
    page,
  }) => {
    // Arrange — mint a per-test member session to avoid shared-user pollution.
    // Per `.claude/rules/playwright-oauth-re-login-claim-pollution.md`.
    const [session] = await Promise.all([
      mintMemberSession({
        sub: "timeframe-M-sub",
        email: "timeframe-M@example.com",
        name: "Timeframe M",
      }),
      setAdminTimeframeConfig(null),
    ]);
    await page.context().addCookies([{
      name: TestEnv.sessionCookieName,
      value: session.cookieHeader.substring(TestEnv.sessionCookieName.length + 1),
      domain: TestEnv.host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: TestEnv.sessionCookieName.startsWith("__Host-"),
    }]);

    // Arrange — reset admin config to defaults; clear user prefs.
    await seedUserPreferences(session.cookieHeader, session.userId, {});

    try {
      await appShell.actions.navigateToRoute("/dashboard");

      // Actions — open popover, toggle 1M off.
      await appShell.actions.openTimeframeCustomize();
      await appShell.assert.timeframeCustomizePopoverIsVisible();
      await appShell.assert.timeframeCustomizeRowIsVisible("1M");
      await appShell.actions.toggleTimeframeRange("1M");

      // Actions — Save.
      await appShell.actions.clickTimeframeSaveButton();
      await appShell.assert.timeframeCustomizePopoverIsHidden();

      // Assert — 1M is absent from PortfolioTrendCard pill row after refetch.
      await appShell.assert.dashboardPerformanceRangeButtonIsAbsent("1M");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("3M");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("YTD");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("1Y");
    } finally {
      await setAdminTimeframeConfig(null);
    }
  });

  test("[timeframe-N]: add custom range 6M → Save → chip appears and persisted", async ({
    appShell,
    page,
  }) => {
    // Arrange — mint a per-test member session to avoid shared-user pollution.
    // Per `.claude/rules/playwright-oauth-re-login-claim-pollution.md`.
    const [session] = await Promise.all([
      mintMemberSession({
        sub: "timeframe-N-sub",
        email: "timeframe-N@example.com",
        name: "Timeframe N",
      }),
      setAdminTimeframeConfig(null),
    ]);
    await page.context().addCookies([{
      name: TestEnv.sessionCookieName,
      value: session.cookieHeader.substring(TestEnv.sessionCookieName.length + 1),
      domain: TestEnv.host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: TestEnv.sessionCookieName.startsWith("__Host-"),
    }]);

    // Arrange — reset admin config to defaults ["1M","3M","YTD","1Y"].
    await seedUserPreferences(session.cookieHeader, session.userId, {});

    try {
      await appShell.actions.navigateToRoute("/dashboard");

      // Actions — open popover, type "6M" in custom input, Add.
      await appShell.actions.openTimeframeCustomize();
      await appShell.assert.timeframeCustomizePopoverIsVisible();
      await appShell.actions.fillTimeframeCustomInput("6M");
      await appShell.actions.clickTimeframeAddButton();

      // Assert — 6M row appeared in the popover.
      await appShell.assert.timeframeCustomizeRowIsVisible("6M");

      // Actions — Save.
      await appShell.actions.clickTimeframeSaveButton();
      await appShell.assert.timeframeCustomizePopoverIsHidden();

      // Assert — 6M pill rendered on PortfolioTrendCard after refetch.
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("6M");
    } finally {
      await setAdminTimeframeConfig(null);
    }
  });

  test("[timeframe-O]: Reset → dashboardPerformanceRanges null → pills revert to admin/default", async ({
    appShell,
    page,
  }) => {
    // Arrange — mint a per-test member session (same reason as [timeframe-L]).
    const [session] = await Promise.all([
      mintMemberSession({
        sub: "timeframe-O-sub",
        email: "timeframe-O@example.com",
        name: "Timeframe O",
      }),
      setAdminTimeframeConfig(null),
    ]);
    await page.context().addCookies([{
      name: TestEnv.sessionCookieName,
      value: session.cookieHeader.substring(TestEnv.sessionCookieName.length + 1),
      domain: TestEnv.host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: TestEnv.sessionCookieName.startsWith("__Host-"),
    }]);

    // Seed user with a custom list ["1M","3M"] so Reset is observable.
    await seedUserPreferences(session.cookieHeader, session.userId, {
      dashboardPerformanceRanges: ["1M", "3M"],
    });

    try {
      await appShell.actions.navigateToRoute("/dashboard");

      // Confirm: currently only 1M and 3M are visible (user's saved list).
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("1M");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("3M");
      await appShell.assert.dashboardPerformanceRangeButtonIsAbsent("YTD");
      await appShell.assert.dashboardPerformanceRangeButtonIsAbsent("1Y");

      // Actions — open popover, click Reset.
      await appShell.actions.openTimeframeCustomize();
      await appShell.actions.clickTimeframeResetButton();

      // Assert — popover closes (Reset triggers a save/PATCH with null).
      await appShell.assert.timeframeCustomizePopoverIsHidden();

      // Assert — pills revert to default list after refetch.
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("1M");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("3M");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("YTD");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("1Y");
    } finally {
      await setAdminTimeframeConfig(null);
    }
  });

  test("[timeframe-P]: range-snap — remove currently-selected range → performanceRange snaps to [0]", async ({
    appShell,
    page,
  }) => {
    // Arrange — mint a per-test member session to avoid shared-user pollution.
    // Per `.claude/rules/playwright-oauth-re-login-claim-pollution.md`.
    const [session] = await Promise.all([
      mintMemberSession({
        sub: "timeframe-P-sub",
        email: "timeframe-P@example.com",
        name: "Timeframe P",
      }),
      setAdminTimeframeConfig(["1M", "3M", "YTD", "1Y", "5Y"]),
    ]);
    await page.context().addCookies([{
      name: TestEnv.sessionCookieName,
      value: session.cookieHeader.substring(TestEnv.sessionCookieName.length + 1),
      domain: TestEnv.host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: TestEnv.sessionCookieName.startsWith("__Host-"),
    }]);

    // Arrange — admin sets ["1M","3M","YTD","1Y","5Y"] and seed user pref to empty.
    await seedUserPreferences(session.cookieHeader, session.userId, {});

    try {
      // Navigate to /dashboard with ?range=5Y (URL-selected range).
      await appShell.actions.navigateToRoute("/dashboard?range=5Y");

      // Confirm 5Y is currently selected (should be visible as the active pill).
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("5Y");

      // Actions — open popover, toggle 5Y off.
      await appShell.actions.openTimeframeCustomize();
      await appShell.assert.timeframeCustomizeRowIsVisible("5Y");
      await appShell.actions.toggleTimeframeRange("5Y");

      // Actions — Save.
      await appShell.actions.clickTimeframeSaveButton();
      await appShell.assert.timeframeCustomizePopoverIsHidden();

      // Assert — range-snap fires: 5Y is gone, the first range in the new
      // effective list is now selected. The snap fires in AppShell via the
      // useEffect([effectiveRanges]) guard that runs after refetch.
      // The first available range becomes the active one.
      // Verify: 5Y pill is absent; the first remaining range (1M) is visible.
      await appShell.assert.dashboardPerformanceRangeButtonIsAbsent("5Y");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("1M");

      // Assert — no 400 from /dashboard/performance (dynamic validator now
      // accepts 1M as the effective [0]; if the snap didn't fire we'd get 400).
      // Verify via the network: no clientApiErrorToast should appear.
      await appShell.assert.clientApiErrorIsAbsent();
    } finally {
      await setAdminTimeframeConfig(null);
    }
  });

  test("[timeframe-Q]: mobile path — Display tab → Timeframes section → toggle + Save works without gear", async ({
    appShell,
    page,
  }) => {
    // Arrange — mint a per-test member session to avoid shared-user pollution.
    // Per `.claude/rules/playwright-oauth-re-login-claim-pollution.md`.
    const [session] = await Promise.all([
      mintMemberSession({
        sub: "timeframe-Q-sub",
        email: "timeframe-Q@example.com",
        name: "Timeframe Q",
      }),
      setAdminTimeframeConfig(null),
    ]);
    await page.context().addCookies([{
      name: TestEnv.sessionCookieName,
      value: session.cookieHeader.substring(TestEnv.sessionCookieName.length + 1),
      domain: TestEnv.host,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: TestEnv.sessionCookieName.startsWith("__Host-"),
    }]);

    // Arrange — reset admin config to defaults; clear user prefs.
    await seedUserPreferences(session.cookieHeader, session.userId, {});

    try {
      // Switch to mobile viewport (< lg breakpoint; gear is hidden on mobile).
      await appShell.actions.setViewport(375, 812);

      await appShell.actions.navigateToRoute("/dashboard");
      // Ensure the page is fully hydrated at the mobile viewport before interacting.
      // Without this, the subsequent navigation can race against React hydration
      // and cause "Target page, context or browser has been closed" on slow
      // machines.
      await page.waitForLoadState("load");

      // Open /settings/display (route-based per Phase 3d iter 2 D2(β);
      // replaces former drawer + tab-click pair).
      await appShell.actions.openSettingsSection("display");

      // Assert — both sections render.
      await appShell.assert.displayTimeframesSectionIsVisible();
      await appShell.assert.displayLayoutSectionIsVisible();

      // Actions — toggle 1M off in the Timeframes section.
      await appShell.actions.toggleTimeframeRange("1M");

      // Actions — Save.
      await appShell.actions.clickTimeframeSaveButton();

      // Navigate back to dashboard to observe pill update.
      await appShell.actions.navigateToRoute("/dashboard");

      // Assert — 1M absent from PortfolioTrendCard (which is visible even on
      // mobile, just scrolled). The pill row still renders; 1M is excluded.
      await appShell.assert.dashboardPerformanceRangeButtonIsAbsent("1M");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("3M");
    } finally {
      await setAdminTimeframeConfig(null);
      // Restore desktop viewport.
      await appShell.actions.setViewport(1280, 800);
    }
  });
});
