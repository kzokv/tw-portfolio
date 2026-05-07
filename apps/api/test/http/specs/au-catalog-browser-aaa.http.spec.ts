/**
 * HTTP AAA tests for KZO-194: AU instrument catalog returns ≥100 rows after
 * the TD bulk catalog sync populates `market_data.instruments`.
 *
 * Covers (per scope-todo Phase 7 / AC #1):
 *   AC1-T1  POST /__e2e/seed-instruments + GET /instruments?market_code=AU → ≥100 rows
 *   AC1-T2  All returned rows have marketCode = "AU"
 *   AC1-T3  Seeded AU tickers appear in the response (spot-check)
 *   AC1-T4  GET /instruments?market_code=TW is unaffected by AU seed (isolation)
 *
 * Ticker hygiene (per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`):
 *   - Reserved AU tickers NOT used as bar seeds in this file: BHP, CSL, VAS,
 *     WBC, AFI, GMG, IMD, CBA.
 *   - This test only seeds via `/__e2e/seed-instruments` (no bar seeds), so
 *     the reserved-ticker rule about the global daily-bars array does NOT apply.
 *     However, to avoid confusion we still use synthetic tickers (AUTEST001 …
 *     AUTEST101) that cannot collide with any real reserved ticker.
 *
 * Infra: `/__e2e/seed-instruments` uses `assertE2ESeedEnabled()` (additive guard)
 * per `.claude/rules/e2e-seed-vs-reset-guards.md`, so it works in AUTH_MODE=oauth
 * (the HTTP suite runs in oauth mode).
 *
 * Precedent: `transaction-form-market-code-aaa.http.spec.ts` (KZO-169) — same
 * `instrumentsApi.actions.seedInstruments` + `instrumentsApi.actions.listInstruments`
 * + `instrumentsApi.arrange.instruments` + `instrumentsApi.assert.*` pattern.
 */

import { test } from "../fixtures.js";

/** Generate N synthetic AU ticker strings: "AUTEST001" ... "AUTEST{N}" */
function generateAuTickers(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    `AUTEST${String(i + 1).padStart(3, "0")}`,
  );
}

const AU_TICKER_COUNT = 101; // seed 101 to safely exceed the ≥100 threshold
const AU_TICKERS = generateAuTickers(AU_TICKER_COUNT);

test.describe("AU catalog browser — ≥100 AU rows (KZO-194)", () => {
  // ── AC1-T1 ─────────────────────────────────────────────────────────────────
  // After seeding 101 AU instruments, the AU market filter returns all of them.

  test(
    "[GET /instruments?market_code=AU]: returns ≥100 rows after bulk AU seed",
    async ({ instrumentsApi }) => {
      // Arrange — seed 101 synthetic AU instruments
      const seedPayload = AU_TICKERS.map((ticker) => ({
        ticker,
        name: `AU Test Instrument ${ticker}`,
        instrumentType: "STOCK",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      }));

      const seedResp = await instrumentsApi.actions.seedInstruments(seedPayload);
      await instrumentsApi.assert.statusIs(seedResp, 200);

      // Act — list AU catalog
      const listResp = await instrumentsApi.actions.listInstruments("AU");
      await instrumentsApi.assert.statusIs(listResp, 200);

      // Assert — exactly 101 AU rows returned (we seeded exactly 101, no pre-existing AU rows)
      const items = await instrumentsApi.arrange.instruments(listResp);
      await instrumentsApi.assert.instrumentsCount(items, 101);
    },
  );

  // ── AC1-T2 ─────────────────────────────────────────────────────────────────
  // Every row in the AU filter response has marketCode = "AU".

  test(
    "[GET /instruments?market_code=AU]: every returned row has marketCode = 'AU'",
    async ({ instrumentsApi }) => {
      // Arrange
      const seedPayload = AU_TICKERS.map((ticker) => ({
        ticker,
        name: `AU Test Instrument ${ticker}`,
        instrumentType: "STOCK",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      }));

      const seedResp = await instrumentsApi.actions.seedInstruments(seedPayload);
      await instrumentsApi.assert.statusIs(seedResp, 200);

      // Act
      const listResp = await instrumentsApi.actions.listInstruments("AU");
      await instrumentsApi.assert.statusIs(listResp, 200);

      const items = await instrumentsApi.arrange.instruments(listResp);

      // Assert — market-code filter is exclusive
      await instrumentsApi.assert.everyMarketCodeIs(items, "AU");
    },
  );

  // ── AC1-T3 ─────────────────────────────────────────────────────────────────
  // Spot-check: the first seeded ticker appears in the response.

  test(
    "[GET /instruments?market_code=AU]: seeded AUTEST001 appears in response",
    async ({ instrumentsApi }) => {
      // Arrange — seed a small batch including the spot-check ticker
      const seedPayload = [
        {
          ticker: "AUTEST001",
          name: "AU Test Instrument 001",
          instrumentType: "STOCK",
          marketCode: "AU",
          barsBackfillStatus: "ready",
        },
        {
          ticker: "AUTEST002",
          name: "AU Test Instrument 002",
          instrumentType: "ETF",
          marketCode: "AU",
          barsBackfillStatus: "ready",
        },
      ];

      const seedResp = await instrumentsApi.actions.seedInstruments(seedPayload);
      await instrumentsApi.assert.statusIs(seedResp, 200);

      // Act
      const listResp = await instrumentsApi.actions.listInstruments("AU");
      await instrumentsApi.assert.statusIs(listResp, 200);

      const items = await instrumentsApi.arrange.instruments(listResp);

      // Assert — both seeded tickers exist in the AU catalog
      await instrumentsApi.assert.pairExists(items, "AUTEST001", "AU");
      await instrumentsApi.assert.pairExists(items, "AUTEST002", "AU");
    },
  );

  // ── AC1-T4 ─────────────────────────────────────────────────────────────────
  // AU seed does NOT pollute the TW catalog.

  test(
    "[GET /instruments?market_code=TW]: AU seed does not add rows to TW filter",
    async ({ instrumentsApi }) => {
      // Arrange — seed one TW instrument + 101 AU instruments
      const auSeedPayload = AU_TICKERS.map((ticker) => ({
        ticker,
        name: `AU Test Instrument ${ticker}`,
        instrumentType: "STOCK",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      }));
      const twSeedPayload = [
        {
          ticker: "TWTEST001",
          name: "TW Test Instrument",
          instrumentType: "STOCK",
          marketCode: "TW",
          barsBackfillStatus: "ready",
        },
      ];

      await instrumentsApi.actions.seedInstruments([...twSeedPayload, ...auSeedPayload]);

      // Act — list TW catalog
      const listResp = await instrumentsApi.actions.listInstruments("TW");
      await instrumentsApi.assert.statusIs(listResp, 200);

      const items = await instrumentsApi.arrange.instruments(listResp);

      // Assert — every row is TW, no AUTEST* rows appear
      await instrumentsApi.assert.everyMarketCodeIs(items, "TW");
      await instrumentsApi.assert.pairAbsent(items, "AUTEST001", "TW");
    },
  );
});
