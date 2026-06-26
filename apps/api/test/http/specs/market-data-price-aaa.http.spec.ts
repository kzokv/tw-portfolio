/**
 * KZO-170 (D2 / G-NC-6) — `/market-data/price` requires `marketCode`.
 *
 * The price route used to derive the market via `resolveMarketCode(ticker)`,
 * which always returned `"TW"` regardless of the actual ticker. KZO-170 deletes
 * that helper and adds a required `marketCode` query parameter so the route
 * can dispatch to the correct per-market provider.
 *
 * Per `.claude/rules/service-error-pattern.md` ("JSON envelope shape" section),
 * 4xx responses use `body.error` for the machine code, NOT `body.code`.
 *
 * Reserved US ticker for this spec: AAPL (per scope-todo D8 / G-CRIT-3 mock
 * fixture starts at 2024-01-01).
 *
 * Pattern mirrors `apps/api/test/http/specs/quotes-aaa.http.spec.ts`.
 */

import { test } from "../fixtures.js";

// G-CRIT-3: All US E2E/HTTP test seeds use trade dates / bar dates within the
// MockFinMindUsStockMarketDataProvider fixture window (starts 2024-01-02, 30 trading
// days, ending ~2024-02-12). 2024-01-15 (Monday) is in week 3 of the 30-bar window.
const AAPL_2024_BAR_DATE = "2024-01-15";

// KZO-172: AU memory-backed mock provider (`MockYahooFinanceAuMarketDataProvider`)
// emits 30 trading days starting `2024-01-02` for BHP. Pick a date well inside
// the fixture window. 2024-01-15 (Monday) lands in week 3.
const BHP_2024_BAR_DATE = "2024-01-15";

test.describe("GET /market-data/price (KZO-170)", () => {
  // ── M1 — TW happy path (regression: pre-KZO-170 behavior unchanged) ─────────

  test("[/market-data/price]: TW with seeded bar → 200 + close", async ({ marketDataApi }) => {
    // Arrange — seed a TW bar that the route can read directly from memory.
    const seedResp = await marketDataApi.actions.seedDailyBars([
      {
        ticker: "2330",
        barDate: "2026-01-15",
        open: 998,
        high: 1008,
        low: 995,
        close: 1005,
        volume: 100_000,
        source: "seed",
        ingestedAt: "2026-01-15T00:00:00.000Z",
      },
    ]);
    await marketDataApi.assert.statusIs(seedResp, 200);

    // Act
    const response = await marketDataApi.actions.getPrice("2330", "2026-01-15", "TW");

    // Assert
    await marketDataApi.assert.statusIs(response, 200);
    const body = await marketDataApi.assert.priceBody(response);
    await marketDataApi.assert.fieldEquals(body, "close", 1005);
    await marketDataApi.assert.fieldEquals(body, "date", "2026-01-15");
  });

  // ── M2 — US happy path (KZO-170's new code path) ────────────────────────────
  // No seed: route falls through to the provider registry, which on memory
  // backend resolves to MockFinMindUsStockMarketDataProvider (Phase 2 of the
  // Implementer's work). Asserts only on shape (200 + close + date), not the
  // exact value, because the mock fixtures are deterministic by design but
  // the test should not pin to a specific synthetic price.

  test("[/market-data/price]: US with marketCode dispatches to the US provider → 200", async ({ marketDataApi }) => {
    // Act — query AAPL with marketCode=US. With no stored bar, the route should
    // dispatch to the US provider (MockFinMindUsStockMarketDataProvider in
    // memory mode) and return a fixture bar.
    const response = await marketDataApi.actions.getPrice("AAPL", AAPL_2024_BAR_DATE, "US");

    // Assert — 200 with a numeric close field; the US provider exists.
    await marketDataApi.assert.statusIs(response, 200);
    const body = await marketDataApi.assert.priceBody(response);
    await marketDataApi.assert.mxAssertEqual(
      typeof body["close"] === "number" && Number.isFinite(body["close"] as number),
      true,
      "body.close is a finite number",
    );
    await marketDataApi.assert.mxAssertEqual(
      typeof body["date"] === "string" && (body["date"] as string).length >= 10,
      true,
      "body.date is an ISO date string",
    );
  });

  // ── M2.AU — AU happy path (KZO-172) ─────────────────────────────────────────
  // No seed: route falls through to the provider registry, which on memory
  // backend resolves to MockYahooFinanceAuMarketDataProvider. Asserts only on
  // shape (200 + finite close + ISO date) like M2 — the mock fixture is
  // deterministic but the test should not pin a synthetic price value.

  test("[/market-data/price]: AU with marketCode dispatches to the AU provider → 200", async ({ marketDataApi }) => {
    // Act — query BHP with marketCode=AU. With no stored bar, the route should
    // dispatch to the AU provider (MockYahooFinanceAuMarketDataProvider in
    // memory mode) and return a fixture bar.
    const response = await marketDataApi.actions.getPrice("BHP", BHP_2024_BAR_DATE, "AU");

    // Assert — 200 with a numeric close field; the AU provider exists.
    await marketDataApi.assert.statusIs(response, 200);
    const body = await marketDataApi.assert.priceBody(response);
    await marketDataApi.assert.mxAssertEqual(
      typeof body["close"] === "number" && Number.isFinite(body["close"] as number),
      true,
      "body.close is a finite number",
    );
    await marketDataApi.assert.mxAssertEqual(
      typeof body["date"] === "string" && (body["date"] as string).length >= 10,
      true,
      "body.date is an ISO date string",
    );
  });

  // ── M3 — Missing marketCode → 400 ───────────────────────────────────────────

  test("[/market-data/price]: missing marketCode query param → 400", async ({ marketDataApi }) => {
    // Act — call WITHOUT marketCode (regression: pre-KZO-170 silently accepted
    // this with the resolveMarketCode heuristic).
    const response = await marketDataApi.actions.getPriceMissingMarketCode("AAPL", AAPL_2024_BAR_DATE);

    // Assert — Zod-shape rejection. Per service-error-pattern.md the error code
    // lives at body.error (NOT body.code).
    await marketDataApi.assert.statusIs(response, 400);
    const body = await marketDataApi.assert.errorBody(response);
    await marketDataApi.assert.mxAssertEqual(
      typeof body["error"] === "string" && (body["error"] as string).length > 0,
      true,
      "body.error is a non-empty string",
    );
  });

  // ── M4 — Invalid marketCode value → 400 ─────────────────────────────────────

  test("[/market-data/price]: invalid marketCode value → 400", async ({ marketDataApi }) => {
    // Pass a non-enum string — the route's Zod enum check must reject this.
    const response = await marketDataApi.actions.getPrice(
      "AAPL",
      AAPL_2024_BAR_DATE,
      "ZZ" as unknown as "US",
    );

    await marketDataApi.assert.statusIs(response, 400);
  });
});
