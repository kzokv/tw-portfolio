import { test } from "@vakwen/test-e2e/fixtures/appPages";

function makeSectorFixture() {
  return [
    {
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK" as const,
      marketCode: "TW",
      barsBackfillStatus: "ready",
      industryCategoryRaw: "半導體業",
    },
    {
      ticker: "2882",
      name: "Cathay Financial",
      instrumentType: "STOCK" as const,
      marketCode: "TW",
      barsBackfillStatus: "ready",
      industryCategoryRaw: "金融保險業",
    },
    {
      ticker: "0050",
      name: "Yuanta Taiwan 50 ETF",
      instrumentType: "ETF" as const,
      marketCode: "TW",
      barsBackfillStatus: "ready",
      industryCategoryRaw: "ETF",
    },
    {
      ticker: "AAPL",
      name: "Apple Inc.",
      instrumentType: "STOCK" as const,
      marketCode: "US",
      barsBackfillStatus: "ready",
      industryCategoryRaw: "Computer Manufacturing",
    },
    {
      ticker: "JPM",
      name: "JPMorgan Chase & Co.",
      instrumentType: "STOCK" as const,
      marketCode: "US",
      barsBackfillStatus: "ready",
      industryCategoryRaw: "Major Banks",
    },
    {
      ticker: "BND",
      name: "Vanguard Total Bond Market ETF",
      instrumentType: "BOND_ETF" as const,
      marketCode: "US",
      barsBackfillStatus: "ready",
      industryCategoryRaw: "Investment Trusts/Mutual Funds",
    },
    {
      ticker: "CBA",
      name: "Commonwealth Bank of Australia",
      instrumentType: "STOCK" as const,
      marketCode: "AU",
      barsBackfillStatus: "ready",
      gicsIndustryGroup: "Banks",
    },
    {
      ticker: "7203",
      name: "Toyota Motor Corporation",
      instrumentType: "STOCK" as const,
      marketCode: "JP",
      barsBackfillStatus: "ready",
      industryCategoryRaw: "Common Stock",
    },
    {
      ticker: "1306",
      name: "NEXT FUNDS TOPIX Exchange Traded Fund",
      instrumentType: "ETF" as const,
      marketCode: "JP",
      barsBackfillStatus: "ready",
      industryCategoryRaw: "ETF",
    },
  ];
}

test.describe("normalized sector filter", () => {
  test.describe.configure({ mode: "default" });

  test("[TW]: all hides sector dropdown, TW shows it and filters normalized sectors", async ({
    appShell,
    settings,
  }) => {
    await settings.arrange.seedInstruments(makeSectorFixture());

    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();

    await settings.assert.sectorFilterIsHidden();

    await settings.actions.clickMarketChip("TW");
    await settings.assert.sectorFilterIsVisible();
    await settings.actions.selectSectorFilter("Information Technology");

    await settings.assert.catalogItemIsVisible("2330");
    await settings.assert.catalogItemIsHidden("2882");
    await settings.assert.catalogItemIsHidden("0050");
  });

  test("[US]: US sector filter narrows stock rows and keeps sectorless bond ETFs out", async ({
    appShell,
    settings,
  }) => {
    await settings.arrange.seedInstruments(makeSectorFixture());

    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();

    await settings.actions.clickMarketChip("US");
    await settings.assert.sectorFilterIsVisible();
    await settings.actions.selectSectorFilter("Information Technology");

    await settings.assert.catalogItemIsVisible("AAPL");
    await settings.assert.catalogItemIsHidden("JPM");
    await settings.assert.catalogItemIsHidden("BND");
  });

  test("[JP]: JP chip shows JPX catalog rows without sector narrowing", async ({
    appShell,
    settings,
  }) => {
    await settings.arrange.seedInstruments(makeSectorFixture());

    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.actions.openSettingsDrawer();
    await settings.actions.openTickersTab();
    await settings.actions.openCatalog();

    await settings.actions.clickMarketChip("JP");
    await settings.assert.sectorFilterIsHidden();
    await settings.assert.catalogItemIsVisible("7203");
    await settings.assert.catalogItemIsVisible("1306");
    await settings.assert.catalogItemIsHidden("2330");
    await settings.assert.catalogItemIsHidden("AAPL");
  });
});
