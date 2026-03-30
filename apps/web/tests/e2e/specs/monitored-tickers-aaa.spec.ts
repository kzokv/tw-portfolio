import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

const INSTRUMENTS = [
  { ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
  { ticker: "2317", name: "Hon Hai Precision", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
  { ticker: "0050", name: "Yuanta/P-shares Taiwan Top 50 ETF", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "pending" },
  { ticker: "0056", name: "Yuanta/P-shares Taiwan Dividend Plus ETF", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "ready" },
  { ticker: "00679B", name: "Cathay US Treasury Bond 1-3Y ETF", instrumentType: "BOND_ETF", marketCode: "TW", barsBackfillStatus: "pending" },
];

test.describe("monitored tickers", () => {
  test.describe.configure({ mode: "default" });

  test("tickers tab: renders with empty state when no selections exist", async ({
    appShell,
    settings,
  }) => {
    // ARRANGE
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();

    // ASSERT
    await settings.assert.tickersSectionIsVisible();
    await settings.assert.tickersEmptyStateIsVisible();
    await settings.assert.tickersSaveButtonIsDisabled();
  });

  test("catalog: browse → select → back preserves selections in tickers tab", async ({
    appShell,
    settings,
  }) => {
    // ARRANGE
    await settings.arrange.seedInstruments(INSTRUMENTS);
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();

    // ACT — open catalog
    await settings.actions.openCatalog();

    // ASSERT — catalog visible with instruments
    await settings.assert.catalogIsVisible();
    await settings.assert.catalogItemIsVisible("2330");
    await settings.assert.catalogItemIsVisible("0050");

    // ACT — select two instruments
    await settings.actions.toggleCatalogItem("2330");
    await settings.actions.toggleCatalogItem("0050");

    // ASSERT — checkboxes are checked
    await settings.assert.catalogItemIsChecked("2330");
    await settings.assert.catalogItemIsChecked("0050");

    // ACT — go back to tickers tab
    await settings.actions.closeCatalog();

    // ASSERT — selections visible in tickers tab
    await settings.assert.catalogIsHidden();
    await settings.assert.manualTickerIsVisible("2330");
    await settings.assert.manualTickerIsVisible("0050");
  });

  test("catalog: save selections → persist after drawer close and reopen", async ({
    appShell,
    settings,
  }) => {
    // ARRANGE
    await settings.arrange.seedInstruments(INSTRUMENTS);
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();

    // ACT — open catalog, select, go back, save
    await settings.actions.openCatalog();
    await settings.actions.toggleCatalogItem("2317");
    await settings.actions.closeCatalog();
    await settings.actions.saveTickers();

    // ASSERT — saved confirmation
    await settings.assert.tickersSavedMessageIsVisible();
    await settings.assert.tickersSaveButtonIsDisabled();

    // ACT — close and reopen drawer
    await settings.actions.closeWithEscape();
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();

    // ASSERT — selection persists
    await settings.assert.manualTickerIsVisible("2317");
  });

  test("catalog: search filters instruments by ticker and name", async ({
    appShell,
    settings,
  }) => {
    // ARRANGE
    await settings.arrange.seedInstruments(INSTRUMENTS);
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();

    // ACT — search by ticker
    await settings.actions.searchCatalog("233");

    // ASSERT — only TSMC visible
    await settings.assert.catalogItemIsVisible("2330");
    await settings.assert.catalogItemIsHidden("2317");
    await settings.assert.catalogItemIsHidden("0050");

    // ACT — search by name
    await settings.actions.searchCatalog("hon hai");

    // ASSERT — only Hon Hai visible
    await settings.assert.catalogItemIsVisible("2317");
    await settings.assert.catalogItemIsHidden("2330");
  });

  test("catalog: type filter narrows instruments by category", async ({
    appShell,
    settings,
  }) => {
    // ARRANGE
    await settings.arrange.seedInstruments(INSTRUMENTS);
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();

    // ACT — filter to ETF only
    await settings.actions.filterCatalogByType("etf");

    // ASSERT — only ETFs visible
    await settings.assert.catalogItemIsVisible("0050");
    await settings.assert.catalogItemIsVisible("0056");
    await settings.assert.catalogItemIsHidden("2330");
    await settings.assert.catalogItemIsHidden("00679B");

    // ACT — filter to Bond ETF
    await settings.actions.filterCatalogByType("bond_etf");

    // ASSERT — only Bond ETF visible
    await settings.assert.catalogItemIsVisible("00679B");
    await settings.assert.catalogItemIsHidden("0050");
  });
});
