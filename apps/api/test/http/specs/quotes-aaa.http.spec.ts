import { test } from "../fixtures.js";

// Fixture bars matching KZO-87 design doc (TSMC, 2 days for full derivation)
const FIXTURE_BARS_2330 = [
  { ticker: "2330", barDate: "2026-03-28", open: 595, high: 600, low: 590, close: 598, volume: 25000000 },
  { ticker: "2330", barDate: "2026-03-27", open: 590, high: 596, low: 588, close: 595, volume: 22000000 },
];

test.describe("GET /quotes", () => {
  test("TC-H1: seed bars → 200 with enriched snapshot including all required fields", async ({
    quotesApi,
  }) => {
    const seedRes = await quotesApi.actions.seedDailyBars(FIXTURE_BARS_2330);
    await quotesApi.assert.statusIs(seedRes, 200);

    const response = await quotesApi.actions.getQuotes(["2330"]);
    await quotesApi.assert.statusIs(response, 200);

    const body = await quotesApi.assert.quotesBody(response);
    await quotesApi.assert.fieldEquals(body["2330"] as Record<string, unknown>, "close", 598);
    await quotesApi.assert.fieldEquals(body["2330"] as Record<string, unknown>, "previousClose", 595);
    await quotesApi.assert.fieldEquals(body["2330"] as Record<string, unknown>, "change", 3);
    await quotesApi.assert.fieldEquals(body["2330"] as Record<string, unknown>, "asOf", "2026-03-28");
    await quotesApi.assert.tickerHasField(body, "2330", "changePercent");
    await quotesApi.assert.tickerHasField(body, "2330", "isProvisional");
    await quotesApi.assert.tickerHasField(body, "2330", "source");
  });

  test("TC-H2: no auth → 401 (requires /quotes route to call resolveUserId)", async ({
    quotesApi,
  }) => {
    // NOTE: This test is expected to FAIL until the /quotes route adds resolveUserId().
    // The route currently does not call resolveUserId, so it is accessible without auth.
    // See KZO-87 implementation finding: GET /quotes missing auth guard.
    const response = await quotesApi.actions.getQuotesUnauthenticated(["2330"]);
    await quotesApi.assert.statusIs(response, 401);
  });

  test("TC-H3: unknown ticker → null in response, not an error", async ({
    quotesApi,
  }) => {
    // No bars seeded for this ticker
    const response = await quotesApi.actions.getQuotes(["NOTINDB"]);
    await quotesApi.assert.statusIs(response, 200);

    const body = await quotesApi.assert.quotesBody(response);
    await quotesApi.assert.tickerIsNull(body, "NOTINDB");
  });
});
