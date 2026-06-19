import { appPagesTest as test } from "@vakwen/test-e2e/fixtures";
import { expect, type Locator, type Page } from "@playwright/test";
import type { DashboardOverviewDto, PriceStateDto } from "@vakwen/shared-types";
import { assertPriceChipDetailsPopover } from "./price-chip-popover-helpers";

const MD_BREAKPOINT_PX = 768;

test.describe("mobile ticker price freshness popovers", () => {
  test("[mobile-price-chip-A]: dashboard, portfolio, reports, and ticker chips open one in-viewport details popover", async ({
    appShell,
    dashboard,
    page,
    portfolio,
    ticker,
  }) => {
    test.setTimeout(60_000);
    const viewport = page.viewportSize();
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(
      !viewport || viewport.width >= MD_BREAKPOINT_PX,
      "Mobile-only - verifies the narrow chip popover path",
    );

    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 25, unitPrice: 500 });
    await dashboard.arrange.seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 990, high: 1005, low: 988, close: 1000, volume: 1000 },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-17", open: 1000, high: 1012, low: 998, close: 1010, volume: 1200 },
    ]);

    await page.route(/\/dashboard\/enrichment(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      const payload = await response.json() as DashboardOverviewDto;
      await route.fulfill({
        response,
        json: withDashboardPriceStates(payload),
      });
    });

    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await assertPriceChipDetailsPopover(
      page,
      page.getByTestId("dashboard-mobile-price-state-2330-TW"),
      "mobile dashboard price chip",
      "tap",
    );

    await portfolio.actions.navigateToPortfolio();
    await page.getByTestId("holdings-mobile-price-state-2330-TW").waitFor({ state: "visible" });
    await assertPriceChipDetailsPopover(
      page,
      page.getByTestId("holdings-mobile-price-state-2330-TW"),
      "mobile portfolio price chip",
      "tap",
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/reports?tab=portfolio&scope=all&range=1Y");
    await page.getByTestId("reports-page").waitFor({ state: "visible" });
    await assertPriceChipDetailsPopover(
      page,
      await resolveFirstVisibleReportsPriceChip(page, "reports-price-state-2330-TW"),
      "mobile reports price chip",
      "tap",
    );

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.sectionIsVisible();
    await assertPriceChipDetailsPopover(
      page,
      page.getByTestId("ticker-price-state-chip"),
      "mobile ticker detail price chip",
      "tap",
    );
  });
});

async function resolveFirstVisibleReportsPriceChip(page: Page, testId: string): Promise<Locator> {
  const chips = page.getByTestId(testId).filter({ visible: true });
  await expect
    .poll(async () => chips.count(), { message: `reports price chip ${testId} becomes visible` })
    .toBeGreaterThan(0);
  return chips.nth(0);
}

function withDashboardPriceStates(payload: DashboardOverviewDto): DashboardOverviewDto {
  const next: DashboardOverviewDto = structuredClone(payload);
  next.marketStates = [{
    marketCode: "TW",
    marketState: "open",
    asOf: "2026-06-17T02:00:00.000Z",
    marketTimeZone: "Asia/Taipei",
    regularSessionOnly: true,
  }];
  next.holdings = next.holdings.map((holding) => ({
    ...holding,
    priceState: priceState(),
  }));
  next.holdingGroups = next.holdingGroups.map((group) => ({
    ...group,
    priceState: priceState(),
    children: group.children.map((child) => ({
      ...child,
      priceState: priceState(),
    })),
  }));
  return next;
}

function priceState(): PriceStateDto {
  return {
    basis: "delayed_intraday",
    chipState: "open_delayed",
    marketState: "open",
    source: "yahoo-chart",
    sourceKind: "intraday_yahoo_chart",
    asOfDate: "2026-06-17",
    asOfTimestamp: "2026-06-17T01:10:00.000Z",
    observedAt: "2026-06-17T01:15:00.000Z",
    delaySeconds: 2100,
    marketTimeZone: "Asia/Taipei",
    quality: "full_bar",
  };
}
