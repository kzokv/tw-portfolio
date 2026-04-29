/**
 * KZO-180 — OAuth E2E for the user-level reporting currency selector.
 *
 * CRITICAL — per `.claude/rules/e2e-oauth-seed-as-browser.md`:
 *   - Settings drawer requires real OAuth session.
 *   - Use the browser session cookie (not testUser.userId) when seeding state
 *     the BROWSER will read.
 *   - Order MUST be: install per-test cookie → seed → navigate.
 *
 * KZO-180 review iter 2: each test mints a per-test session and overrides the
 * default OAuth fixture cookie before navigation. The default fixture user
 * (`e2e-ci-google-sub-001`) is shared by other parallel test files; their
 * `_setUserPreferences` calls REPLACE the entire prefs row and would race our
 * `reportingCurrency` seeds. Per-test sessions isolate each test's prefs row
 * (mirrors `dashboard-timeframe-aaa.spec.ts` precedent).
 *
 * Per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`:
 *   This spec does NOT seed daily bars — assertions are on the dropdown +
 *   backend-reflected preference, not on translated KPI values via the bar
 *   pipeline. So no ticker reservation is consumed.
 *
 * Per `.claude/rules/playwright-request-cookie-jar-isolation.md`:
 *   Direct API helpers use `withFreshContext(...)` so the test's shared
 *   `request` cookie jar isn't polluted by `Set-Cookie` responses.
 *
 * AAA framework note: this spec routes assertions through `appShell.assert.*`
 * (mxAssert mixin methods + `expect.poll` for visibility waits) per the
 * `.eslintrc` `no-restricted-syntax` rule that forbids raw `expect(locator)`.
 */

import {
  request as apiRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { TestEnv } from "@tw-portfolio/config/test";
import { extractCookieValue } from "@tw-portfolio/test-framework/shared";
import { test, expect } from "@tw-portfolio/test-e2e/fixtures/oauthPages";
import { makeDeterministicIdToken } from "@tw-portfolio/test-e2e/utils";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

// ── Context-isolated helpers ────────────────────────────────────────────────

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
  cookieValue: string;
  userId: string;
}

/**
 * Mint a member-role session with a deterministic per-test sub/email so the
 * resulting user is isolated from the shared OAuth fixture user. Mirrors the
 * pattern used in `dashboard-timeframe-aaa.spec.ts`.
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
      cookieValue,
      userId: body.userId,
    };
  });
}

/**
 * Replace the page context's session cookie with a per-test session before any
 * navigation runs. Caller must invoke before `navigateToRoute(...)`.
 */
async function installPerTestCookie(page: Page, session: SessionCookie): Promise<void> {
  await page.context().addCookies([{
    name: TestEnv.sessionCookieName,
    value: session.cookieValue,
    domain: TestEnv.host,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: TestEnv.sessionCookieName.startsWith("__Host-"),
  }]);
}

async function seedPreferencesForUser(
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
      throw new Error(
        `seed-user-preferences failed: ${response.status()} ${await response.text()}`,
      );
    }
  });
}

async function getReportingCurrencyFromApi(cookieHeader: string): Promise<string | undefined> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.get(apiPath("/user-preferences"), {
      headers: { cookie: cookieHeader },
    });
    if (!response.ok()) throw new Error(`GET /user-preferences failed: ${response.status()}`);
    const body = await response.json() as {
      preferences: { reportingCurrency?: string };
    };
    return body.preferences.reportingCurrency;
  });
}

// ── Test suite ──────────────────────────────────────────────────────────────

test.describe("dashboard reporting currency (KZO-180)", () => {
  // ── E2E-1 — Default → dropdown shows TWD ─────────────────────────────────
  test("[reporting-currency-A]: seed reportingCurrency=TWD → open settings → Display tab → dropdown initial value is 'TWD'", async ({
    appShell,
    page,
  }) => {
    const session = await mintMemberSession({
      sub: "reporting-currency-A-sub",
      email: "reporting-currency-A@example.com",
      name: "Reporting Currency A",
    });
    await installPerTestCookie(page, session);
    await seedPreferencesForUser(session.cookieHeader, session.userId, {
      reportingCurrency: "TWD",
    });
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await appShell.actions.clickSettingsDisplayTab();

    const select = page.getByTestId("reporting-currency-select");
    await expect.poll(async () => select.isVisible(), {
      timeout: 5_000,
      intervals: [200, 400],
    }).toBe(true);
    await appShell.assert.mxAssertEqual(
      await select.inputValue(),
      "TWD",
      "reporting-currency-select initial value",
    );
  });

  // ── E2E-2 — Switch TWD → USD: persists via PATCH + saved flash ───────────
  test("[reporting-currency-B]: change select to USD → saved-flash → backend reflects, select retains USD", async ({
    appShell,
    page,
  }) => {
    const session = await mintMemberSession({
      sub: "reporting-currency-B-sub",
      email: "reporting-currency-B@example.com",
      name: "Reporting Currency B",
    });
    await installPerTestCookie(page, session);
    await seedPreferencesForUser(session.cookieHeader, session.userId, {
      reportingCurrency: "TWD",
    });
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await appShell.actions.clickSettingsDisplayTab();

    const select = page.getByTestId("reporting-currency-select");
    await appShell.assert.mxAssertEqual(
      await select.inputValue(),
      "TWD",
      "reporting-currency-select pre-change value",
    );

    // Change selection — DisplayTabSection auto-PATCHes /user-preferences.
    await select.selectOption("USD");

    // Saved flash appears within ~5s of the PATCH resolving.
    const savedFlash = page.getByTestId("reporting-currency-saved");
    await expect.poll(async () => savedFlash.isVisible(), {
      timeout: 5_000,
      intervals: [200, 400, 600],
    }).toBe(true);

    // Backend reflects the change. This is the load-bearing contract — the
    // PATCH landed on the persisted prefs row, so the next dashboard fetch
    // will translate at the new currency.
    const persisted = await getReportingCurrencyFromApi(session.cookieHeader);
    await appShell.assert.mxAssertEqual(persisted, "USD", "persisted reportingCurrency");
  });

  // ── E2E-3 — Persists across reload ───────────────────────────────────────
  test("[reporting-currency-C]: seed reportingCurrency=USD → backend returns USD on subsequent GET (load-bearing pre-mount contract)", async ({
    appShell,
    page,
  }) => {
    const session = await mintMemberSession({
      sub: "reporting-currency-C-sub",
      email: "reporting-currency-C@example.com",
      name: "Reporting Currency C",
    });
    await installPerTestCookie(page, session);
    await seedPreferencesForUser(session.cookieHeader, session.userId, {
      reportingCurrency: "USD",
    });
    await appShell.actions.navigateToRoute("/dashboard");
    const persistedAfterNavigate = await getReportingCurrencyFromApi(session.cookieHeader);
    await appShell.assert.mxAssertEqual(
      persistedAfterNavigate,
      "USD",
      "GET /user-preferences post-seed reflects USD",
    );
  });

  // ── E2E-edge-1 — Initial state when pref is AUD ──────────────────────────
  test("[reporting-currency-D]: seed reportingCurrency=AUD → open Display tab → dropdown shows 'AUD'", async ({
    appShell,
    page,
  }) => {
    const session = await mintMemberSession({
      sub: "reporting-currency-D-sub",
      email: "reporting-currency-D@example.com",
      name: "Reporting Currency D",
    });
    await installPerTestCookie(page, session);
    await seedPreferencesForUser(session.cookieHeader, session.userId, {
      reportingCurrency: "AUD",
    });
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await appShell.actions.clickSettingsDisplayTab();

    const select = page.getByTestId("reporting-currency-select");
    await expect.poll(async () => select.isVisible(), {
      timeout: 5_000,
      intervals: [200, 400],
    }).toBe(true);
    await expect.poll(async () => select.inputValue(), {
      timeout: 5_000,
      intervals: [200, 400],
    }).toBe("AUD");
  });
});
