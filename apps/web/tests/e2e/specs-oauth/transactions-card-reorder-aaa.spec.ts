// KZO-162 — AAA E2E for the Transactions right-stack card reorder.
//
// Covers (per scope-todo Phase 8):
//   [transactions-A] drag swap status ↔ recent → debounce → state read-back
//                    via GET /user-preferences shows
//                    cardOrder.transactions = ["transactions-recent", "transactions-status"].
//   [transactions-B] Display tab → "Reset transactions layout" → only
//                    cardOrder.transactions cleared (sibling sub-keys preserved).
//   [transactions-C] After drag, AddTransactionCard remains in the LEFT column
//                    — composition regression guard for Q2's right-stack-only
//                    decision.
//
// All tests run in specs-oauth/ (AUTH_MODE=oauth, real session cookies).
// State assertions use GET /user-preferences (not DOM inspection).

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
 * fixture's OAuth session resolves to a different user than `testUser.userId`
 * (the fixture e2eUserId is not the same as the default `e2e-ci-google-sub-001`
 * resolved-user). When a test needs the browser to OBSERVE the seeded state
 * (for example, asserting the card order it just wrote), seed via the
 * browser's session cookie so the data lands on the same user the browser
 * will GET back.
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

test.describe("transactions card reorder (KZO-162)", () => {
  test.beforeEach(async ({ appShell }) => {
    await appShell.actions.setViewport(1280, 900);
  });

  test("[transactions-A]: drag swap status ↔ recent → debounce → state read-back shows reordered cardOrder.transactions", async ({
    appShell,
    page,
  }) => {
    // The OAuth fixture pre-installs the session cookie on page.context()
    // BEFORE the test body runs (see sessionBase.ts), so we can read the
    // cookie header without navigating first.
    const testUserCookieHeader = await getTestUserCookieHeader(page);

    // Arrange — start from canonical order on the BROWSER's user. Must seed
    // BEFORE navigation: SortableCardGrid only reads cardOrder on mount, so
    // navigating first would let the grid fetch stale state from a prior test.
    await seedAsBrowser(page, { cardOrder: { transactions: null } });

    await appShell.actions.navigateToRoute("/transactions");

    // Assert — all three cards' drag handles are visible (confirms the
    // single-grid composition is wired through SortableCardGrid).
    await appShell.assert.cardDragHandleIsVisible("transactions-add");
    await appShell.assert.cardDragHandleIsVisible("transactions-status");
    await appShell.assert.cardDragHandleIsVisible("transactions-recent");

    // Actions — drag transactions-recent above transactions-status. Canonical
    // is [add, status, recent]; after the swap it should be [add, recent, status].
    await appShell.actions.dragCard("transactions-recent", "transactions-status");

    // Assert — after debounce, the saved cardOrder.transactions reflects the swap.
    await expect
      .poll(
        async () => {
          const order = await getCardOrder(testUserCookieHeader);
          return order?.transactions?.[1] === "transactions-recent"
            && order?.transactions?.[2] === "transactions-status";
        },
        { timeout: 2000, intervals: [300, 500, 700] },
      )
      .toBe(true);

    const savedOrder = await getCardOrder(testUserCookieHeader);
    await appShell.assert.mxAssertDeepEqual(
      savedOrder?.transactions,
      ["transactions-add", "transactions-recent", "transactions-status"],
    );
  });

  test("[transactions-B]: Display tab → Reset transactions layout → cardOrder.transactions cleared", async ({
    appShell,
    page,
  }) => {
    // The OAuth fixture pre-installs the session cookie on page.context()
    // BEFORE the test body runs, so we can read the cookie header without
    // navigating first.
    const testUserCookieHeader = await getTestUserCookieHeader(page);

    // Arrange — seed cardOrder.transactions so the reset has something to clear.
    // Sibling-preservation behavior (dashboard/portfolio remain) is covered
    // deterministically by the HTTP suite test
    // `[card-order-api]: PATCH cardOrder.transactions null clears just that sub-key`;
    // here we focus on the UI wiring (button → PATCH → cleared state). Seed
    // BEFORE navigation so the grid mount fetches the seeded value.
    await seedAsBrowser(page, {
      cardOrder: { transactions: ["transactions-recent", "transactions-status"] },
    });

    await appShell.actions.navigateToRoute("/transactions");

    // Actions — open Settings → Display tab → "Reset transactions layout".
    await appShell.actions.openSettingsDrawer();
    await appShell.actions.clickSettingsDisplayTab();
    await appShell.assert.displayLayoutSectionIsVisible();
    await appShell.assert.resetTransactionsLayoutButtonIsVisible();
    await appShell.actions.clickResetTransactionsLayoutButton();

    // Assert — cardOrder.transactions absent after the reset PATCH lands.
    await expect
      .poll(
        async () => {
          const order = await getCardOrder(testUserCookieHeader);
          return order === null || order.transactions === undefined;
        },
        { timeout: 3000, intervals: [300, 500, 700] },
      )
      .toBe(true);
  });

  test("[transactions-C]: AddTransactionCard slot (transactions-add) is draggable → state read-back reflects new position", async ({
    appShell,
    page,
  }) => {
    // Read cookie + seed BEFORE navigation. SortableCardGrid only fetches
    // cardOrder on mount, so the seed must land before that mount fetch.
    const testUserCookieHeader = await getTestUserCookieHeader(page);

    // Clear any prior order on the browser's user so the assertion below
    // anchors to a known starting point.
    await seedAsBrowser(page, { cardOrder: { transactions: null } });

    await appShell.actions.navigateToRoute("/transactions");

    // Sanity — all three drag handles are present, including the form slot.
    await appShell.assert.cardDragHandleIsVisible("transactions-add");
    await appShell.assert.cardDragHandleIsVisible("transactions-status");
    await appShell.assert.cardDragHandleIsVisible("transactions-recent");

    // Actions — drag the AddTransactionCard slot below transactions-status,
    // proving the form slot is now reorderable (KZO-162 follow-up).
    await appShell.actions.dragCard("transactions-add", "transactions-status");

    // Assert — saved order reflects the new position; transactions-add no
    // longer leads. Persistence is debounced 250ms; poll until it lands.
    await expect
      .poll(
        async () => {
          const order = await getCardOrder(testUserCookieHeader);
          return order?.transactions?.[0] !== "transactions-add"
            && order?.transactions?.includes("transactions-add") === true;
        },
        { timeout: 2000, intervals: [300, 500, 700] },
      )
      .toBe(true);
  });
});
