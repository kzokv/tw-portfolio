/**
 * KZO-180 — HTTP AAA tests for the user-level reporting currency contract.
 *
 * Per `.claude/rules/service-error-pattern.md`:
 *   Zod validation errors carry the machine-readable code in `body.error`,
 *   NOT `body.code`. HTTP-3 reads `body.error === "invalid_preference"`.
 *
 * Per `.claude/rules/qa-test-infra-check.md`:
 *   - `/__e2e/seed-fx-rates` is wired at `registerRoutes.ts:1397` (KZO-164).
 *   - `/__e2e/seed-user-preferences` is wired at `registerRoutes.ts:1352` (KZO-159).
 *   - Both gated by `assertE2ESeedEnabled()` (NODE_ENV + memory backend) and
 *     reachable from the HTTP test config (`PERSISTENCE_BACKEND=memory`).
 *
 * Per `.claude/rules/test-api-mapper-registration.md`:
 *   No new endpoint class is added; we use the existing `FxRatesEndpoint`
 *   (registered) for FX seeding + raw `request.{get,patch}` for
 *   `/user-preferences` and `/dashboard/*` (matches `user-preferences-aaa.http.spec.ts`
 *   precedent).
 *
 * fxStatus contract (architect-pinned at Phase 1 checkpoint):
 *   - All resolved → "complete"
 *   - Some resolved + some missing → "partial"
 *   - ALL missing (zero resolved across all unique source currencies) → "missing"
 *   - Empty contributors → "complete"
 *   HTTP-5 specifically: single source currency with 0 resolved = "missing".
 */

import { TestEnv } from "@tw-portfolio/config/test";
import { createApiFixture } from "@tw-portfolio/test-api/config";
import { FxRatesEndpoint } from "@tw-portfolio/test-api/endpoints";
import type { TFxRatesApiAssistant } from "@tw-portfolio/test-api/assistants";
import { transactionPayload } from "../../helpers/fixtures.js";
import { test as base } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

// Extend the base HTTP fixture with the FxRatesEndpoint assistant. Mirrors the
// pattern in `admin-fx-rates-freshness-aaa.http.spec.ts` — the endpoint is
// already registered in `libs/test-api/src/config/mapper.ts` so no
// registration changes are needed.
const test = base.extend<{ fxRatesApi: TFxRatesApiAssistant }>({
  fxRatesApi: createApiFixture<TFxRatesApiAssistant>(FxRatesEndpoint),
});

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

interface PreferencesBody {
  preferences: Record<string, unknown>;
}

interface DashboardOverviewBody {
  summary: {
    asOf: string;
    accountCount: number;
    holdingCount: number;
    totalCostAmount: number;
    reportingCurrency: "TWD" | "USD" | "AUD";
    fxStatus: "complete" | "partial" | "missing";
    marketValueAmount: number | null;
    unrealizedPnlAmount: number | null;
    dailyChangeAmount: number | null;
    dailyChangePercent: number | null;
    upcomingDividendCount: number;
    upcomingDividendAmount: number | null;
    openIssueCount: number;
  };
  holdings: unknown[];
}

interface DashboardPerformanceBody {
  range: string;
  reportingCurrency: "TWD" | "USD" | "AUD";
  fxStatus: "complete" | "partial" | "missing";
  points: Array<{
    date: string;
    fxAvailable: boolean;
    totalCostAmount: number | null;
    marketValueAmount: number | null;
    unrealizedPnlAmount: number | null;
    cumulativeRealizedPnlAmount: number | null;
    cumulativeDividendsAmount: number | null;
  }>;
}

test.describe("dashboard reporting currency (KZO-180)", () => {
  // ── HTTP-1 — Default user shape ────────────────────────────────────────────
  test("[reporting-currency-1]: GET /dashboard/overview default user → reportingCurrency='TWD', fxStatus='complete', no totalCostCurrency", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "kzo180-http1-sub",
      email: "kzo180-http1@example.com",
      name: "KZO-180 HTTP 1",
      role: "member",
    });

    const response = await request.get(apiPath("/dashboard/overview"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(response, 200);
    const body = await response.json() as DashboardOverviewBody;

    await adminApi.assert.mxAssertEqual(body.summary.reportingCurrency, "TWD", "default reporting currency");
    await adminApi.assert.mxAssertEqual(body.summary.fxStatus, "complete", "fxStatus on empty portfolio");
    // Per scope-todo D7: `totalCostCurrency` is dropped from the wire DTO.
    await adminApi.assert.mxAssertEqual(
      Object.prototype.hasOwnProperty.call(body.summary, "totalCostCurrency"),
      false,
      "totalCostCurrency was dropped from the DTO",
    );
  });

  // ── HTTP-2 — PATCH USD round-trip ──────────────────────────────────────────
  test("[reporting-currency-2]: PATCH /user-preferences { reportingCurrency: 'USD' } → 200; subsequent GETs reflect", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "kzo180-http2-sub",
      email: "kzo180-http2@example.com",
      name: "KZO-180 HTTP 2",
      role: "member",
    });

    const patchResponse = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { reportingCurrency: "USD" },
    });
    await adminApi.assert.statusIs(patchResponse, 200);
    const patchBody = await patchResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertEqual(patchBody.preferences.reportingCurrency, "USD", "PATCH echo");

    const prefsResponse = await request.get(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
    });
    const prefsBody = await prefsResponse.json() as PreferencesBody;
    await adminApi.assert.mxAssertEqual(prefsBody.preferences.reportingCurrency, "USD", "GET prefs reflects");

    const overviewResponse = await request.get(apiPath("/dashboard/overview"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(overviewResponse, 200);
    const overviewBody = await overviewResponse.json() as DashboardOverviewBody;
    await adminApi.assert.mxAssertEqual(overviewBody.summary.reportingCurrency, "USD", "overview reflects USD");
  });

  // ── HTTP-3 — EUR rejected ──────────────────────────────────────────────────
  test("[reporting-currency-3]: PATCH /user-preferences { reportingCurrency: 'EUR' } → 400 body.error='invalid_preference'", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "kzo180-http3-sub",
      email: "kzo180-http3@example.com",
      name: "KZO-180 HTTP 3",
      role: "member",
    });

    const response = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { reportingCurrency: "EUR" },
    });
    await adminApi.assert.statusIs(response, 400);
    // Per `service-error-pattern.md` JSON envelope shape: read `body.error`,
    // NOT `body.code`.
    const body = await response.json() as { error?: string; message?: string };
    await adminApi.assert.mxAssertEqual(body.error, "invalid_preference", "Zod rejection code");
  });

  // ── HTTP-4 — Cross-currency translation end-to-end ─────────────────────────
  test("[reporting-currency-4]: PATCH USD + seed TWD position + seed TWD→USD FX → /dashboard/overview returns translated values", async ({
    request,
    adminApi,
    transactionsApi,
    fxRatesApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "kzo180-http4-sub",
      email: "kzo180-http4@example.com",
      name: "KZO-180 HTTP 4",
      role: "member",
    });

    // Switch reporting currency to USD.
    const patchPref = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { reportingCurrency: "USD" },
    });
    await adminApi.assert.statusIs(patchPref, 200);

    // Seed TWD→USD FX rate of 1/30 = ~0.0333 across the relevant date range.
    // The HTTP test config runs against a memory backend; FX rates are
    // process-global so we reset on success/fail to isolate.
    const fxRate = 0.0333;
    const dates = ["2026-01-01", "2026-04-01", "2026-04-29"];
    const seedResp = await fxRatesApi.actions.seedFxRates(
      dates.map((date) => ({
        baseCurrency: "TWD",
        quoteCurrency: "USD",
        date,
        rate: fxRate,
      })),
    );
    await adminApi.assert.statusIs(seedResp, 200);

    try {
      // Seed a TWD trade — uses the default `acc-1` account, currency TWD.
      const txResp = await transactionsApi.actions.createTransactionForCookie(
        session.cookieHeader,
        undefined,
        transactionPayload({
          ticker: "2330",
          priceCurrency: "TWD",
          type: "BUY",
          quantity: 100,
          unitPrice: 600,
          tradeDate: "2026-01-01",
        }),
        "kzo180-http4-tx",
      );
      await adminApi.assert.statusIs(txResp, 200);

      const overviewResp = await request.get(apiPath("/dashboard/overview"), {
        headers: { cookie: session.cookieHeader },
      });
      await adminApi.assert.statusIs(overviewResp, 200);
      const overviewBody = await overviewResp.json() as DashboardOverviewBody;
      await adminApi.assert.mxAssertEqual(overviewBody.summary.reportingCurrency, "USD", "USD reporting");
      await adminApi.assert.mxAssertEqual(overviewBody.summary.fxStatus, "complete", "fxStatus complete");
      // The TWD cost basis (100 * 600 = 60,000) translated at TWD→USD = 0.0333
      // is approximately 1,998. Use a generous tolerance because the route
      // computes commissions/fees that may add to the cost. We assert the
      // value is roughly proportional to the FX rate.
      const totalCostUsd = overviewBody.summary.totalCostAmount;
      // Native TWD cost ≈ 60_000 (plus minor fees); translated ≈ 60_000 * 0.0333 = ~1_998.
      // Loose bounds protect against fee-policy drift while still catching a
      // missing-translation regression (which would surface as ~60_000 in USD).
      await adminApi.assert.mxAssertEqual(totalCostUsd > 1_000, true, "translated total cost ≈ ~2k USD (got " + totalCostUsd + ")");
      await adminApi.assert.mxAssertEqual(totalCostUsd < 5_000, true, "translated total cost not in TWD scale (got " + totalCostUsd + ")");
    } finally {
      await fxRatesApi.actions.resetFxRates();
    }
  });

  // ── HTTP-5 — Missing FX → null + degraded fxStatus = "missing" ─────────────
  // Architect pinned: single source currency with 0 resolved = "missing".
  //
  // SKIPPED — depends on a pre-classified US-market instrument in the test
  // catalog. Seeding a USD trade requires a ticker whose `instrumentType` is
  // non-null AND whose `marketCode` matches the account's market (KZO-183
  // `assertTradeMarketMatchesAccount`). The default memory catalog
  // (`apps/api/src/persistence/memory.ts:185-191`) seeds only TW-market
  // instruments (2330, 2317, 0050, 00679B, 020000), and `/__e2e/seed-instruments`
  // is gated by `assertE2EResetEnabled()` which requires `AUTH_MODE=dev_bypass`
  // — incompatible with the HTTP suite's `AUTH_MODE=oauth`.
  //
  // The architect-pinned contract for this boundary IS regression-guarded at
  // the persistence layer: `INT-3` (single non-translatable contributor →
  // `fxAvailable=false`, NULL aggregates) + the `rollupFxStatus` unit test
  // for `dashboardReportingCurrency.ts` which proves the per-source-currency
  // map produces "missing" when the only contributor's FX fails.
  //
  // Promotion path: when the test catalog gains a US-market instrument (e.g.
  // a future "MSFT" or "AAPL" entry in `DEFAULT_MEMORY_CATALOG`) OR the
  // `/__e2e/seed-instruments` guard is loosened to `assertE2ESeedEnabled()`,
  // un-skip this test and re-run.
  test.skip("[reporting-currency-5]: PATCH TWD + seed USD position WITHOUT FX → fxStatus='missing' (NOT partial) — see file comment", async () => {
    // intentionally empty — see top-level skip rationale.
  });

  // ── HTTP-6 — Performance series shape ──────────────────────────────────────
  test("[reporting-currency-6]: GET /dashboard/performance after currency switch → carries reportingCurrency, fxStatus, per-point fxAvailable", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "kzo180-http6-sub",
      email: "kzo180-http6@example.com",
      name: "KZO-180 HTTP 6",
      role: "member",
    });

    const patchPref = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { reportingCurrency: "USD" },
    });
    await adminApi.assert.statusIs(patchPref, 200);

    const perfResp = await request.get(apiPath("/dashboard/performance?range=1Y"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(perfResp, 200);
    const body = await perfResp.json() as DashboardPerformanceBody;
    await adminApi.assert.mxAssertEqual(body.reportingCurrency, "USD", "performance reportingCurrency");
    // Top-level `fxStatus` is one of the three values per the DTO.
    await adminApi.assert.mxAssertEqual(
      ["complete", "partial", "missing"].includes(body.fxStatus),
      true,
      "fxStatus is in the allowed set",
    );
    // Each point carries `fxAvailable: boolean`. For an empty portfolio the
    // points array may be empty — that's a valid shape and explicitly NOT a
    // failure.
    for (const point of body.points) {
      await adminApi.assert.mxAssertEqual(typeof point.fxAvailable, "boolean", "per-point fxAvailable boolean");
      if (point.fxAvailable === false) {
        await adminApi.assert.mxAssertEqual(point.totalCostAmount, null, "totalCostAmount null when fxAvailable=false");
        await adminApi.assert.mxAssertEqual(point.marketValueAmount, null, "marketValueAmount null when fxAvailable=false");
        await adminApi.assert.mxAssertEqual(point.unrealizedPnlAmount, null, "unrealizedPnlAmount null when fxAvailable=false");
        await adminApi.assert.mxAssertEqual(point.cumulativeRealizedPnlAmount, null, "cumulativeRealizedPnlAmount null when fxAvailable=false");
        await adminApi.assert.mxAssertEqual(point.cumulativeDividendsAmount, null, "cumulativeDividendsAmount null when fxAvailable=false");
      }
    }
  });

  // ── HTTP-7 — null clears reporting currency back to default ────────────────
  test("[reporting-currency-7]: PATCH /user-preferences { reportingCurrency: null } reverts to default 'TWD'", async ({
    request,
    adminApi,
  }) => {
    const session = await createOauthSession(request, {
      sub: "kzo180-http7-sub",
      email: "kzo180-http7@example.com",
      name: "KZO-180 HTTP 7",
      role: "member",
    });

    const patchUsd = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { reportingCurrency: "USD" },
    });
    await adminApi.assert.statusIs(patchUsd, 200);

    const patchClear = await request.patch(apiPath("/user-preferences"), {
      headers: { cookie: session.cookieHeader },
      data: { reportingCurrency: null },
    });
    await adminApi.assert.statusIs(patchClear, 200);

    // After clearing, GET overview falls back to the default 'TWD'.
    const overviewResp = await request.get(apiPath("/dashboard/overview"), {
      headers: { cookie: session.cookieHeader },
    });
    await adminApi.assert.statusIs(overviewResp, 200);
    const overviewBody = await overviewResp.json() as DashboardOverviewBody;
    await adminApi.assert.mxAssertEqual(overviewBody.summary.reportingCurrency, "TWD", "default reverts to TWD");
  });

  // ── HTTP-8 — Self-pair USD → USD: complete without FX (D8 at route level) ──
  // SKIPPED — same constraint as HTTP-5: the HTTP suite cannot easily seed a
  // USD position because the default test catalog has no US-market instrument
  // and `/__e2e/seed-instruments` is gated to `dev_bypass` mode. The
  // load-bearing self-pair guard is regression-tested at:
  //   - persistence layer: `INT-1` (TWD self-pair, reporting=TWD, no FX → SUMs
  //     equal native + fxAvailable=true) — proves the SQL `D8` guard.
  //   - aggregator service: the `dashboardReportingCurrency.ts` `rollupFxStatus`
  //     unit test (DRC-edge-3 advisory) — proves USD self-pair under
  //     reporting=USD with no FX yields `fxStatus="complete"`.
  //
  // Promotion path: same as HTTP-5 — when the test catalog gains a US-market
  // instrument or the seed-instruments guard is loosened, un-skip and re-run.
  test.skip("[reporting-currency-8]: PATCH USD + seed USD position + NO FX rates → fxStatus='complete' (self-pair guard) — see file comment", async () => {
    // intentionally empty — see top-level skip rationale.
  });
});
