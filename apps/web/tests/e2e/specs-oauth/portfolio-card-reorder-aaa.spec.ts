// KZO-162 — AAA E2E for the Portfolio section card reorder.
//
// Covers (per scope-todo Phase 8):
//   [portfolio-A] drag swap holdings ↔ dividends → debounce → state read-back
//                 via cardOrder.portfolio.
//   [portfolio-B] Display tab → "Reset portfolio layout" → only
//                 cardOrder.portfolio cleared (sibling sub-keys preserved).
//
// Slugs reused from DASHBOARD_CARDS — different `cardOrder.{key}` namespace,
// no collision with dashboard reorder state.

import {
  request as apiRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { test, expect } from "@vakwen/test-e2e/fixtures/oauthPages";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

// ── Context-isolated helpers ──────────────────────────────────────────────────

async function withFreshContext<T>(fn: (ctx: APIRequestContext) => Promise<T>): Promise<T> {
  const ctx = await apiRequest.newContext();
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

/**
 * Seed preferences for the BROWSER's currently-authenticated user. The
 * fixture's OAuth session resolves to a different user than `testUser.userId`,
 * so when a test needs the browser to OBSERVE the seeded state, seed via the
 * browser's cookie instead of `testUser.userId`.
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

interface CardOrderShape {
  dashboard?: string[];
  transactions?: string[];
  portfolio?: string[];
}

async function getCardOrder(cookieHeader: string): Promise<CardOrderShape | null> {
  return withFreshContext(async (ctx) => {
    const response = await ctx.get(apiPath("/user-preferences"), {
      headers: { cookie: cookieHeader },
    });
    if (!response.ok()) throw new Error(`GET /user-preferences failed: ${response.status()}`);
    const body = await response.json() as {
      preferences: { cardOrder?: CardOrderShape };
    };
    return body.preferences.cardOrder ?? null;
  });
}

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

test.describe("portfolio card reorder (KZO-162)", () => {
  test.beforeEach(async ({ appShell }) => {
    await appShell.actions.setViewport(1280, 900);
  });

  test("[portfolio-A]: drag swap holdings ↔ dividends → debounce → state read-back shows reversed cardOrder.portfolio", async ({
    appShell,
    page,
  }) => {
    // The OAuth fixture pre-installs the session cookie on page.context()
    // before the test body runs, so we can read the cookie header without
    // navigating first.
    const testUserCookieHeader = await getTestUserCookieHeader(page);

    // Arrange — start from canonical order on the BROWSER's user. Must seed
    // BEFORE navigation: SortableCardGrid only reads cardOrder on mount, so
    // navigating first would let the grid fetch stale state from a prior test.
    await seedAsBrowser(page, { cardOrder: { portfolio: null } });

    await appShell.actions.navigateToRoute("/portfolio");

    await appShell.assert.cardDragHandleIsVisible("holdings-table");
    await appShell.assert.cardDragHandleIsVisible("dividends-section");

    // Actions — drag dividends-section above holdings-table.
    await appShell.actions.dragCard("dividends-section", "holdings-table");

    // Assert — after debounce, cardOrder.portfolio reflects the swap.
    await expect
      .poll(
        async () => {
          const order = await getCardOrder(testUserCookieHeader);
          return order?.portfolio?.[0] === "dividends-section";
        },
        { timeout: 2000, intervals: [300, 500, 700] },
      )
      .toBe(true);

    const savedOrder = await getCardOrder(testUserCookieHeader);
    await appShell.assert.mxAssertDeepEqual(
      savedOrder?.portfolio,
      ["dividends-section", "holdings-table"],
    );
  });

  test("[portfolio-B]: Display tab → Reset portfolio layout → cardOrder.portfolio cleared", async ({
    appShell,
    page,
  }) => {
    // The OAuth fixture pre-installs the session cookie on page.context()
    // before the test body runs.
    const testUserCookieHeader = await getTestUserCookieHeader(page);

    // Arrange — seed cardOrder.portfolio so the reset has something to clear.
    // Sibling-preservation behavior (dashboard/transactions remain) is covered
    // deterministically by the HTTP suite test
    // `[card-order-api]: PATCH cardOrder.portfolio null clears just that sub-key`;
    // here we focus on the UI wiring (button → PATCH → cleared state). Seed
    // BEFORE navigation so the grid mount fetches the seeded value.
    await seedAsBrowser(page, {
      cardOrder: { portfolio: ["dividends-section", "holdings-table"] },
    });

    await appShell.actions.navigateToRoute("/portfolio");

    await appShell.actions.openSettingsDrawer();
    await appShell.actions.clickSettingsDisplayTab();
    await appShell.assert.displayLayoutSectionIsVisible();
    await appShell.assert.resetPortfolioLayoutButtonIsVisible();
    await appShell.actions.clickResetPortfolioLayoutButton();

    // Assert — cardOrder.portfolio absent after the reset PATCH lands.
    await expect
      .poll(
        async () => {
          const order = await getCardOrder(testUserCookieHeader);
          return order === null || order.portfolio === undefined;
        },
        { timeout: 3000, intervals: [300, 500, 700] },
      )
      .toBe(true);
  });
});
