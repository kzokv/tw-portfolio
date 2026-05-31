/**
 * HTTP/AAA tests for GET /admin/fx-rates/freshness (KZO-164).
 *
 * NOTE: This spec imports FxRatesEndpoint and TFxRatesApiAssistant from the AAA infra
 * written by the Implementer (libs/test-api slices 16). It will fail to compile until
 * that code lands — expected and correct for Tier 2 parallel Phase 1+2.
 *
 * Coverage:
 *  - Admin auth gates non-admin requests (403 admin_role_required)
 *  - Response shape: { pairs: [...], queriedAt }
 *  - pairs ordered by (baseCurrency, quoteCurrency) ASC
 *  - ageInDays correctly calculated against seeded data (uses /__e2e/seed-fx-rates)
 *  - Empty table returns { pairs: [], queriedAt }
 */
import { createApiFixture } from "@vakwen/test-api/config";
// TDD-red: FxRatesEndpoint and TFxRatesApiAssistant don't exist until Implementer lands slice 16
import { FxRatesEndpoint } from "@vakwen/test-api/endpoints";
import type { TFxRatesApiAssistant } from "@vakwen/test-api/assistants";
import { test as base } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

// ── Local fixture extension ───────────────────────────────────────────────────

const test = base.extend<{ fxRatesApi: TFxRatesApiAssistant }>({
  fxRatesApi: createApiFixture<TFxRatesApiAssistant>(FxRatesEndpoint),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a date string N days before today (UTC). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("GET /admin/fx-rates/freshness", () => {

  // Reset shared in-memory FX state between tests so the empty-DB shape test
  // and ordering assertions are not polluted by prior seeds. The HTTP suite
  // runs with workers=1 and a single shared memory backend.
  test.beforeEach(async ({ fxRatesApi }) => {
    const response = await fxRatesApi.actions.resetFxRates();
    await fxRatesApi.assert.statusIs(response, 200);
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  test("[auth]: non-admin member gets 403 admin_role_required", async ({
    request,
    fxRatesApi,
    adminApi,
  }) => {
    const member = await createOauthSession(request, {
      sub: "fx-freshness-member-sub",
      email: "fx-freshness-member@example.com",
      name: "FX Freshness Member",
      role: "member",
    });

    const response = await fxRatesApi.actions.getFreshnessForCookie(member.cookieHeader);
    await fxRatesApi.assert.statusIs(response, 403);
    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "admin_role_required");
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  test("[shape]: empty DB returns { pairs: [], queriedAt }", async ({
    request,
    fxRatesApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-freshness-empty-sub",
      email: "fx-freshness-empty@example.com",
      name: "FX Freshness Empty",
      role: "admin",
    });

    const response = await fxRatesApi.actions.getFreshnessForCookie(admin.cookieHeader);
    await fxRatesApi.assert.statusIs(response, 200);

    const body = await fxRatesApi.arrange.freshnessBody(response);
    await fxRatesApi.assert.mxAssertTruthy(Array.isArray(body.pairs), "pairs is array");
    await fxRatesApi.assert.mxAssertEqual(body.pairs.length, 0, "pairs.length");
    await fxRatesApi.assert.mxAssertEqual(typeof body.queriedAt, "string", "queriedAt type");
    // queriedAt should be a valid ISO datetime
    await fxRatesApi.assert.mxAssertTruthy(new Date(body.queriedAt).toISOString(), "queriedAt valid ISO");
  });

  test("[shape]: response has required top-level fields pairs and queriedAt", async ({
    request,
    fxRatesApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-freshness-shape-sub",
      email: "fx-freshness-shape@example.com",
      name: "FX Freshness Shape",
      role: "admin",
    });

    // Seed one pair first
    await fxRatesApi.actions.seedFxRates([{
      date: daysAgo(1),
      baseCurrency: "USD",
      quoteCurrency: "TWD",
      rate: 31.5,
      source: "frankfurter",
    }]);

    const response = await fxRatesApi.actions.getFreshnessForCookie(admin.cookieHeader);
    await fxRatesApi.assert.statusIs(response, 200);

    const body = await fxRatesApi.arrange.freshnessBody(response);
    await fxRatesApi.assert.mxAssertObjectHasKey(body, "pairs", "freshness body");
    await fxRatesApi.assert.mxAssertObjectHasKey(body, "queriedAt", "freshness body");
    await fxRatesApi.assert.mxAssertTruthy(Array.isArray(body.pairs), "pairs is array");
  });

  test("[shape]: each pair entry has baseCurrency, quoteCurrency, latestDate, ageInDays", async ({
    request,
    fxRatesApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-freshness-pair-shape-sub",
      email: "fx-freshness-pair-shape@example.com",
      name: "FX Freshness Pair Shape",
      role: "admin",
    });

    const seedDate = daysAgo(2);
    await fxRatesApi.actions.seedFxRates([{
      date: seedDate,
      baseCurrency: "USD",
      quoteCurrency: "TWD",
      rate: 31.5,
      source: "frankfurter",
    }]);

    const response = await fxRatesApi.actions.getFreshnessForCookie(admin.cookieHeader);
    await fxRatesApi.assert.statusIs(response, 200);

    const body = await fxRatesApi.arrange.freshnessBody(response);
    const pair = body.pairs.find(
      (p: { baseCurrency: string; quoteCurrency: string }) =>
        p.baseCurrency === "USD" && p.quoteCurrency === "TWD",
    );
    await fxRatesApi.assert.mxAssertDefined(pair, "seeded USD/TWD freshness pair");
    if (!pair) throw new Error("Expected seeded USD/TWD freshness pair");
    await fxRatesApi.assert.mxAssertEqual(pair.baseCurrency, "USD", "pair.baseCurrency");
    await fxRatesApi.assert.mxAssertEqual(pair.quoteCurrency, "TWD", "pair.quoteCurrency");
    await fxRatesApi.assert.mxAssertObjectHasKey(pair, "latestDate", "freshness pair");
    await fxRatesApi.assert.mxAssertObjectHasKey(pair, "ageInDays", "freshness pair");
    await fxRatesApi.assert.mxAssertEqual(typeof pair.ageInDays, "number", "pair.ageInDays type");
  });

  // ── ageInDays calculation ──────────────────────────────────────────────────

  test("[ageInDays]: correctly calculated against seeded data (2 days old → ageInDays=2)", async ({
    request,
    fxRatesApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-freshness-age-2d-sub",
      email: "fx-freshness-age-2d@example.com",
      name: "FX Freshness Age 2d",
      role: "admin",
    });

    const seedDate = daysAgo(2);
    await fxRatesApi.actions.seedFxRates([{
      date: seedDate,
      baseCurrency: "USD",
      quoteCurrency: "TWD",
      rate: 31.5,
      source: "frankfurter",
    }]);

    const response = await fxRatesApi.actions.getFreshnessForCookie(admin.cookieHeader);
    await fxRatesApi.assert.statusIs(response, 200);

    const body = await fxRatesApi.arrange.freshnessBody(response);
    const pair = body.pairs.find(
      (p: { baseCurrency: string; quoteCurrency: string }) =>
        p.baseCurrency === "USD" && p.quoteCurrency === "TWD",
    );
    await fxRatesApi.assert.mxAssertDefined(pair, "seeded USD/TWD freshness pair");
    if (!pair) throw new Error("Expected seeded USD/TWD freshness pair");
    // Allow ±1 day tolerance for test clock skew / timezone edge cases
    await fxRatesApi.assert.mxAssertGreaterThanOrEqual(pair.ageInDays, 1, "pair.ageInDays");
    await fxRatesApi.assert.mxAssertLessThanOrEqual(pair.ageInDays, 3, "pair.ageInDays");
  });

  test("[ageInDays]: today's data → ageInDays=0", async ({
    request,
    fxRatesApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-freshness-age-0d-sub",
      email: "fx-freshness-age-0d@example.com",
      name: "FX Freshness Age 0d",
      role: "admin",
    });

    const today = daysAgo(0);
    await fxRatesApi.actions.seedFxRates([{
      date: today,
      baseCurrency: "AUD",
      quoteCurrency: "USD",
      rate: 0.714,
      source: "frankfurter",
    }]);

    const response = await fxRatesApi.actions.getFreshnessForCookie(admin.cookieHeader);
    await fxRatesApi.assert.statusIs(response, 200);

    const body = await fxRatesApi.arrange.freshnessBody(response);
    const pair = body.pairs.find(
      (p: { baseCurrency: string; quoteCurrency: string }) =>
        p.baseCurrency === "AUD" && p.quoteCurrency === "USD",
    );
    await fxRatesApi.assert.mxAssertDefined(pair, "seeded AUD/USD freshness pair");
    if (!pair) throw new Error("Expected seeded AUD/USD freshness pair");
    await fxRatesApi.assert.mxAssertEqual(pair.ageInDays, 0, "pair.ageInDays");
  });

  // ── Ordering ───────────────────────────────────────────────────────────────

  test("[ordering]: pairs ordered by (baseCurrency, quoteCurrency) ASC", async ({
    request,
    fxRatesApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-freshness-order-sub",
      email: "fx-freshness-order@example.com",
      name: "FX Freshness Order",
      role: "admin",
    });

    const seedDate = daysAgo(1);
    await fxRatesApi.actions.seedFxRates([
      { date: seedDate, baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.5, source: "frankfurter" },
      { date: seedDate, baseCurrency: "AUD", quoteCurrency: "USD", rate: 0.714, source: "frankfurter" },
      { date: seedDate, baseCurrency: "TWD", quoteCurrency: "USD", rate: 0.031, source: "frankfurter" },
      { date: seedDate, baseCurrency: "USD", quoteCurrency: "AUD", rate: 1.4, source: "frankfurter" },
      { date: seedDate, baseCurrency: "TWD", quoteCurrency: "AUD", rate: 0.044, source: "frankfurter" },
      { date: seedDate, baseCurrency: "AUD", quoteCurrency: "TWD", rate: 22.5, source: "frankfurter" },
    ]);

    const response = await fxRatesApi.actions.getFreshnessForCookie(admin.cookieHeader);
    await fxRatesApi.assert.statusIs(response, 200);

    const body = await fxRatesApi.arrange.freshnessBody(response);
    // Filter to only the seeded pairs (other tests may have seeded other pairs in this shared server)
    const seededPairs = body.pairs.filter((p: { baseCurrency: string; quoteCurrency: string }) =>
      ["AUD", "TWD", "USD"].includes(p.baseCurrency) &&
      ["AUD", "TWD", "USD"].includes(p.quoteCurrency),
    );

    const keys = seededPairs.map(
      (p: { baseCurrency: string; quoteCurrency: string }) => `${p.baseCurrency}/${p.quoteCurrency}`,
    );
    // Verify keys are in sorted order
    const sortedKeys = [...keys].sort();
    await fxRatesApi.assert.mxAssertDeepEqual(keys, sortedKeys, "freshness pair ordering");
  });
});
