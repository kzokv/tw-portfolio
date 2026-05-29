import { test } from "../fixtures.js";

test.describe("instrument catalog sectors", () => {
  test("[GET /instruments]: returns normalized sector for representative TW, US, and AU rows", async ({
    instrumentsApi,
  }) => {
    const seedResp = await instrumentsApi.actions.seedInstruments([
      {
        ticker: "2330",
        name: "TSMC",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
        industryCategoryRaw: "半導體業",
      },
      {
        ticker: "0050",
        name: "Yuanta Taiwan 50 ETF",
        instrumentType: "ETF",
        marketCode: "TW",
        barsBackfillStatus: "ready",
        industryCategoryRaw: "ETF",
      },
      {
        ticker: "AAPL",
        name: "Apple Inc.",
        instrumentType: "STOCK",
        marketCode: "US",
        barsBackfillStatus: "ready",
        industryCategoryRaw: "Computer Manufacturing",
      },
      {
        ticker: "BND",
        name: "Vanguard Total Bond Market ETF",
        instrumentType: "BOND_ETF",
        marketCode: "US",
        barsBackfillStatus: "ready",
        industryCategoryRaw: "Investment Trusts/Mutual Funds",
      },
      {
        ticker: "CBA",
        name: "Commonwealth Bank of Australia",
        instrumentType: "STOCK",
        marketCode: "AU",
        barsBackfillStatus: "ready",
        gicsIndustryGroup: "Banks",
      },
    ]);
    await instrumentsApi.assert.statusIs(seedResp, 200);

    const listResp = await instrumentsApi.actions.listInstruments("ALL");
    await instrumentsApi.assert.statusIs(listResp, 200);

    const items = await instrumentsApi.arrange.instruments(listResp);
    await instrumentsApi.assert.pairFieldEquals(
      items,
      "2330",
      "TW",
      "sector",
      "Information Technology",
    );
    await instrumentsApi.assert.pairFieldEquals(items, "0050", "TW", "sector", null);
    await instrumentsApi.assert.pairFieldEquals(
      items,
      "AAPL",
      "US",
      "sector",
      "Information Technology",
    );
    await instrumentsApi.assert.pairFieldEquals(items, "BND", "US", "sector", null);
    await instrumentsApi.assert.pairFieldEquals(items, "CBA", "AU", "sector", "Financials");
  });
});
