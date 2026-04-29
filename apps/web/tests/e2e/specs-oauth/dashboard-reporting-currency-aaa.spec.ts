/**
 * KZO-180 — OAuth E2E for the user-level reporting currency selector.
 *
 * CRITICAL — per `.claude/rules/e2e-oauth-seed-as-browser.md`:
 *   - Settings drawer requires real OAuth session.
 *   - Use the BROWSER session cookie (not testUser.userId) when seeding state
 *     the browser will read.
 *   - Order MUST be: read cookie → seed → navigate.
 *   - The OAuth fixture pre-installs the session cookie on `page.context()`
 *     before the test body runs.
 *
 * Why no per-test session mint here (KZO-180 review iter 4):
 *   The default OAuth fixture session (`e2e-ci-google-sub-001`) is shared by
 *   all OAuth specs. Earlier iterations minted a per-test session to dodge a
 *   cross-file race where another file's `_setUserPreferences` (replace
 *   semantics) could wipe our `reportingCurrency` mid-flight. That worked but
 *   doubled the per-test `/__e2e/oauth-session` mint count, pushing the
 *   suite-wide rate-limit budget (120 mutations/60s) over the line in CI and
 *   surfacing 429s on unrelated specs (`transactions-card-reorder-aaa`).
 *
 *   The race is best handled by the suite's tier-1 contract: each test seeds
 *   IMMEDIATELY before navigating, and the browser's first dashboard fetch
 *   reads the just-seeded value. Cross-file replacement that arrives AFTER
 *   our navigation can't disturb the assertion path because the assertion
 *   reads the same prefs row through the same fixture cookie. CI retries=2
 *   handles any residual flake without inflating mint volume.
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
import { test, expect } from "@tw-portfolio/test-e2e/fixtures/oauthPages";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

// ── Context-isolated helpers (mirror portfolio-card-reorder-aaa.spec.ts) ─────

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function getTestUserCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sc = cookies.find((c) => c.name === TestEnv.sessionCookieName);
  if (!sc) {
    throw new Error(
      `Session cookie "${TestEnv.sessionCookieName}" not found in browser context.`,
    );
  }
  return `${sc.name}=${sc.value}`;
}

async function seedAsBrowser(
  page: Page,
  preferences: Record<string, unknown>,
): Promise<void> {
  const cookieHeader = await getTestUserCookieHeader(page);
  await withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/seed-user-preferences"), {
      headers: { cookie: cookieHeader },
      data: { preferences },
    });
    if (!response.ok()) {
      throw new Error(
        `seed-user-preferences (browser) failed: ${response.status()} ${await response.text()}`,
      );
    }
  });
}

async function getReportingCurrencyFromApi(page: Page): Promise<string | undefined> {
  const cookieHeader = await getTestUserCookieHeader(page);
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

// Serial within the file so test order is stable. Test C asserts the seed
// landed on the same prefs row the page just read; running C in parallel with
// B's `onReportingCurrencySaved` callback can race on the shared default user.
test.describe.configure({ mode: "serial" });

test.describe("dashboard reporting currency (KZO-180)", () => {
  // ── E2E-1 — Default → dropdown shows TWD ─────────────────────────────────
  test("[reporting-currency-A]: seed reportingCurrency=TWD → open settings → Display tab → dropdown initial value is 'TWD'", async ({
    appShell,
    page,
  }) => {
    await seedAsBrowser(page, { reportingCurrency: "TWD" });
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
    await seedAsBrowser(page, { reportingCurrency: "TWD" });
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
    const persisted = await getReportingCurrencyFromApi(page);
    await appShell.assert.mxAssertEqual(persisted, "USD", "persisted reportingCurrency");
  });

  // ── E2E-3 — Persists across reload ───────────────────────────────────────
  test("[reporting-currency-C]: seed reportingCurrency=USD → backend returns USD on subsequent GET (load-bearing pre-mount contract)", async ({
    appShell,
    page,
  }) => {
    await seedAsBrowser(page, { reportingCurrency: "USD" });
    await appShell.actions.navigateToRoute("/dashboard");
    const persistedAfterNavigate = await getReportingCurrencyFromApi(page);
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
    await seedAsBrowser(page, { reportingCurrency: "AUD" });
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
