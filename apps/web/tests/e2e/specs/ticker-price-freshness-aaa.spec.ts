import { appPagesTest as test } from "@vakwen/test-e2e/fixtures";
import type { Locator } from "@playwright/test";
import type { DashboardOverviewDto, PriceStateDto } from "@vakwen/shared-types";

test.describe("ticker price freshness", () => {
  test("[ticker price freshness]: dashboard renders market summary, delayed/previous-close chips, and refresh-closes workflow", async ({
    dashboard,
    page,
  }) => {
    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 100, unitPrice: 500 });
    await dashboard.arrange.seedTrade({ ticker: "2317", quantity: 50, unitPrice: 100 });
    await dashboard.arrange.seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 995, high: 1005, low: 990, close: 1000, volume: 1000 },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-17", open: 1000, high: 1010, low: 998, close: 1005, volume: 1200 },
      { ticker: "2317", marketCode: "TW", barDate: "2026-06-16", open: 195, high: 202, low: 194, close: 200, volume: 1000 },
      { ticker: "2317", marketCode: "TW", barDate: "2026-06-17", open: 200, high: 205, low: 199, close: 202, volume: 1200 },
    ]);

    await page.route(/\/dashboard\/enrichment(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      const payload = await response.json() as DashboardOverviewDto;
      await route.fulfill({
        response,
        json: withDashboardPriceStates(payload),
      });
    });

    let refreshClosesPosts = 0;
    await page.route(/\/portfolio\/refresh-closes(?:\?|$)/, async (route) => {
      refreshClosesPosts += 1;
      if (route.request().method() !== "POST") {
        throw new Error(`Expected refresh-closes to use POST, got ${route.request().method()}`);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          items: [
            { ticker: "2330", marketCode: "TW", status: "current", date: "2026-06-17", source: "e2e" },
          ],
          summary: { refreshed: 0, current: 1, not_eligible: 0, missing: 0, failed: 0, queued: 0 },
        },
      });
    });

    await dashboard.actions.navigateToDashboard();
    await dashboard.assert.appIsReady();

    await assertVisible(page.getByTestId("dashboard-market-state-summary"), "dashboard market-state summary");
    await assertContainsText(page.getByTestId("dashboard-market-state-TW"), /TW/, "TW market-state chip");
    await assertContainsText(page.getByTestId("dashboard-market-state-TW"), /Open/i, "TW market-state chip");
    await assertContainsText(page.getByTestId("dashboard-price-state-2330-TW"), /Delayed/i, "delayed price chip");
    await assertContainsText(page.getByTestId("dashboard-price-state-2317-TW"), /Previous close/i, "previous-close price chip");

    const refreshResponse = page.waitForResponse((response) =>
      response.url().includes("/portfolio/refresh-closes") && response.request().method() === "POST",
    );
    await page.getByTestId("dashboard-refresh-closes-button").click();
    await refreshResponse;
    assertRefreshPostCount(refreshClosesPosts);
  });

  test("[ticker price freshness]: portfolio and ticker detail render daily price-state chips", async ({
    dashboard,
    page,
    portfolio,
    ticker,
  }) => {
    await dashboard.arrange.seedTrade({ ticker: "2330", quantity: 25, unitPrice: 500 });
    await dashboard.arrange.seedDailyBars([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-16", open: 990, high: 1005, low: 988, close: 1000, volume: 1000 },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-17", open: 1000, high: 1012, low: 998, close: 1010, volume: 1200 },
    ]);

    await portfolio.actions.navigateToPortfolio();
    await portfolio.assert.holdingsTableIsVisible();
    await assertContainsText(page.getByTestId("holdings-price-state-2330-TW"), /Closed|Stale|Previous close|Delayed|Updated/i, "portfolio price chip");

    await ticker.actions.navigateToTicker("2330");
    await ticker.assert.sectionIsVisible();
    await assertContainsText(page.getByTestId("ticker-price-state-chip"), /Closed|Stale|Previous close|Delayed|Updated/i, "ticker detail price chip");
  });
});

async function assertVisible(locator: Locator, description: string): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 10_000 }).catch((error: unknown) => {
    throw new Error(`Expected ${description} to be visible: ${String(error)}`);
  });
}

async function assertContainsText(locator: Locator, pattern: RegExp, description: string): Promise<void> {
  await assertVisible(locator, description);
  const text = await locator.textContent({ timeout: 10_000 });
  if (!pattern.test(text ?? "")) {
    throw new Error(`Expected ${description} to match ${pattern}, got ${JSON.stringify(text)}`);
  }
}

function assertRefreshPostCount(actual: number): void {
  if (actual !== 1) throw new Error(`Expected one refresh-closes POST, got ${actual}`);
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
    priceState: priceStateForTicker(holding.ticker),
  }));
  next.holdingGroups = next.holdingGroups.map((group) => ({
    ...group,
    priceState: priceStateForTicker(group.ticker),
    children: group.children.map((child) => ({
      ...child,
      priceState: priceStateForTicker(child.ticker),
    })),
  }));
  next.summary = {
    ...next.summary,
    priceStateRollup: {
      holdingCount: next.holdingGroups.length,
      currentPriceCount: 0,
      nonCurrentPriceCount: next.holdingGroups.length,
      missingPriceCount: 0,
      basisCounts: [
        { basis: "delayed_intraday", count: 1 },
        { basis: "previous_close", count: 1 },
      ],
    },
  };
  return next;
}

function priceStateForTicker(ticker: string): PriceStateDto {
  if (ticker === "2330") {
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
      quality: null,
    };
  }
  return {
    basis: "previous_close",
    chipState: "open_previous_close",
    marketState: "open",
    source: "finmind",
    sourceKind: "primary_daily",
    asOfDate: "2026-06-17",
    asOfTimestamp: null,
    observedAt: "2026-06-17T00:00:00.000Z",
    delaySeconds: null,
    marketTimeZone: "Asia/Taipei",
    quality: "full_bar",
  };
}
