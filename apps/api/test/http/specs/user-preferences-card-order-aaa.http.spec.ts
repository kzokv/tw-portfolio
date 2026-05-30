// KZO-161 (158C) — Route-level HTTP tests for cardOrder in user preferences.
//
// Covers the `cardOrder` key extension to `userPreferencePatchSchema`:
//   PATCH with valid cardOrder → 200, GET echoes value
//   PATCH with cardOrder null → 200, key cleared from preferences
//   PATCH with both dashboardPerformanceRanges + cardOrder → 200, both applied atomically
//   PATCH with invalid cardOrder shape (not object) → 400
//   PATCH with cardOrder.dashboard > 50 items → 400
//   PATCH with cardOrder.dashboard containing empty-string slug → 400
//   PATCH with unknown key in cardOrder (extra key) → 400 (strict schema)
//
// Lives in the suite 8 (API HTTP tests) alongside user-preferences-aaa.http.spec.ts.
// Uses the same `createOauthSession` helper from `./helpers/sharing.ts`.

import { TestEnv } from "@vakwen/config/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

type PreferencesBody = {
  preferences: Record<string, unknown>;
};

test.describe("user-preferences cardOrder (KZO-161)", () => {
  test("[card-order-api]: PATCH valid cardOrder → 200, GET echoes same value", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-patch-roundtrip-sub",
      email: "card-order-patch-roundtrip@example.com",
      name: "Card Order Roundtrip",
      role: "member",
    });

    const cardOrder = {
      dashboard: [
        "holdings-table",
        "portfolio-trend",
        "allocation-snapshot",
        "return-percent",
        "dividends-section",
      ],
    };

    // PATCH with valid cardOrder.
    const patchResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { cardOrder },
    });
    await adminApi.assert.statusIs(patchResponse, 200);
    const patchBody = await patchResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(patchBody.preferences.cardOrder, cardOrder);

    // GET echoes the same value.
    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(getResponse, 200);
    const getBody = await getResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(getBody.preferences.cardOrder, cardOrder);
  });

  test("[card-order-api]: PATCH cardOrder null → 200, key cleared from preferences", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-patch-null-sub",
      email: "card-order-patch-null@example.com",
      name: "Card Order Null",
      role: "member",
    });

    // Seed a cardOrder first.
    const seedResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { cardOrder: { dashboard: ["portfolio-trend", "holdings-table"] } },
    });
    await adminApi.assert.statusIs(seedResponse, 200);

    // Clear with null.
    const clearResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { cardOrder: null },
    });
    await adminApi.assert.statusIs(clearResponse, 200);
    const clearBody = await clearResponse.json() as PreferencesBody;
    // cardOrder key should be absent from preferences after null PATCH.
    await adminApi.assert.mxAssertEqual(
      (clearBody.preferences as Record<string, unknown>).cardOrder,
      undefined,
      "cardOrder absent after null PATCH",
    );

    // Confirm via GET.
    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(getResponse, 200);
    const getBody = await getResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertEqual(
      (getBody.preferences as Record<string, unknown>).cardOrder,
      undefined,
      "GET after null PATCH: cardOrder absent",
    );
  });

  test("[card-order-api]: PATCH both dashboardPerformanceRanges + cardOrder → 200, both applied atomically", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-patch-atomic-sub",
      email: "card-order-patch-atomic@example.com",
      name: "Card Order Atomic",
      role: "member",
    });

    const patchResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: {
        dashboardPerformanceRanges: ["1M", "YTD", "ALL"],
        cardOrder: { dashboard: ["holdings-table", "portfolio-trend"] },
      },
    });
    await adminApi.assert.statusIs(patchResponse, 200);
    const body = await patchResponse.json() as PreferencesBody;

    // Both keys applied in a single PATCH.
    await adminApi.assert.mxAssertDeepEqual(
      body.preferences.dashboardPerformanceRanges,
      ["1M", "YTD", "ALL"],
    );
    await adminApi.assert.mxAssertDeepEqual(
      (body.preferences as Record<string, unknown>).cardOrder,
      { dashboard: ["holdings-table", "portfolio-trend"] },
    );
  });

  test("[card-order-api]: PATCH cardOrder with non-object value → 400", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-invalid-shape-sub",
      email: "card-order-invalid-shape@example.com",
      name: "Card Order Invalid Shape",
      role: "member",
    });

    // cardOrder must be an object { dashboard: string[] }, not a plain array.
    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { cardOrder: ["portfolio-trend", "holdings-table"] },
    });
    await adminApi.assert.statusIs(response, 400);
  });

  test("[card-order-api]: PATCH cardOrder.dashboard with > 50 items → 400", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-too-many-sub",
      email: "card-order-too-many@example.com",
      name: "Card Order Too Many",
      role: "member",
    });

    // Generate 51 slug strings (max is 50).
    const tooMany = Array.from({ length: 51 }, (_, i) => `card-${i}`);

    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { cardOrder: { dashboard: tooMany } },
    });
    await adminApi.assert.statusIs(response, 400);
  });

  test("[card-order-api]: PATCH cardOrder.dashboard with empty-string slug → 400", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-empty-slug-sub",
      email: "card-order-empty-slug@example.com",
      name: "Card Order Empty Slug",
      role: "member",
    });

    // Each slug must be min length 1.
    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { cardOrder: { dashboard: ["portfolio-trend", ""] } },
    });
    await adminApi.assert.statusIs(response, 400);
  });

  test("[card-order-api]: PATCH cardOrder with extra key (strict schema) → 400", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-extra-key-sub",
      email: "card-order-extra-key@example.com",
      name: "Card Order Extra Key",
      role: "member",
    });

    // cardOrderSchema is strict — only the durably scoped page keys
    // (dashboard / transactions / portfolio per KZO-162) are permitted. The
    // /cash-ledger surface is durably out of scope per scope-todo Q1, so it
    // must remain a rejected example to guard against accidental schema drift.
    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: {
        cardOrder: {
          dashboard: ["portfolio-trend"],
          "cash-ledger": ["some-card"],  // out-of-scope — must reject
        },
      },
    });
    // Strict schema rejects unknown keys with 400.
    await adminApi.assert.statusIs(response, 400);
  });

  // KZO-162 — page-level acceptance + per-key clear semantics.
  test("[card-order-api]: PATCH cardOrder.transactions valid round-trip → 200", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-transactions-sub",
      email: "card-order-transactions@example.com",
      name: "Card Order Transactions",
      role: "member",
    });

    const cardOrder = {
      transactions: ["transactions-recent", "transactions-status"],
    };

    const patchResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { cardOrder },
    });
    await adminApi.assert.statusIs(patchResponse, 200);

    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(getResponse, 200);
    const getBody = await getResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(getBody.preferences.cardOrder, cardOrder);
  });

  test("[card-order-api]: PATCH cardOrder.portfolio valid round-trip → 200", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-portfolio-sub",
      email: "card-order-portfolio@example.com",
      name: "Card Order Portfolio",
      role: "member",
    });

    const cardOrder = {
      portfolio: ["dividends-section", "holdings-table"],
    };

    const patchResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { cardOrder },
    });
    await adminApi.assert.statusIs(patchResponse, 200);

    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(getResponse, 200);
    const getBody = await getResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(getBody.preferences.cardOrder, cardOrder);
  });

  for (const key of ["dashboard", "transactions", "portfolio"] as const) {
    test(`[card-order-api]: PATCH cardOrder.${key} null clears just that sub-key → 200, GET shows ${key} absent`, async ({
      request,
      adminApi,
    }) => {
      const session = await createOauthSession(request, {
        sub: `card-order-${key}-clear-sub`,
        email: `card-order-${key}-clear@example.com`,
        name: `Card Order ${key} Clear`,
        role: "member",
      });

      // Seed all three sub-keys so the assertion is meaningful — we expect
      // siblings to remain after the targeted clear.
      const seedResponse = await request.patch(apiPath("/user-preferences"), {
        headers: { cookie: session.cookieHeader },
        data: {
          cardOrder: {
            dashboard: ["portfolio-trend", "holdings-table"],
            transactions: ["transactions-status", "transactions-recent"],
            portfolio: ["holdings-table", "dividends-section"],
          },
        },
      });
      await adminApi.assert.statusIs(seedResponse, 200);

      // Clear just the targeted sub-key.
      const clearResponse = await request.patch(apiPath("/user-preferences"), {
        headers: { cookie: session.cookieHeader },
        data: { cardOrder: { [key]: null } },
      });
      await adminApi.assert.statusIs(clearResponse, 200);

      const getResponse = await request.get(apiPath("/user-preferences"), {
        headers: { cookie: session.cookieHeader },
      });
      await adminApi.assert.statusIs(getResponse, 200);
      const getBody = await getResponse.json() as PreferencesBody;
      const cardOrderAfter = (getBody.preferences as Record<string, unknown>).cardOrder as
        | Record<string, unknown>
        | undefined;

      await adminApi.assert.mxAssertEqual(
        cardOrderAfter !== undefined,
        true,
        "cardOrder still present after sub-key clear",
      );
      // The cleared key must be ABSENT (not stored as null) — round-trip
      // regression guard against null-storage drift.
      await adminApi.assert.mxAssertEqual(
        cardOrderAfter !== undefined && key in cardOrderAfter,
        false,
        `cardOrder.${key} absent after null PATCH`,
      );
      // Sibling sub-keys remain intact.
      for (const sibling of ["dashboard", "transactions", "portfolio"] as const) {
        if (sibling === key) continue;
        await adminApi.assert.mxAssertEqual(
          cardOrderAfter !== undefined && sibling in cardOrderAfter,
          true,
          `sibling cardOrder.${sibling} preserved`,
        );
      }
    });
  }

  test("[card-order-api]: mixed-op PATCH (dashboard set, transactions null) → 200, GET reflects both ops", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-mixed-op-sub",
      email: "card-order-mixed-op@example.com",
      name: "Card Order Mixed Op",
      role: "member",
    });

    // Seed transactions so the null clear has a target to remove.
    const seedResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: {
        cardOrder: {
          transactions: ["transactions-status", "transactions-recent"],
        },
      },
    });
    await adminApi.assert.statusIs(seedResponse, 200);

    const mixedResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: {
        cardOrder: { dashboard: ["a"], transactions: null },
      },
    });
    await adminApi.assert.statusIs(mixedResponse, 200);

    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(getResponse, 200);
    const getBody = await getResponse.json() as PreferencesBody;
    const cardOrderAfter = (getBody.preferences as Record<string, unknown>).cardOrder as
      | Record<string, unknown>
      | undefined;

    await adminApi.assert.mxAssertDeepEqual(cardOrderAfter?.dashboard, ["a"]);
    await adminApi.assert.mxAssertEqual(
      cardOrderAfter !== undefined && "transactions" in cardOrderAfter,
      false,
      "transactions absent after mixed null clear",
    );
  });

  test("[card-order-api]: PATCH unknown top-level key (strict outer schema) → 400", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "card-order-unknown-top-sub",
      email: "card-order-unknown-top@example.com",
      name: "Card Order Unknown Top",
      role: "member",
    });

    // The outer userPreferencePatchSchema is strict — unknown top-level keys rejected.
    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: {
        cardOrder: { dashboard: ["portfolio-trend"] },
        unknownField: "should-be-rejected",
      },
    });
    await adminApi.assert.statusIs(response, 400);
  });
});
