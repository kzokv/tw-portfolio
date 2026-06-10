// KZO-159 (158A) — Route-level HTTP tests for user preferences.
//
// Integration-layer coverage lives at
// `apps/api/test/integration/user-preferences.integration.test.ts`
// and exercises persistence semantics directly via `PostgresPersistence`.
// This suite complements it with route-level behaviour that only surfaces
// through Fastify: Zod validation → 400, session-guard → 401,
// body-limit → 413, and the `{ ranges, source }` DTO shape from
// `GET /user-preferences/effective-ranges`.

import { request as apiRequest } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { DEFAULT_DASHBOARD_PERFORMANCE_RANGES } from "@vakwen/shared-types";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

type EffectiveRangesBody = {
  ranges: string[];
  source: "user" | "admin" | "default";
};

type PreferencesBody = {
  preferences: Record<string, unknown>;
};

test.describe("user preferences API (KZO-159)", () => {
  test("[user-prefs]: GET /user-preferences with no stored prefs → 200 { preferences: {} }", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-get-empty-sub",
      email: "user-prefs-get-empty@example.com",
      name: "Prefs Get Empty",
      role: "member",
    });

    const response = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(response, 200);
    const body = await response.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(body.preferences, {});
  });

  test("[user-prefs]: PATCH /user-preferences { dashboardPerformanceRanges } → 200 echoes and GET returns same", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-patch-roundtrip-sub",
      email: "user-prefs-patch-roundtrip@example.com",
      name: "Prefs Roundtrip",
      role: "member",
    });

    const patchResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardPerformanceRanges: ["1M", "YTD", "ALL"] },
    });
    await adminApi.assert.statusIs(patchResponse, 200);
    const patchBody = await patchResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(patchBody.preferences, {
      dashboardPerformanceRanges: ["1M", "YTD", "ALL"],
    });

    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(getResponse, 200);
    const getBody = await getResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(getBody.preferences, {
      dashboardPerformanceRanges: ["1M", "YTD", "ALL"],
    });
  });

  test("[user-prefs]: PATCH with null clears the key", async ({ request, adminApi }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-patch-null-sub",
      email: "user-prefs-patch-null@example.com",
      name: "Prefs Null",
      role: "member",
    });

    const seed = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardPerformanceRanges: ["3M", "1Y"] },
    });
    await adminApi.assert.statusIs(seed, 200);

    const clearResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardPerformanceRanges: null },
    });
    await adminApi.assert.statusIs(clearResponse, 200);
    const clearBody = await clearResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(clearBody.preferences, {});

    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    const getBody = await getResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(getBody.preferences, {});
  });

  test("[user-prefs]: PATCH /user-preferences { holdingAllocationBasis } → 200 echoes and GET returns same", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-holding-allocation-basis-sub",
      email: "user-prefs-holding-allocation-basis@example.com",
      name: "Prefs Holding Allocation Basis",
      role: "member",
    });

    const patchResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { holdingAllocationBasis: "cost_basis" },
    });
    await adminApi.assert.statusIs(patchResponse, 200);
    const patchBody = await patchResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(patchBody.preferences, {
      holdingAllocationBasis: "cost_basis",
    });

    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(getResponse, 200);
    const getBody = await getResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(getBody.preferences, {
      holdingAllocationBasis: "cost_basis",
    });
  });

  test("[user-prefs]: PATCH /user-preferences { dashboardHoldingFocus } → 200 echoes, GET returns same, null clears", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-dashboard-holding-focus-sub",
      email: "user-prefs-dashboard-holding-focus@example.com",
      name: "Prefs Dashboard Holding Focus",
      role: "member",
    });
    const dashboardHoldingFocus = {
      presetOrder: ["stale-quotes", "largest", "worst-pnl", "best-pnl", "fx-exposure"],
      hiddenPresets: ["worst-pnl"],
      selectedPreset: "stale-quotes",
    };

    const patchResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardHoldingFocus },
    });
    await adminApi.assert.statusIs(patchResponse, 200);
    const patchBody = await patchResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(patchBody.preferences, {
      dashboardHoldingFocus,
    });

    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(getResponse, 200);
    const getBody = await getResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(getBody.preferences, {
      dashboardHoldingFocus,
    });

    const clearResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardHoldingFocus: null },
    });
    await adminApi.assert.statusIs(clearResponse, 200);
    const clearBody = await clearResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(clearBody.preferences, {});
  });

  test("[user-prefs]: PATCH invalid dashboardHoldingFocus → 400 invalid_preference", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-dashboard-holding-focus-invalid-sub",
      email: "user-prefs-dashboard-holding-focus-invalid@example.com",
      name: "Prefs Dashboard Holding Focus Invalid",
      role: "member",
    });

    const duplicateResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: {
        dashboardHoldingFocus: {
          presetOrder: ["largest", "largest"],
          hiddenPresets: [],
          selectedPreset: "largest",
        },
      },
    });
    await adminApi.assert.statusIs(duplicateResponse, 400);
    await adminApi.assert.errorCodeIs(await duplicateResponse.json() as { error: string }, "invalid_preference");

    const hiddenSelectedResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: {
        dashboardHoldingFocus: {
          presetOrder: ["largest", "worst-pnl"],
          hiddenPresets: ["largest"],
          selectedPreset: "largest",
        },
      },
    });
    await adminApi.assert.statusIs(hiddenSelectedResponse, 400);
    await adminApi.assert.errorCodeIs(await hiddenSelectedResponse.json() as { error: string }, "invalid_preference");
  });

  test("[user-prefs]: PATCH /user-preferences { holdingsTableSettings } → 200 echoes, GET returns same", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-holdings-table-settings-sub",
      email: "user-prefs-holdings-table-settings@example.com",
      name: "Prefs Holdings Table Settings",
      role: "member",
    });
    const holdingsTableSettings = {
      version: 1,
      contexts: {
        "dashboard.topHoldings": {
          columnOrder: ["pnl", "ticker", "marketValue"],
          hiddenColumns: ["health"],
          columnWidths: { pnl: 222, marketValue: 180 },
          layoutStyle: "dashboard",
        },
        "portfolio.holdings": {
          columnOrder: ["marketValue", "pnl", "allocation"],
          hiddenColumns: [],
          columnWidths: { allocation: 148 },
          layoutStyle: "portfolio",
        },
      },
    };

    const patchResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { holdingsTableSettings },
    });
    await adminApi.assert.statusIs(patchResponse, 200);
    const patchBody = await patchResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(patchBody.preferences, {
      holdingsTableSettings,
    });

    const getResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(getResponse, 200);
    const getBody = await getResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertDeepEqual(getBody.preferences, {
      holdingsTableSettings,
    });
  });

  test("[user-prefs]: GET /user-preferences/effective-ranges → source=default when no user pref, no admin override", async ({
    request,
    adminApi,
  }) => {
    // Reset admin override to null so this test does not see a left-over
    // admin list from a prior test in the shared-server suite.
    const admin = await createOauthSession(request, {
      sub: "user-prefs-effective-default-admin-sub",
      email: "user-prefs-effective-default-admin@example.com",
      name: "Effective Default Admin",
      role: "admin",
    });
    const resetResponse = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { dashboardPerformanceRanges: null },
    );
    await adminApi.assert.statusIs(resetResponse, 200);

    const session = await createOauthSession(request, {
      sub: "user-prefs-effective-default-sub",
      email: "user-prefs-effective-default@example.com",
      name: "Effective Default",
      role: "member",
    });
    const response = await request.get(apiPath("/user-preferences/effective-ranges"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(response, 200);
    const body = await response.json() as EffectiveRangesBody;
    await adminApi.assert.mxAssertEqual(body.source, "default", "effective-ranges source");
    await adminApi.assert.mxAssertDeepEqual(body.ranges, [
      ...DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
    ]);
  });

  test("[user-prefs]: effective-ranges source=admin when admin override set and user has no pref", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "user-prefs-effective-admin-admin-sub",
      email: "user-prefs-effective-admin-admin@example.com",
      name: "Effective Admin Admin",
      role: "admin",
    });
    const adminList = ["1M", "3M", "1Y"];
    const setAdminResponse = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { dashboardPerformanceRanges: adminList },
    );
    await adminApi.assert.statusIs(setAdminResponse, 200);

    try {
      const session = await createOauthSession(request, {
        sub: "user-prefs-effective-admin-user-sub",
        email: "user-prefs-effective-admin-user@example.com",
        name: "Effective Admin User",
        role: "member",
      });
      const response = await request.get(apiPath("/user-preferences/effective-ranges"), {
        headers: { cookie: session.cookieHeader },
      });
      await adminApi.assert.statusIs(response, 200);
      const body = await response.json() as EffectiveRangesBody;
      await adminApi.assert.mxAssertEqual(body.source, "admin", "effective-ranges source");
      await adminApi.assert.mxAssertDeepEqual(body.ranges, adminList);
    } finally {
      // Restore admin override to null for other tests in the shared server.
      const reset = await adminApi.actions.patchAdminSettingsForCookie(
        admin.cookieHeader,
        { dashboardPerformanceRanges: null },
      );
      await adminApi.assert.statusIs(reset, 200);
    }
  });

  test("[user-prefs]: effective-ranges source=user, pruned against admin-allowed set", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "user-prefs-effective-user-admin-sub",
      email: "user-prefs-effective-user-admin@example.com",
      name: "Effective User Admin",
      role: "admin",
    });
    const adminList = ["1M", "3M", "1Y", "YTD"];
    const setAdminResponse = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { dashboardPerformanceRanges: adminList },
    );
    await adminApi.assert.statusIs(setAdminResponse, 200);

    try {
      const session = await createOauthSession(request, {
        sub: "user-prefs-effective-user-user-sub",
        email: "user-prefs-effective-user-user@example.com",
        name: "Effective User User",
        role: "member",
      });
      // Include a range not in the admin list ("ALL") — resolver must prune it.
      const seedPref = await request.patch(apiPath("/user-preferences"), {
        headers: { cookie: session.cookieHeader },
        data: { dashboardPerformanceRanges: ["YTD", "1M", "ALL"] },
      });
      await adminApi.assert.statusIs(seedPref, 200);

      const response = await request.get(apiPath("/user-preferences/effective-ranges"), {
        headers: { cookie: session.cookieHeader },
      });
      await adminApi.assert.statusIs(response, 200);
      const body = await response.json() as EffectiveRangesBody;
      await adminApi.assert.mxAssertEqual(body.source, "user", "effective-ranges source");
      // "ALL" pruned away; order preserved for admin-allowed entries.
      await adminApi.assert.mxAssertDeepEqual(body.ranges, ["YTD", "1M"]);
    } finally {
      const reset = await adminApi.actions.patchAdminSettingsForCookie(
        admin.cookieHeader,
        { dashboardPerformanceRanges: null },
      );
      await adminApi.assert.statusIs(reset, 200);
    }
  });

  // --- 400 — Zod validation (invalid_range_list) ------------------------------

  test("[user-prefs]: PATCH with empty array → 400 invalid_range_list (ranges_list_too_short)", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-patch-empty-sub",
      email: "user-prefs-patch-empty@example.com",
      name: "Prefs Empty",
      role: "member",
    });

    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardPerformanceRanges: [] },
    });
    await adminApi.assert.statusIs(response, 400);
    const body = await response.json() as { error: string; message?: string };
    await adminApi.assert.errorCodeIs(body, "invalid_range_list");
  });

  test("[user-prefs]: PATCH with >12 items → 400 invalid_range_list", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-patch-overmax-sub",
      email: "user-prefs-patch-overmax@example.com",
      name: "Prefs Overmax",
      role: "member",
    });

    // 13 distinct valid entries — grammar-valid but list length exceeds max(12).
    const tooMany = [
      "1M", "2M", "3M", "4M", "5M", "6M", "7M", "8M", "9M", "10M", "11M", "12M", "YTD",
    ];
    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardPerformanceRanges: tooMany },
    });
    await adminApi.assert.statusIs(response, 400);
    const body = await response.json() as { error: string };
    await adminApi.assert.errorCodeIs(body, "invalid_range_list");
  });

  test("[user-prefs]: PATCH with duplicate entries → 400 invalid_range_list", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-patch-dup-sub",
      email: "user-prefs-patch-dup@example.com",
      name: "Prefs Dup",
      role: "member",
    });

    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardPerformanceRanges: ["1M", "YTD", "1M"] },
    });
    await adminApi.assert.statusIs(response, 400);
    const body = await response.json() as { error: string };
    await adminApi.assert.errorCodeIs(body, "invalid_range_list");
  });

  test("[user-prefs]: PATCH with invalid element (lowercase 'ytd') → 400 invalid_range_list", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-patch-lowercase-sub",
      email: "user-prefs-patch-lowercase@example.com",
      name: "Prefs Lowercase",
      role: "member",
    });

    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardPerformanceRanges: ["1M", "ytd"] },
    });
    await adminApi.assert.statusIs(response, 400);
    const body = await response.json() as { error: string };
    await adminApi.assert.errorCodeIs(body, "invalid_range_list");
  });

  test("[user-prefs]: PATCH with over-bound 241M → 400 invalid_range_list", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-patch-overM-sub",
      email: "user-prefs-patch-overM@example.com",
      name: "Prefs OverM",
      role: "member",
    });

    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { dashboardPerformanceRanges: ["241M"] },
    });
    await adminApi.assert.statusIs(response, 400);
    const body = await response.json() as { error: string };
    await adminApi.assert.errorCodeIs(body, "invalid_range_list");
  });

  test("[user-prefs]: PATCH with unknown top-level key → 400 invalid_preference (strict schema)", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-patch-unknown-sub",
      email: "user-prefs-patch-unknown@example.com",
      name: "Prefs Unknown",
      role: "member",
    });

    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { unknownKey: "whatever" },
    });
    await adminApi.assert.statusIs(response, 400);
    const body = await response.json() as { error: string };
    await adminApi.assert.errorCodeIs(body, "invalid_preference");
  });

  // --- 401 — no session cookie ------------------------------------------------
  //
  // The test-scoped `request` fixture from `createApiSessionTest("oauth")`
  // carries a seeded session cookie. To hit the unauthenticated path we must
  // create a fresh `APIRequestContext` with an empty cookie jar — same pattern
  // as `withFreshContext` in the sharing helpers
  // (`.claude/rules/playwright-request-cookie-jar-isolation.md`).

  test("[user-prefs]: GET /user-preferences without session → 401 auth_required", async ({
    adminApi,
  }) => {
    const ctx = await apiRequest.newContext();
    try {
      const response = await ctx.get(apiPath("/user-preferences"));
      await adminApi.assert.statusIs(response, 401);
      const body = await response.json() as { error: string };
      await adminApi.assert.errorCodeIs(body, "auth_required");
    } finally {
      await ctx.dispose();
    }
  });

  test("[user-prefs]: PATCH /user-preferences without session → 401 auth_required", async ({
    adminApi,
  }) => {
    const ctx = await apiRequest.newContext();
    try {
      const response = await ctx.patch(apiPath("/user-preferences"), {
        data: { dashboardPerformanceRanges: ["1M"] },
      });
      await adminApi.assert.statusIs(response, 401);
      const body = await response.json() as { error: string };
      await adminApi.assert.errorCodeIs(body, "auth_required");
    } finally {
      await ctx.dispose();
    }
  });

  test("[user-prefs]: GET /user-preferences/effective-ranges without session → 401 auth_required", async ({
    adminApi,
  }) => {
    const ctx = await apiRequest.newContext();
    try {
      const response = await ctx.get(apiPath("/user-preferences/effective-ranges"));
      await adminApi.assert.statusIs(response, 401);
      const body = await response.json() as { error: string };
      await adminApi.assert.errorCodeIs(body, "auth_required");
    } finally {
      await ctx.dispose();
    }
  });

  // --- 413 — body-limit (Fastify-level rejection) -----------------------------

  test("[user-prefs]: PATCH oversize body (>8192 bytes) → 413", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "user-prefs-patch-oversize-sub",
      email: "user-prefs-patch-oversize@example.com",
      name: "Prefs Oversize",
      role: "member",
    });

    // Construct a payload well above 8192 bytes. Route body-limit rejects at
    // parse time (Fastify's own FST_ERR_CTP_BODY_TOO_LARGE → 413); the payload
    // contents need not validate against the Zod schema because parsing fails
    // first.
    const big = "x".repeat(9000);
    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { filler: big },
    });
    await adminApi.assert.statusIs(response, 413);
  });
});
