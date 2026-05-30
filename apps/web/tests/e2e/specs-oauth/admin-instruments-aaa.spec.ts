/**
 * KZO-195 — OAuth E2E smoke for `/admin/instruments`.
 *
 * Lives in `specs-oauth/` because the page is admin-gated under `AUTH_MODE=oauth`.
 * Smoke coverage:
 *   - Page loads under an admin session
 *   - Table renders
 *   - Thresholds panel is visible (read-only display linking to /admin/settings)
 *
 * The Phase 9 brief calls out that the undelete button should be visible for
 * delisted rows. Without a stable seed surface for delisted AU instruments in
 * the memory-backed shared server, the smoke focuses on chrome-level
 * assertions; deeper row-state coverage belongs in Postgres integration
 * (Suite 5) or HTTP (Suite 8) tests where seed primitives exist.
 *
 * Per `.claude/rules/e2e-oauth-seed-as-browser.md`: any user-scoped seed
 * targets the BROWSER's user via the cookie returned from `/__e2e/oauth-session`.
 * This smoke does NOT seed user_preferences, so the rule does not apply
 * directly — we only mint an admin session before navigating.
 *
 * NOTE (TDD-RED): backend Phase 7 must register the route + frontend Phase 8
 * must render the page before this smoke goes green. Until then it errors at
 * navigation (404 on /admin/instruments) or testid-not-found.
 */

import {
  request as apiRequest,
  type APIRequestContext,
} from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { extractCookieValue } from "@vakwen/test-framework/shared";
import { test } from "@vakwen/test-e2e/fixtures/oauthPages";
import { AdminInstrumentsPage } from "@vakwen/test-e2e/pages";
import { makeDeterministicIdToken } from "@vakwen/test-e2e/utils";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function seedAuInstrumentWithAdminCookie(cookieValue: string): Promise<void> {
  const seedCtx = await apiRequest.newContext({
    extraHTTPHeaders: {
      cookie: `${TestEnv.sessionCookieName}=${cookieValue}`,
    },
  });
  try {
    const response = await seedCtx.post(apiPath("/__e2e/seed-instruments"), {
      data: {
        instruments: [
          {
            ticker: "AUDEL90",
            name: "KZO-195 Smoke AU Fixture",
            instrumentType: "STOCK",
            marketCode: "AU",
            barsBackfillStatus: "ready",
          },
        ],
      },
    });
    if (!response.ok()) {
      throw new Error(
        `seed-instruments failed: ${response.status()} ${await response.text()}`,
      );
    }
  } finally {
    await seedCtx.dispose();
  }
}

async function mintAdminCookieValue(): Promise<{ cookieValue: string; userId: string }> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.post(apiPath("/__e2e/oauth-session?role=admin"), {
      data: {
        id_token: makeDeterministicIdToken({
          sub: "kzo195-admin-instruments-smoke-sub",
          email: "kzo195-admin-instruments-smoke@example.com",
          name: "KZO195 Admin Instruments Smoke",
        }),
      },
    });
    if (!response.ok()) {
      throw new Error(
        `oauth-session mint failed: ${response.status()} ${await response.text()}`,
      );
    }
    const cookieValue = extractCookieValue(
      response.headers()["set-cookie"] ?? "",
      TestEnv.sessionCookieName,
    );
    if (!cookieValue) {
      throw new Error(
        `Session cookie "${TestEnv.sessionCookieName}" missing from Set-Cookie`,
      );
    }
    const body = (await response.json()) as { userId: string };
    return { cookieValue, userId: body.userId };
  });
}

test.describe("admin instruments page (KZO-195)", () => {
  test("[smoke]: page loads under admin session, table + thresholds panel render", async ({
    appShell,
    page,
  }) => {
    // Arrange — mint a dedicated admin session and install the cookie on the
    // browser context BEFORE navigation. The default oauthBase fixture mints
    // its own session (role defaults to admin via the route's
    // `userRoleSchema.default("admin")`), but we install our own deterministic
    // admin to make the auth identity explicit and survive any future change to
    // that default. Per `.claude/rules/playwright-oauth-cookie-patterns.md`
    // OAuth session cookies are scoped to `localhost` (TestEnv.host) — NOT
    // `127.0.0.1` — or the browser silently drops them.
    const admin = await mintAdminCookieValue();
    await page.context().addCookies([
      {
        name: TestEnv.sessionCookieName,
        value: admin.cookieValue,
        domain: TestEnv.host,
        path: "/",
        httpOnly: true,
        secure: TestEnv.sessionCookieName.startsWith("__Host-"),
        sameSite: "Lax",
      },
    ]);

    // Seed ≥1 AU instrument BEFORE navigation. The /admin/instruments table
    // testid is rendered only when the row count is > 0; an empty AU catalog
    // produces the empty-state and the table assertion times out.
    //
    // `/__e2e/seed-instruments` is gated by `assertE2ESeedEnabled()` AND calls
    // `resolveUserId()` — under `AUTH_MODE=oauth` that requires a valid session
    // cookie or it 401s. The helper below builds a dedicated APIRequestContext
    // carrying the same admin cookie we just minted (no double-mint). Per
    // `.claude/rules/playwright-request-cookie-jar-isolation.md` the dedicated
    // context isolates the seed call from other test-scoped request state.
    //
    // Ticker `AUDEL90` is reserved by KZO-195 (prefix `AUDEL*` per
    // `e2e-shared-memory-bars-ticker-hygiene.md`); pre-PR grep confirms no
    // collisions with other specs.
    await seedAuInstrumentWithAdminCookie(admin.cookieValue);

    // Actions — navigate to the new route.
    await appShell.actions.navigateToRoute("/admin/instruments");
    await page.waitForLoadState("load");

    // Assert — page chrome is visible.
    const adminInstruments = new AdminInstrumentsPage(page).elements;
    await adminInstruments.page.waitFor({ state: "visible" });
    await adminInstruments.table.waitFor({ state: "visible" });
    await adminInstruments.thresholdsPanel.waitFor({ state: "visible" });
    await adminInstruments.thresholdsPanelLink.waitFor({ state: "visible" });
  });
});
