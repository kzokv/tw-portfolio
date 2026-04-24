import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

// Synthetic tickers per .claude/rules/e2e-shared-memory-bars-ticker-hygiene.md.
// MemoryPersistence holds daily bars in a process-global array; reusing real
// tickers (2330, 2317, 0050) would collide with sibling specs.

test("[transactions form]: exact market-data match → unit price pre-fills and hint renders", async ({
  appShell,
  dashboard,
  settings,
  transactions,
}) => {
  await settings.arrange.seedInstruments([
    { ticker: "8301", name: "Synthetic Stock 8301", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
  ]);
  await dashboard.arrange.seedDailyBars([
    { ticker: "8301", barDate: "2026-01-15", open: 998, high: 1008, low: 995, close: 1005, volume: 100_000 },
  ]);

  await appShell.actions.navigateToRoute("/transactions");
  await transactions.actions.selectFirstAccount();
  await transactions.actions.typeInTickerSearch("8301");
  await transactions.actions.selectTickerOption("8301");
  const priceLookup = transactions.actions.waitForPriceLookup();
  await transactions.actions.fillTradeDate("2026-01-15");

  await priceLookup;
  await transactions.assert.unitPriceValueEquals("1005");
  await transactions.assert.priceSourceHintIsVisible();
});

test("[transactions form]: weekend fallback → previous close pre-fills", async ({
  appShell,
  dashboard,
  settings,
  transactions,
}) => {
  await settings.arrange.seedInstruments([
    { ticker: "8302", name: "Synthetic Stock 8302", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
  ]);
  await dashboard.arrange.seedDailyBars([
    { ticker: "8302", barDate: "2026-01-16", open: 998, high: 1008, low: 995, close: 1002, volume: 100_000 },
  ]);

  await appShell.actions.navigateToRoute("/transactions");
  await transactions.actions.selectFirstAccount();
  await transactions.actions.typeInTickerSearch("8302");
  await transactions.actions.selectTickerOption("8302");
  const priceLookup = transactions.actions.waitForPriceLookup();
  await transactions.actions.fillTradeDate("2026-01-18");

  await priceLookup;
  await transactions.assert.unitPriceValueEquals("1002");
  await transactions.assert.priceSourceHintIsVisible();
});

test("[transactions form]: no price in db or provider window → unavailable hint renders", async ({
  appShell,
  settings,
  transactions,
}) => {
  await settings.arrange.seedInstruments([
    { ticker: "8303", name: "Synthetic Stock 8303", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
  ]);

  await appShell.actions.navigateToRoute("/transactions");
  await transactions.actions.selectFirstAccount();
  await transactions.actions.typeInTickerSearch("8303");
  await transactions.actions.selectTickerOption("8303");
  const priceLookup = transactions.actions.waitForPriceLookup();
  await transactions.actions.fillTradeDate("2026-03-10");

  await priceLookup;
  await transactions.assert.priceUnavailableHintIsVisible();
  await transactions.assert.commissionEstimateIsHidden();
});
