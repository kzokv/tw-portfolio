/**
 * KZO-172 — `GET /market-data/search` HTTP regression suite.
 *
 * Per `.claude/rules/test-api-mapper-registration.md`, the search endpoint is
 * implemented as new methods on the existing `MarketDataEndpoint` (and matching
 * `MarketDataApiActions`) — NOT a fresh `MarketDataSearchEndpoint`. Avoiding
 * a new endpoint class keeps the mapper registration untouched (existing
 * `MarketDataEndpoint` is already wired).
 *
 * Per `.claude/rules/service-error-pattern.md` ("JSON envelope shape"
 * subsection), 4xx responses use `body.error` for the machine-readable code,
 * NOT `body.code`.
 *
 * Per `.claude/rules/service-error-pattern.md` ("Distinguishing per-client vs
 * upstream-budget rate limits — 429 vs 503"), the per-IP exhaustion path
 * returns `429 rate_limit_exceeded`. Provider-budget exhaustion would return
 * `503 provider_rate_limited` — that path is not exercised at the HTTP layer
 * here (covered by provider unit tests).
 *
 * **Reserved AU ticker for this spec:** BHP (memory-backed E2E and HTTP shared
 * primary AU ticker per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`).
 *
 * Pattern mirrors `apps/api/test/http/specs/market-data-price-aaa.http.spec.ts`.
 */

import { test } from "../fixtures.js";

test.describe("GET /market-data/search (KZO-172)", () => {
  // Reset the per-IP rate-limit bucket BEFORE each test so the 429 case has a
  // deterministic starting point. The `resetSearchRateLimit` action calls
  // `POST /__e2e/reset-market-data-search-rate-limit` (test-only seam exposed
  // by Backend Implementer; mirror precedent: `_resetMarketDataPriceBuckets`).
  test.beforeEach(async ({ marketDataApi }) => {
    const resetResp = await marketDataApi.actions.resetSearchRateLimit();
    // Best-effort reset; if the endpoint isn't yet exposed, skip silently — the
    // 429 test below tolerates a noisy starting point by resetting again.
    if (resetResp.status() !== 200 && resetResp.status() !== 204) {
      // Non-fatal — Backend may not yet have wired the reset endpoint.
    }
  });

  // ── S1 — AU search returns BHP from the mock fixture (happy path) ───────────

  test("[/market-data/search]: AU + q='BHP' → 200 with BHP in results", async ({
    marketDataApi,
  }) => {
    const response = await marketDataApi.actions.searchInstruments("BHP", "AU");
    await marketDataApi.assert.statusIs(response, 200);
    const body = await marketDataApi.assert.priceBody(response);

    // Body shape: `{ instruments: RawInstrumentInfo[] }` per scope-todo Phase 7.
    await marketDataApi.assert.mxAssertEqual(
      Array.isArray(body["instruments"]),
      true,
      "body.instruments is an array",
    );
    const instruments = body["instruments"] as Array<Record<string, unknown>>;
    await marketDataApi.assert.mxAssertEqual(
      instruments.some((row) => row["ticker"] === "BHP"),
      true,
      "body.instruments contains a BHP row",
    );
  });

  // ── S2 — Missing market_code → 400 (Zod required-param rejection) ───────────

  test("[/market-data/search]: missing market_code → 400 with body.error", async ({
    marketDataApi,
  }) => {
    const response = await marketDataApi.actions.searchInstrumentsMissingMarketCode("BHP");
    await marketDataApi.assert.statusIs(response, 400);
    const body = await marketDataApi.assert.errorBody(response);
    // Per service-error-pattern.md: machine code lives at body.error.
    await marketDataApi.assert.mxAssertEqual(
      typeof body["error"] === "string" && (body["error"] as string).length > 0,
      true,
      "body.error is a non-empty string",
    );
  });

  // ── S3 — Missing q → 400 ────────────────────────────────────────────────────

  test("[/market-data/search]: missing q → 400", async ({ marketDataApi }) => {
    const response = await marketDataApi.actions.searchInstrumentsMissingQuery("AU");
    await marketDataApi.assert.statusIs(response, 400);
  });

  // ── S4 — q length below min(2) → 400 (single-character firehose guard, security F2) ─

  test("[/market-data/search]: q='a' (length 1) → 400 (Zod min(2))", async ({
    marketDataApi,
  }) => {
    const response = await marketDataApi.actions.searchInstruments("a", "AU");
    await marketDataApi.assert.statusIs(response, 400);
  });

  // ── S5 — Whitespace-only q → 400 (security F2 — `.trim().min(2)`) ───────────

  test("[/market-data/search]: q='   ' (whitespace only) → 400 after trim", async ({
    marketDataApi,
  }) => {
    const response = await marketDataApi.actions.searchInstruments("   ", "AU");
    await marketDataApi.assert.statusIs(response, 400);
  });

  // ── S6 — Regex mismatch on q → 400 (security F2 — CRLF / script tag rejection) ─

  test("[/market-data/search]: q with HTML tag → 400 (regex rejects '<' and '>')", async ({
    marketDataApi,
  }) => {
    const response = await marketDataApi.actions.searchInstruments("<script>", "AU");
    await marketDataApi.assert.statusIs(response, 400);
  });

  test("[/market-data/search]: q with embedded newline (CRLF) → 400 (regex rejects '\\n')", async ({
    marketDataApi,
  }) => {
    // Embedded LF — the URLSearchParams encoding will %-escape this; the route's
    // Zod regex `^[A-Za-z0-9 .&'()-]+$` should reject after URL decode.
    const response = await marketDataApi.actions.searchInstruments("hello\nworld", "AU");
    await marketDataApi.assert.statusIs(response, 400);
  });

  // ── S7 — q length above max(50) → 400 ───────────────────────────────────────

  test("[/market-data/search]: q length > 50 → 400 (Zod max(50))", async ({
    marketDataApi,
  }) => {
    const response = await marketDataApi.actions.searchInstruments("a".repeat(51), "AU");
    await marketDataApi.assert.statusIs(response, 400);
  });

  // ── S8 — Invalid market_code → 400 (Zod enum) ───────────────────────────────

  test("[/market-data/search]: invalid market_code value → 400", async ({
    marketDataApi,
  }) => {
    const response = await marketDataApi.actions.searchInstruments(
      "BHP",
      "JP" as unknown as "AU",
    );
    await marketDataApi.assert.statusIs(response, 400);
  });

  // ── S9 — TW returns [] (no-op stub on non-AU markets per scope-todo Phase 3) ─

  test("[/market-data/search]: market_code=TW → 200 with empty instruments (no-op)", async ({
    marketDataApi,
  }) => {
    const response = await marketDataApi.actions.searchInstruments("BHP", "TW");
    await marketDataApi.assert.statusIs(response, 200);
    const body = await marketDataApi.assert.priceBody(response);
    await marketDataApi.assert.mxAssertEqual(
      Array.isArray(body["instruments"]) && (body["instruments"] as unknown[]).length === 0,
      true,
      "body.instruments is an empty array on TW (no-op stub)",
    );
  });

  test("[/market-data/search]: market_code=US → 200 with empty instruments (no-op)", async ({
    marketDataApi,
  }) => {
    const response = await marketDataApi.actions.searchInstruments("BHP", "US");
    await marketDataApi.assert.statusIs(response, 200);
    const body = await marketDataApi.assert.priceBody(response);
    await marketDataApi.assert.mxAssertEqual(
      Array.isArray(body["instruments"]) && (body["instruments"] as unknown[]).length === 0,
      true,
      "body.instruments is an empty array on US (no-op stub)",
    );
  });

  // ── S10 — Per-IP rate-limit fires after 20 calls (security F4) ──────────────
  //
  // Default `MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE = 20`. This is a separate
  // bucket from `/market-data/price`'s 30/min (per debate-result A3 / F4). The
  // 21st call from the same IP must return 429 + `body.error === "rate_limit_exceeded"`.
  //
  // We reset the bucket inside this test (in addition to the global beforeEach
  // reset) so the count starts at 0 regardless of any leakage from sibling
  // specs in the same worker.

  test("[/market-data/search]: 21st call from same IP → 429 rate_limit_exceeded", async ({
    marketDataApi,
  }) => {
    // Defensive reset to isolate this test's bucket count.
    await marketDataApi.actions.resetSearchRateLimit();

    // 20 calls within the window must succeed (200). Every call is a valid AU
    // search query; the route is a thin wrapper around the mock provider.
    for (let i = 0; i < 20; i++) {
      const ok = await marketDataApi.actions.searchInstruments("BHP", "AU");
      await marketDataApi.assert.statusIs(ok, 200);
    }

    // 21st call exceeds the per-IP bucket → 429.
    const limited = await marketDataApi.actions.searchInstruments("BHP", "AU");
    await marketDataApi.assert.statusIs(limited, 429);
    const body = await marketDataApi.assert.errorBody(limited);
    await marketDataApi.assert.mxAssertEqual(
      body["error"],
      "rate_limit_exceeded",
      "body.error === 'rate_limit_exceeded' for per-IP exhaustion",
    );
  });
});
