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

import { TestEnv } from "@tw-portfolio/config/test";
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

    // cardOrderSchema is strict — extra keys should be rejected.
    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: {
        cardOrder: {
          dashboard: ["portfolio-trend"],
          portfolio: ["some-card"],  // extra key — not in strict schema
        },
      },
    });
    // Strict schema rejects unknown keys with 400.
    await adminApi.assert.statusIs(response, 400);
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
