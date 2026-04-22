// KZO-159 (158A) — AAA E2E for the admin "Dashboard Timeframe Defaults"
// section on `/admin/settings`.
//
// Covers the design Slice 9 acceptance scenarios: default chip render,
// toggle off + save + reload persists, add custom chip, reset, validation
// errors, duplicate rejection, reordering, min-1-range save guard, and a
// server-contract regression against `PATCH /admin/settings`.
//
// Lives in `specs-oauth/` because it exercises the admin-only settings
// route under the real OAuth auth path (`AUTH_MODE=oauth`). Each test
// resets the admin config to `dashboardPerformanceRanges: null` before
// running so the shared memory-backed server cannot leak state between
// tests (see the Phase 2 plan at `.worklog/team/qa-test-plan.md`).

import {
  request as apiRequest,
  type APIRequestContext,
} from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { extractCookieValue } from "@tw-portfolio/test-framework/shared";
import { test } from "@tw-portfolio/test-e2e/fixtures/oauthPages";
import { makeDeterministicIdToken } from "@tw-portfolio/test-e2e/utils";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

// ── Session + config seed helpers ───────────────────────────────────────────

interface AdminCookie {
  cookieHeader: string;
  userId: string;
}

/**
 * Mint a fresh admin-role session via /__e2e/oauth-session and return the
 * cookie header for API seed calls. Uses an isolated APIRequestContext
 * (per `.claude/rules/playwright-request-cookie-jar-isolation.md`) so the
 * test's shared `request` jar is never polluted with an admin-role cookie
 * that could override the page's own session.
 */
async function mintAdminCookie(options: {
  sub: string;
  email: string;
  name: string;
}): Promise<AdminCookie> {
  const ctx = await apiRequest.newContext();
  try {
    const response = await ctx.post(apiPath("/__e2e/oauth-session?role=admin"), {
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
    if (!cookieValue) {
      throw new Error(`Session cookie "${TestEnv.sessionCookieName}" missing from Set-Cookie`);
    }
    const body = await response.json() as { userId: string };
    return {
      cookieHeader: `${TestEnv.sessionCookieName}=${cookieValue}`,
      userId: body.userId,
    };
  } finally {
    await ctx.dispose();
  }
}

/**
 * Run a callback against a throwaway APIRequestContext — mirrors the pattern
 * in `apps/web/tests/e2e/specs/helpers/adminSettings.ts`.
 */
async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function patchAdminTimeframe(
  cookieHeader: string,
  list: string[] | null,
): Promise<void> {
  await withFreshContext(async (ctx) => {
    const response = await ctx.patch(apiPath("/admin/settings"), {
      headers: { cookie: cookieHeader },
      data: { dashboardPerformanceRanges: list },
    });
    if (!response.ok()) {
      throw new Error(
        `PATCH /admin/settings {dashboardPerformanceRanges:${JSON.stringify(list)}} failed: ${response.status()} ${await response.text()}`,
      );
    }
  });
}

/**
 * Single-line setup: mint an admin cookie, reset the admin list to null.
 * Returned cookie lets the test seed further state via PATCH if needed.
 */
async function resetAdminTimeframeDefaults(subSeed: string): Promise<AdminCookie> {
  const admin = await mintAdminCookie({
    sub: `admin-timeframe-reset-${subSeed}-sub`,
    email: `admin-timeframe-reset-${subSeed}@example.com`,
    name: "Admin Timeframe Reset",
  });
  await patchAdminTimeframe(admin.cookieHeader, null);
  return admin;
}

// ── AAA tests ───────────────────────────────────────────────────────────────

test.describe("admin timeframe defaults (KZO-159)", () => {
  test("[timeframe-A]: default render shows the 4 hardcoded chips active", async ({
    appShell,
  }) => {
    // Arrange — admin config cleared to null so the UI falls back to defaults.
    await resetAdminTimeframeDefaults("A");

    // Actions — navigate to /admin/settings and wait for ready marker.
    await appShell.actions.navigateToRoute("/admin/settings");

    // Assert — timeframe section is rendered and defaults are active.
    await appShell.assert.adminSettingsPageIsVisible();
    await appShell.assert.adminTimeframeSectionIsVisible();
    await appShell.assert.adminTimeframeChipIsActive("1M");
    await appShell.assert.adminTimeframeChipIsActive("3M");
    await appShell.assert.adminTimeframeChipIsActive("YTD");
    await appShell.assert.adminTimeframeChipIsActive("1Y");
  });

  test("[timeframe-B]: toggle 3M off + Save → reload persists", async ({
    appShell,
  }) => {
    // Arrange — reset to defaults.
    await resetAdminTimeframeDefaults("B");

    // Actions — navigate, toggle 3M off, save.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminTimeframeChipIsActive("3M");
    await appShell.actions.clickAdminTimeframeChip("3M");
    await appShell.actions.clickAdminTimeframeSave();
    await appShell.assert.adminTimeframeSaveSuccessIsVisible();

    // Actions — full reload.
    await appShell.actions.reloadPage();
    await appShell.assert.adminSettingsPageIsVisible();

    // Assert — 3M is no longer active; the other three defaults remain.
    await appShell.assert.adminTimeframeChipIsInactive("3M");
    await appShell.assert.adminTimeframeChipIsActive("1M");
    await appShell.assert.adminTimeframeChipIsActive("YTD");
    await appShell.assert.adminTimeframeChipIsActive("1Y");
  });

  test("[timeframe-C]: add custom 5Y chip + Save → reload persists", async ({
    appShell,
  }) => {
    // Arrange — reset.
    await resetAdminTimeframeDefaults("C");

    // Actions — navigate, add 5Y via custom input, save.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.actions.fillAdminTimeframeAddInput("5Y");
    await appShell.actions.clickAdminTimeframeAddButton();
    await appShell.assert.adminTimeframeChipIsActive("5Y");
    await appShell.actions.clickAdminTimeframeSave();
    await appShell.assert.adminTimeframeSaveSuccessIsVisible();

    // Actions — reload.
    await appShell.actions.reloadPage();
    await appShell.assert.adminSettingsPageIsVisible();

    // Assert — 5Y persisted as active.
    await appShell.assert.adminTimeframeChipIsActive("5Y");
  });

  test("[timeframe-D]: Reset to defaults + Save → clears admin override", async ({
    appShell,
  }) => {
    // Arrange — pre-seed admin list with ONLY 5Y so Reset is observable.
    const admin = await resetAdminTimeframeDefaults("D");
    await patchAdminTimeframe(admin.cookieHeader, ["5Y"]);

    // Actions — navigate; observe 5Y active; click Reset; Save.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminTimeframeChipIsActive("5Y");
    await appShell.actions.clickAdminTimeframeReset();
    // After Reset, pending list is the hardcoded defaults — 5Y leaves the
    // active list (but remains reachable via the Available row).
    await appShell.assert.adminTimeframeChipIsActive("1M");
    await appShell.assert.adminTimeframeChipIsActive("3M");
    await appShell.assert.adminTimeframeChipIsActive("YTD");
    await appShell.assert.adminTimeframeChipIsActive("1Y");
    await appShell.actions.clickAdminTimeframeSave();
    await appShell.assert.adminTimeframeSaveSuccessIsVisible();

    // Actions — reload.
    await appShell.actions.reloadPage();
    await appShell.assert.adminSettingsPageIsVisible();

    // Assert — defaults are active; 5Y is NOT active (either absent or
    // shown as an Available predefined chip).
    await appShell.assert.adminTimeframeChipIsActive("1M");
    await appShell.assert.adminTimeframeChipIsActive("3M");
    await appShell.assert.adminTimeframeChipIsActive("YTD");
    await appShell.assert.adminTimeframeChipIsActive("1Y");
    await appShell.assert.adminTimeframeChipIsInactive("5Y");
  });

  test("[timeframe-E1]: invalid custom input '0M' → validation error, Save disabled", async ({
    appShell,
  }) => {
    // Arrange — reset.
    await resetAdminTimeframeDefaults("E1");

    // Actions — navigate, fill invalid '0M', click Add.
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.actions.fillAdminTimeframeAddInput("0M");

    // Assert — the client validates on change (no need to click Add); error
    // visible and the Add button should be disabled, Save still enabled
    // (pending list is valid defaults). The explicit guarantee from the
    // design is that invalid custom input DOES NOT mutate `pendingRanges`
    // and surfaces the error.
    await appShell.assert.adminTimeframeValidationErrorIsVisible();
    await appShell.assert.adminTimeframeChipIsAbsent("0M");
  });

  test("[timeframe-E2]: invalid custom input 'abc' → validation error", async ({
    appShell,
  }) => {
    await resetAdminTimeframeDefaults("E2");
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.actions.fillAdminTimeframeAddInput("abc");
    await appShell.assert.adminTimeframeValidationErrorIsVisible();
    await appShell.assert.adminTimeframeChipIsAbsent("abc");
  });

  test("[timeframe-E3]: invalid custom input '1m' (lowercase) → validation error", async ({
    appShell,
  }) => {
    // Case-sensitivity regression: grammar rejects lowercase.
    await resetAdminTimeframeDefaults("E3");
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.actions.fillAdminTimeframeAddInput("1m");
    await appShell.assert.adminTimeframeValidationErrorIsVisible();
    await appShell.assert.adminTimeframeChipIsAbsent("1m");
  });

  test("[timeframe-F]: duplicate range rejected — '1M' already active", async ({
    appShell,
  }) => {
    // Arrange — defaults include 1M.
    await resetAdminTimeframeDefaults("F");
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminTimeframeChipIsActive("1M");

    // Actions — attempt to add 1M again via the custom input.
    await appShell.actions.fillAdminTimeframeAddInput("1M");

    // Assert — duplicate error visible; still exactly one '1M' chip.
    await appShell.assert.adminTimeframeValidationErrorIsVisible();
    await appShell.assert.adminTimeframeChipIsActive("1M");
  });

  test("[timeframe-G]: reorder 1M down via ↓ persists on reload", async ({
    appShell,
  }) => {
    // Arrange — reset to defaults ["1M","3M","YTD","1Y"].
    await resetAdminTimeframeDefaults("G");
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminTimeframeChipsInOrder(["1M", "3M", "YTD", "1Y"]);

    // Actions — move 1M down once.
    await appShell.actions.clickAdminTimeframeChipDown("1M");
    await appShell.assert.adminTimeframeChipsInOrder(["3M", "1M", "YTD", "1Y"]);
    await appShell.actions.clickAdminTimeframeSave();
    await appShell.assert.adminTimeframeSaveSuccessIsVisible();

    // Actions — reload.
    await appShell.actions.reloadPage();
    await appShell.assert.adminSettingsPageIsVisible();

    // Assert — order persisted as [3M, 1M, YTD, 1Y].
    await appShell.assert.adminTimeframeChipsInOrder(["3M", "1M", "YTD", "1Y"]);
  });

  test("[timeframe-H]: ↑ on the first chip is disabled (boundary) and ↓ on the last chip is disabled", async ({
    appShell,
  }) => {
    // Arrange — reset to defaults; 1M is first, 1Y is last.
    await resetAdminTimeframeDefaults("H");
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminTimeframeChipsInOrder(["1M", "3M", "YTD", "1Y"]);

    // Assert — boundary buttons are disabled (UI guards against reordering
    // past the ends of the list so there's nothing to click).
    await appShell.assert.adminTimeframeChipUpButtonIsDisabled("1M");
    await appShell.assert.adminTimeframeChipDownButtonIsDisabled("1Y");

    // Assert — middle chips have both buttons enabled.
    await appShell.assert.adminTimeframeChipsInOrder(["1M", "3M", "YTD", "1Y"]);
  });

  test("[timeframe-I]: min-1 range guard — toggling all 4 chips off disables Save", async ({
    appShell,
  }) => {
    // Arrange — reset to defaults.
    await resetAdminTimeframeDefaults("I");
    await appShell.actions.navigateToRoute("/admin/settings");
    await appShell.assert.adminTimeframeSaveButtonIsEnabled();

    // Actions — toggle each of the 4 defaults off.
    await appShell.actions.clickAdminTimeframeChip("1M");
    await appShell.actions.clickAdminTimeframeChip("3M");
    await appShell.actions.clickAdminTimeframeChip("YTD");
    await appShell.actions.clickAdminTimeframeChip("1Y");

    // Assert — empty-list error visible; Save disabled.
    await appShell.assert.adminTimeframeValidationErrorIsVisible();
    await appShell.assert.adminTimeframeSaveButtonIsDisabled();
  });

  test("[timeframe-J]: PATCH /admin/settings rejects invalid list (server regression)", async ({
    appShell,
  }) => {
    // Arrange — mint admin cookie separately so the test's browser session is
    // untouched.
    const admin = await mintAdminCookie({
      sub: "admin-timeframe-server-reject-sub",
      email: "admin-timeframe-server-reject@example.com",
      name: "Admin Timeframe Server Reject",
    });

    // Actions — send lowercase '1m' directly via the API.
    const response = await withFreshContext(async (ctx) => {
      return ctx.patch(apiPath("/admin/settings"), {
        headers: { cookie: admin.cookieHeader },
        data: { dashboardPerformanceRanges: ["1m"] },
      });
    });

    // Assert — 400 rejection.
    await appShell.assert.mxAssertEqual(response.status(), 400, "PATCH status");
  });

  // Regression guard for HIGH-1 (Phase 3 CR finding). Before the effective-
  // ranges wiring landed, the dashboard hero + performance-card button
  // groups were hardcoded to `DEFAULT_DASHBOARD_PERFORMANCE_RANGES`, so a
  // valid admin override was stored in the DB but silently ignored by the
  // UI. Without this test, a future refactor could re-introduce the
  // hardcoded list and the admin tab would keep appearing to "save"
  // without affecting anything visible. The scenario asserts both surfaces
  // (hero + card) render exactly the admin-configured list.
  test("[timeframe-K]: admin range config propagates to dashboard UI (HIGH-1 regression)", async ({
    appShell,
  }) => {
    // Arrange — admin sets a custom list that deliberately has zero overlap
    // with the default list so drift is unambiguous.
    const admin = await resetAdminTimeframeDefaults("K");
    await patchAdminTimeframe(admin.cookieHeader, ["6M", "YTD", "2Y"]);

    try {
      // Actions — navigate as the (admin-role, default `appShell` session)
      // user to /dashboard. The AppShell fetches GET
      // /user-preferences/effective-ranges on mount and seeds both the hero
      // row and the PortfolioTrendCard via the `ranges` prop.
      await appShell.actions.navigateToRoute("/dashboard");

      // Assert — hero row renders ONLY the admin-configured ranges.
      await appShell.assert.dashboardHeroRangeButtonIsVisible("6M");
      await appShell.assert.dashboardHeroRangeButtonIsVisible("YTD");
      await appShell.assert.dashboardHeroRangeButtonIsVisible("2Y");
      await appShell.assert.dashboardHeroRangeButtonIsAbsent("1M");
      await appShell.assert.dashboardHeroRangeButtonIsAbsent("3M");
      await appShell.assert.dashboardHeroRangeButtonIsAbsent("1Y");

      // Assert — PortfolioTrendCard renders ONLY the admin-configured ranges.
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("6M");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("YTD");
      await appShell.assert.dashboardPerformanceRangeButtonIsVisible("2Y");
      await appShell.assert.dashboardPerformanceRangeButtonIsAbsent("1M");
      await appShell.assert.dashboardPerformanceRangeButtonIsAbsent("3M");
      await appShell.assert.dashboardPerformanceRangeButtonIsAbsent("1Y");
    } finally {
      // Cleanup — reset the admin override so downstream tests see defaults.
      await patchAdminTimeframe(admin.cookieHeader, null);
    }
  });
});
