// KZO-161 (158C) — AAA E2E for dashboard card reorder (F5).
//
// Covers:
//   [card-A] drag card to new position → PATCH persisted (debounced 250ms) → state read-back
//   [card-B] Display tab → Reset Layout button → cardOrder null via state read-back → order reverts
//   [card-C] optimistic rollback: inject PATCH 500 → drag → assert render reverts after debounce
//
// All tests run in specs-oauth/ (AUTH_MODE=oauth, real session cookies).
// State assertions use GET /user-preferences (not DOM inspection) per design doc.
// Desktop-only per design doc §15: mobile TouchSensor long-press is a manual-only known gap.
//
// Card slugs from DASHBOARD_CARDS (design doc §F5):
//   "portfolio-trend", "allocation-snapshot", "return-percent",
//   "holdings-table" (fullWidth), "dividends-section" (fullWidth)
//
// Drag pattern uses locator.dragTo() — spike (Task #0) confirmed Stage 1 is sufficient.

import {
  request as apiRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { extractCookieValue } from "@vakwen/test-framework/shared";
import { test, expect } from "@vakwen/test-e2e/fixtures/oauthPages";
import { makeDeterministicIdToken } from "@vakwen/test-e2e/utils";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

/** Canonical slug order from DASHBOARD_CARDS (design doc §F5).
 *  Phase 5e removed the action-center card — recompute/snapshots moved to
 *  FloatingQuickActions; mergeCardOrder drops the slug from user prefs. */
const CANONICAL_SLUGS = [
  "portfolio-trend",
  "allocation-snapshot",
  "return-percent",
  "holdings-table",
  "dividends-section",
] as const;

// ── Context-isolated helpers ──────────────────────────────────────────────────

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

async function mintSessionCookie(options: {
  sub: string;
  email: string;
  name: string;
  role?: "member" | "admin";
}): Promise<SessionCookie> {
  return withFreshContext(async (ctx) => {
    const role = options.role ?? "member";
    const response = await ctx.post(apiPath(`/__e2e/oauth-session?role=${role}`), {
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
    if (!cookieValue) throw new Error(`Session cookie missing from Set-Cookie`);
    const body = await response.json() as { userId: string };
    return {
      cookieHeader: `${TestEnv.sessionCookieName}=${cookieValue}`,
      userId: body.userId,
    };
  });
}

/**
 * Seed preferences for the BROWSER's currently-authenticated user. The
 * fixture's OAuth session resolves to a different user than `testUser.userId`
 * (the fixture e2eUserId is not the same as the default `e2e-ci-google-sub-001`
 * resolved-user). When a test needs the browser to OBSERVE the seeded state,
 * seed via the browser's session cookie so the data lands on the same user
 * the browser will GET back.
 */
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
      throw new Error(`seed-user-preferences (browser) failed: ${response.status()} ${await response.text()}`);
    }
  });
}

/**
 * Seed user preferences using an isolated context.
 * Passes testUser.userId so owner-scoped state is seeded for the correct user.
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

/**
 * Read the cardOrder.dashboard array from user preferences.
 * Returns null if not set.
 */
async function getCardOrder(cookieHeader: string): Promise<string[] | null> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.get(apiPath("/user-preferences"), {
      headers: { cookie: cookieHeader },
    });
    if (!response.ok()) throw new Error(`GET /user-preferences failed: ${response.status()}`);
    const body = await response.json() as {
      preferences: { cardOrder?: { dashboard?: string[] } };
    };
    return body.preferences.cardOrder?.dashboard ?? null;
  });
}

/**
 * Extract the testUser's session cookie header from the browser page context.
 *
 * The testUser's session cookie is set in the browser by the oauth fixture.
 * It must be read AFTER at least one navigation (so the browser has visited the
 * app and the cookie is present). Used for API state read-back so we read the
 * same user's preferences that the browser is writing to.
 */
async function getTestUserCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sc = cookies.find((c) => c.name === TestEnv.sessionCookieName);
  if (!sc) {
    throw new Error(
      `Session cookie "${TestEnv.sessionCookieName}" not found in browser context. ` +
      `Navigate to the app before calling this helper.`,
    );
  }
  return `${sc.name}=${sc.value}`;
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe("card reorder (KZO-161 F5)", () => {
  // Desktop viewport — drag interactions require a real layout.
  test.beforeEach(async ({ appShell }) => {
    await appShell.actions.setViewport(1280, 900);
  });

  test("[card-A]: drag holdings-table above portfolio-trend → PATCH persisted after debounce → state read-back", async ({
    appShell,
    testUser,
    page,
  }) => {
    // Arrange — clear any prior cardOrder for this user.
    // mintSessionCookie creates a valid API session only used for the seed call.
    // The browser navigates as testUser (via the oauth fixture) — see HIGH-2 fix.
    const seedSession = await mintSessionCookie({
      sub: "card-reorder-A-sub",
      email: "card-reorder-A@example.com",
      name: "Card Reorder A",
    });
    await seedUserPreferences(seedSession.cookieHeader, testUser.userId, {});

    // Actions — navigate to /dashboard.
    await appShell.actions.navigateToRoute("/dashboard");

    // Extract testUser's browser session cookie for API read-back.
    // The browser navigates as testUser; the drag PATCH writes to testUser's prefs.
    // Using the seed session's cookie would read the wrong user's preferences.
    const testUserCookieHeader = await getTestUserCookieHeader(page);

    // Assert — all card drag handles are visible (confirming F5 rendered).
    await appShell.assert.cardDragHandleIsVisible("portfolio-trend");
    await appShell.assert.cardDragHandleIsVisible("holdings-table");

    // Actions — drag holdings-table to portfolio-trend's position.
    // This moves holdings-table to index 0 in the rendered order.
    await appShell.actions.dragCard("holdings-table", "portfolio-trend");

    // Assert — wait for debounce to fire (≥300ms). Use a short wait via
    // expect.poll to avoid a fixed sleep while respecting the 250ms debounce.
    // Per `.claude/rules/e2e-aaa-guardrails.md`: probe-based waits.
    await expect
      .poll(
        async () => {
          const order = await getCardOrder(testUserCookieHeader);
          // After moving holdings-table before portfolio-trend, holdings-table
          // should appear at index 0 in the saved order.
          return order?.[0] === "holdings-table";
        },
        { timeout: 2000, intervals: [300, 500, 700] },
      )
      .toBe(true);

    // Assert — the full saved order reflects the drag.
    const savedOrder = await getCardOrder(testUserCookieHeader);
    await appShell.assert.mxAssertEqual(savedOrder !== null, true, "card order persisted after drag");
    await appShell.assert.mxAssertEqual(savedOrder?.[0], "holdings-table", "holdings-table is first after drag");

    // Assert — all cards are still visible (no cards lost from grid).
    for (const slug of CANONICAL_SLUGS) {
      await appShell.assert.cardIsVisible(slug);
    }
  });

  test("[card-B]: Display tab → Reset Layout button → cardOrder null → order reverts to canonical", async ({
    appShell,
    testUser,
    page,
  }) => {
    // Arrange — pre-seed a non-canonical order.
    // mintSessionCookie creates a valid API session only used for the seed call.
    const seedSession = await mintSessionCookie({
      sub: "card-reorder-B-sub",
      email: "card-reorder-B@example.com",
      name: "Card Reorder B",
    });
    await seedUserPreferences(seedSession.cookieHeader, testUser.userId, {
      cardOrder: {
        dashboard: [
          "holdings-table",
          "portfolio-trend",
          "allocation-snapshot",
          "return-percent",
          "dividends-section",
        ],
      },
    });

    // Actions — navigate to /dashboard (loads with seeded non-canonical order).
    await appShell.actions.navigateToRoute("/dashboard");

    // Extract testUser's browser session cookie for API read-back.
    const testUserCookieHeader = await getTestUserCookieHeader(page);

    // Assert — all cards visible.
    for (const slug of CANONICAL_SLUGS) {
      await appShell.assert.cardIsVisible(slug);
    }

    // Actions — open /settings/display (route-based; replaces former drawer
    // + tab-click pair per Phase 3d iter 2 D2(β)).
    await appShell.actions.openSettingsSection("display");

    // Assert — Reset all layouts button visible in the Layout section.
    await appShell.assert.displayLayoutSectionIsVisible();
    await appShell.assert.resetAllLayoutsButtonIsVisible();

    // Actions — click "Reset all layouts" (global atomic clear, KZO-162).
    await appShell.actions.clickResetAllLayoutsButton();

    // Assert — cardOrder is null/undefined after PATCH.
    await expect
      .poll(
        async () => {
          const order = await getCardOrder(testUserCookieHeader);
          return order === null;
        },
        { timeout: 3000, intervals: [300, 500, 700] },
      )
      .toBe(true);

    // Assert — the grid reverts to canonical order. Close the drawer first.
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.cardsAreInOrder([
      "portfolio-trend",
      "allocation-snapshot",
      "return-percent",
      "holdings-table",
      "dividends-section",
    ]);
  });

  // [card-C]: Optimistic rollback on PATCH failure.
  // Uses Playwright request interception to simulate a 500 response from
  // PATCH /user-preferences. After the drag and debounce window, the grid
  // should revert to the last server-confirmed order.
  //
  // This test is marked as optional in the design doc (§11) — if injecting a
  // PATCH failure is not feasible due to shared-server timing constraints,
  // the unit test in SortableCardGrid.test.tsx covers the rollback logic.
  test("[card-C]: optimistic rollback — PATCH 500 → render order reverts after debounce", async ({
    appShell,
    testUser,
    page,
  }) => {
    // Arrange — clear user prefs.
    const session = await mintSessionCookie({
      sub: "card-reorder-C-sub",
      email: "card-reorder-C@example.com",
      name: "Card Reorder C",
    });
    await seedUserPreferences(session.cookieHeader, testUser.userId, {});

    await appShell.actions.navigateToRoute("/dashboard");

    // Intercept PATCH /user-preferences to return 500.
    await page.route(apiPath("/user-preferences"), async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ status: 500, body: JSON.stringify({ error: "injected failure" }) });
      } else {
        await route.continue();
      }
    });

    // Record the initial render order before drag.
    const initialOrder = [...CANONICAL_SLUGS];

    // Actions — drag allocation-snapshot to holdings-table position.
    await appShell.actions.dragCard("allocation-snapshot", "holdings-table");

    // Wait for the debounce window + rollback to complete via probe polling.
    // After the 250ms debounce fires, PATCH returns 500 and the grid reverts to
    // the last server-confirmed (canonical) order. Poll until cardsAreInOrder
    // passes rather than using a fixed sleep (playwright/no-wait-for-timeout rule).
    await expect.poll(
      async () => {
        try {
          await appShell.assert.cardsAreInOrder([...CANONICAL_SLUGS]);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 3000, intervals: [300, 600] },
    ).toBe(true);

    // Unroute so subsequent navigations aren't affected.
    await page.unroute(apiPath("/user-preferences"));

    // Assert — render order reverted to canonical (pre-drag) order.
    await appShell.assert.cardsAreInOrder(initialOrder);

    // Assert — no persistent state change (cardOrder still null).
    const savedOrder = await getCardOrder(session.cookieHeader);
    await appShell.assert.mxAssertEqual(savedOrder, null, "cardOrder is null after rollback");
  });

  // KZO-162 — global "Reset all layouts" clears every page's cardOrder atomically.
  test("[card-D]: Display tab → Reset all layouts → cardOrder cleared for every page", async ({
    appShell,
    page,
  }) => {
    // The OAuth fixture pre-installs the session cookie on page.context()
    // before the test body runs, so we can read the cookie header without
    // navigating first. Seed via the BROWSER's cookie so the data lands on
    // the same user the browser will GET back (the fixture's
    // `e2e-ci-google-sub-001` resolved-user, NOT testUser.userId).
    const testUserCookieHeader = await getTestUserCookieHeader(page);

    // Arrange — seed a cardOrder for all three pages on the browser's user.
    await seedAsBrowser(page, {
      cardOrder: {
        dashboard: ["holdings-table", "portfolio-trend"],
        transactions: ["transactions-recent", "transactions-status"],
        portfolio: ["dividends-section", "holdings-table"],
      },
    });

    await appShell.actions.navigateToRoute("/dashboard");

    // Actions — open /settings/display → click "Reset all layouts"
    // (route-based per Phase 3d iter 2 D2(β); replaces former drawer + tab).
    await appShell.actions.openSettingsSection("display");
    await appShell.assert.displayLayoutSectionIsVisible();
    await appShell.assert.resetAllLayoutsButtonIsVisible();
    await appShell.actions.clickResetAllLayoutsButton();

    // Assert — cardOrder is null/absent (atomic global clear). State assertion
    // only; per-page primitive remount is covered by per-page specs.
    await expect
      .poll(
        async () => {
          const ctx = await apiRequest.newContext();
          try {
            const response = await ctx.get(apiPath("/user-preferences"), {
              headers: { cookie: testUserCookieHeader },
            });
            const body = await response.json() as {
              preferences: { cardOrder?: Record<string, unknown> };
            };
            const cardOrder = body.preferences.cardOrder;
            if (cardOrder === undefined || cardOrder === null) return true;
            return Object.keys(cardOrder).length === 0;
          } finally {
            await ctx.dispose();
          }
        },
        { timeout: 3000, intervals: [300, 500, 700] },
      )
      .toBe(true);
  });

  test("[card-A-fullwidth]: full-width cards span both columns at xl viewport", async ({
    appShell,
    testUser,
    page,
  }) => {
    // Arrange
    const session = await mintSessionCookie({
      sub: "card-reorder-fullwidth-sub",
      email: "card-reorder-fullwidth@example.com",
      name: "Card Reorder FullWidth",
    });
    await seedUserPreferences(session.cookieHeader, testUser.userId, {});

    await appShell.actions.navigateToRoute("/dashboard");

    // Assert — holdings-table and dividends-section are full-width (xl:col-span-2).
    await appShell.assert.cardIsFullWidth("holdings-table");
    await appShell.assert.cardIsFullWidth("dividends-section");

    // Assert — half-width cards do NOT span 2 columns.
    // (This is a negative check via the same helper — the span should NOT
    // include "span 2" for these cards.)
    const portfolioTrendSpan = await page.getByTestId("card-portfolio-trend").evaluate((el) => {
      return getComputedStyle(el).gridColumn;
    });
    // At xl, a half-width card should not have col-span-2.
    await appShell.assert.mxAssertEqual((/span\s*2/).test(portfolioTrendSpan), false, "portfolio-trend is NOT full-width");
  });
});
