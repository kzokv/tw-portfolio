import type { Locator, Page } from "@playwright/test";
import type { DashboardOverviewDto, PriceStateDto } from "@vakwen/shared-types";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { seedAccountForUser } from "./helpers/sharing.js";

const MD_BREAKPOINT_PX = 768;

function uniqueTicker(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-5)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}

test.describe("mobile quote fallback EODHD", () => {
  test("[mobile-quote-fallback]: portfolio EODHD chip tap → opens source details in viewport", async ({
    dashboard,
    page,
    portfolio,
    settings,
    testUser,
  }) => {
    skipUnlessMobile(page);
    const ticker = uniqueTicker("EOD");
    const providerSymbol = `${ticker}.AU`;
    const account = await seedAccountForUser(testUser.userId, {
      name: `Mobile EODHD AUD ${ticker}`,
      defaultCurrency: "AUD",
    });

    await settings.arrange.seedInstruments([
      {
        ticker,
        name: "Mobile EODHD Fallback E2E",
        instrumentType: "ETF",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      },
    ]);
    await dashboard.arrange.seedTrade({
      accountId: account.id,
      ticker,
      marketCode: "AU",
      quantity: 40,
      unitPrice: 12,
      priceCurrency: "AUD",
      tradeDate: "2026-07-01",
    });
    await dashboard.arrange.seedDailyBars([
      { ticker, marketCode: "AU", barDate: "2026-07-02", open: 12.1, high: 12.4, low: 12.0, close: 12.34, volume: 1000 },
      { ticker, marketCode: "AU", barDate: "2026-07-03", open: 12.35, high: 12.6, low: 12.2, close: 12.56, volume: 1100 },
    ]);

    await page.route(/\/portfolio\/enrichment(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      const payload = await response.json() as DashboardOverviewDto;
      await route.fulfill({
        response,
        json: withFallbackPriceState(payload, ticker, providerSymbol),
      });
    });

    await portfolio.actions.navigateToPortfolio();
    await page.getByTestId(`holdings-mobile-price-state-${ticker}-AU`).waitFor({ state: "visible" });
    const chip = page.getByTestId(`holdings-mobile-price-state-${ticker}-AU`);
    await assertText(chip, /EODHD fallback/, "mobile EODHD fallback chip");
    await assertFallbackPriceChipPopover(page, chip, providerSymbol);
  });
});

function skipUnlessMobile(page: Page): void {
  const viewport = page.viewportSize();
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(
    !viewport || viewport.width >= MD_BREAKPOINT_PX,
    "Mobile-only - verifies the narrow EODHD fallback chip popover path",
  );
}

async function assertFallbackPriceChipPopover(page: Page, chip: Locator, providerSymbol: string): Promise<void> {
  await chip.tap();
  const popover = page
    .locator("[data-radix-popper-content-wrapper]")
    .filter({ hasText: "Basis:" });
  await popover.first().waitFor({ state: "visible" });
  const count = await popover.count();
  assertEqual(count, 1, "mobile EODHD fallback chip details popover count");
  await assertText(popover, /Fallback EOD close/, "mobile fallback popover basis");
  await assertText(popover, /EODHD EOD/, "mobile fallback popover source");
  await assertText(popover, new RegExp(escapeRegExp(providerSymbol)), "mobile fallback popover provider symbol");
  await assertText(popover, /Australia\/Sydney/, "mobile fallback popover time zone");
  await assertWithinViewport(page, popover, "mobile EODHD fallback popover");
  await page.keyboard.press("Escape");
  await popover.waitFor({ state: "hidden" });
}

async function assertWithinViewport(page: Page, locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) {
    throw new Error(`Could not measure ${label}`);
  }
  if (box.x < -1 || box.y < -1 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1) {
    throw new Error(`${label} overflows viewport: box=${JSON.stringify(box)}, viewport=${JSON.stringify(viewport)}`);
  }
}

async function assertText(locator: Locator, pattern: RegExp | string, description: string): Promise<void> {
  await locator.filter({ hasText: pattern }).waitFor({ state: "visible" }).catch((error: unknown) => {
    throw new Error(`Expected ${description} to match ${formatPattern(pattern)}: ${String(error)}`);
  });
  const text = await locator.textContent();
  if (!matchesText(text, pattern)) {
    throw new Error(`Expected ${description} to match ${formatPattern(pattern)}, got ${JSON.stringify(text)}`);
  }
}

function withFallbackPriceState(
  payload: DashboardOverviewDto,
  ticker: string,
  providerSymbol: string,
): DashboardOverviewDto {
  const next: DashboardOverviewDto = structuredClone(payload);
  next.marketStates = [{
    marketCode: "AU",
    marketState: "closed",
    asOf: "2026-07-03T06:00:00.000Z",
    marketTimeZone: "Australia/Sydney",
    regularSessionOnly: true,
  }];
  next.holdings = next.holdings.map((holding) => (
    holding.ticker === ticker && holding.marketCode === "AU"
      ? { ...holding, priceState: fallbackPriceState(providerSymbol) }
      : holding
  ));
  next.holdingGroups = next.holdingGroups.map((group) => ({
    ...group,
    priceState: group.ticker === ticker && group.marketCode === "AU"
      ? fallbackPriceState(providerSymbol)
      : group.priceState,
    children: group.children.map((child) => (
      child.ticker === ticker && child.marketCode === "AU"
        ? { ...child, priceState: fallbackPriceState(providerSymbol) }
        : child
    )),
  }));
  return next;
}

function fallbackPriceState(providerSymbol: string): PriceStateDto {
  return {
    basis: "fallback_eod_close",
    chipState: "fallback_eod",
    marketState: "closed",
    marketStateReason: "market_closed",
    source: "EODHD",
    sourceKind: "eodhd_eod",
    sourceId: "eodhd",
    providerSymbol,
    yahooSymbol: null,
    asOfDate: "2026-07-03",
    asOfTimestamp: null,
    observedAt: "2026-07-03T08:30:00.000Z",
    delaySeconds: null,
    marketTimeZone: "Australia/Sydney",
    quality: "close_only",
    marketLocalDate: "2026-07-03",
    calendarStatus: "confirmed",
    refreshCadenceMinutes: null,
    latestIntradayAttempt: null,
    latestRefreshAttemptAt: "2026-07-03T08:30:00.000Z",
    latestRefreshOutcome: "success",
  };
}

function assertEqual<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${description} to be ${String(expected)}, got ${String(actual)}`);
  }
}

function matchesText(text: string | null, pattern: RegExp | string): boolean {
  if (!text) return false;
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
}

function formatPattern(pattern: RegExp | string): string {
  return typeof pattern === "string" ? JSON.stringify(pattern) : String(pattern);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
