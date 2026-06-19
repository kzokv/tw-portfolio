import { appPagesTest as test } from "@vakwen/test-e2e/fixtures";
import type { DashboardOverviewDto, PriceStateDto } from "@vakwen/shared-types";
import type { Page } from "@playwright/test";
import { assertPriceChipDetailsPopover, resolveFirstVisibleByTestId } from "./price-chip-popover-helpers";

const MD_BREAKPOINT_PX = 768;
const TEST_TRADE = { ticker: "2330", quantity: 25, unitPrice: 500 };
const TEST_DAILY_BARS = [
  { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 990, high: 1005, low: 988, close: 1000, volume: 1000 },
  { ticker: "2330", marketCode: "TW", barDate: "2026-06-17", open: 1000, high: 1012, low: 998, close: 1010, volume: 1200 },
] satisfies Array<{
  ticker: string;
  marketCode: "TW" | "US" | "AU";
  barDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>;

test.describe("mobile ticker price freshness popovers", () => {
  test("[mobile-price-chip-A1]: dashboard chip opens one in-viewport details popover", async ({
    dashboard,
    page,
  }) => {
    skipUnlessMobile(page);
    await arrangeMobilePriceFixture(
      page,
      () => dashboard.arrange.seedTrade(TEST_TRADE),
      () => dashboard.arrange.seedDailyBars(TEST_DAILY_BARS),
    );

    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();
    await assertPriceChipDetailsPopover(
      page,
      page.getByTestId("dashboard-mobile-price-state-2330-TW"),
      "mobile dashboard price chip",
      "tap",
    );
  });

  test("[mobile-price-chip-A2]: portfolio chip opens one in-viewport details popover", async ({
    dashboard,
    page,
    portfolio,
  }) => {
    skipUnlessMobile(page);
    await arrangeMobilePriceFixture(
      page,
      () => dashboard.arrange.seedTrade(TEST_TRADE),
      () => dashboard.arrange.seedDailyBars(TEST_DAILY_BARS),
    );

    await portfolio.actions.navigateToPortfolio();
    await page.getByTestId("holdings-mobile-price-state-2330-TW").waitFor({ state: "visible" });
    await assertPriceChipDetailsPopover(
      page,
      page.getByTestId("holdings-mobile-price-state-2330-TW"),
      "mobile portfolio price chip",
      "tap",
    );
  });

  test("[mobile-price-chip-A3]: reports chip opens one in-viewport details popover", async ({
    appShell,
    dashboard,
    page,
  }) => {
    skipUnlessMobile(page);
    await arrangeMobilePriceFixture(
      page,
      () => dashboard.arrange.seedTrade(TEST_TRADE),
      () => dashboard.arrange.seedDailyBars(TEST_DAILY_BARS),
    );

    await appShell.actions.navigateToRouteForResponsiveTest("/reports?tab=portfolio&scope=all&range=1Y");
    await page.getByTestId("reports-page").waitFor({ state: "visible" });
    await assertPriceChipDetailsPopover(
      page,
      await resolveFirstVisibleByTestId(page, "reports-price-state-2330-TW", "mobile reports price chip"),
      "mobile reports price chip",
      "tap",
    );
  });

  test("[mobile-price-chip-A4]: ticker detail chip opens one in-viewport details popover", async ({
    dashboard,
    page,
    ticker,
  }) => {
    skipUnlessMobile(page);
    await arrangeMobilePriceFixture(
      page,
      () => dashboard.arrange.seedTrade(TEST_TRADE),
      () => dashboard.arrange.seedDailyBars(TEST_DAILY_BARS),
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

function skipUnlessMobile(page: Page): void {
  const viewport = page.viewportSize();
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(
    !viewport || viewport.width >= MD_BREAKPOINT_PX,
    "Mobile-only - verifies the narrow chip popover path",
  );
}

async function arrangeMobilePriceFixture(
  page: Page,
  seedTrade: () => Promise<unknown>,
  seedDailyBars: () => Promise<unknown>,
): Promise<void> {
  await seedTrade();
  await seedDailyBars();
  await page.route(/\/dashboard\/enrichment(?:\?|$)/, async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as DashboardOverviewDto;
    await route.fulfill({
      response,
      json: withDashboardPriceStates(payload),
    });
  });
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
