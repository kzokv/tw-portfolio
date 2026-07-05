import type { Locator, Page, Response } from "@playwright/test";
import type { DashboardOverviewDto, PriceStateDto, QuoteFallbackPolicyDto } from "@vakwen/shared-types";
import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { seedAccountForUser } from "./helpers/sharing.js";

function uniqueTicker(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-5)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}

test.describe("quote fallback EODHD", () => {
  test("[quote-fallback-admin]: AU instrument drawer save/refresh/deactivate → controls update status", async ({
    appShell,
    page,
    settings,
  }) => {
    const ticker = uniqueTicker("EOD");
    const providerSymbol = `${ticker}.AU`;
    const refreshedPolicy = quoteFallbackPolicy(ticker, providerSymbol, {
      latestSnapshotClose: 12.56,
      previousClose: 12.34,
      lastRefreshAt: "2026-07-03T08:30:00.000Z",
      marketDate: "2026-07-03",
    });
    let refreshPosts = 0;
    await page.route(/\/admin\/market-data\/AU\/quote-fallback-policies\/refresh(?:\?|$)/, async (route) => {
      refreshPosts += 1;
      if (route.request().method() !== "POST") {
        throw new Error(`Expected quote fallback refresh POST, got ${route.request().method()}`);
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: {
          policy: refreshedPolicy,
          refreshed: false,
          remainingCalls: 19,
          message: "Refresh queued.",
        },
      });
    });

    await settings.arrange.seedInstruments([
      {
        ticker,
        name: "EODHD Fallback E2E",
        instrumentType: "ETF",
        marketCode: "AU",
        barsBackfillStatus: "ready",
      },
    ]);

    await appShell.actions.navigateToRoute(`/admin/market-data/AU/instruments?search=${ticker}`);
    await appShell.assert.appIsReady();
    const instrumentsPanel = page.getByTestId("market-data-instruments");
    await instrumentsPanel.waitFor({ state: "visible" });
    await instrumentsPanel.getByTestId(`market-data-instrument-row-${ticker}`).click();

    const drawer = page.getByTestId("ui-drawer");
    await assertText(drawer, new RegExp(`${ticker} details`), "instrument drawer title");
    await assertVisible(drawer.getByText("Quote fallback policy"), "quote fallback policy section");
    await assertInputValue(
      drawer.getByTestId("market-data-fallback-provider-symbol-input"),
      providerSymbol,
      "fallback provider symbol input",
    );
    await assertDisabled(drawer.getByTestId("market-data-fallback-policy-refresh"), "fallback refresh button before save");

    const [saveResponse] = await Promise.all([
      page.waitForResponse((response) =>
      response.url().includes("/admin/market-data/AU/quote-fallback-policies/upsert")
      && response.request().method() === "POST",
      ),
      drawer.getByTestId("market-data-fallback-policy-save").click(),
    ]);
    assertResponseOk(saveResponse, "quote fallback policy save");
    await assertText(
      drawer.getByTestId("market-data-fallback-policy-status"),
      /Quote fallback policy saved\./,
      "fallback save status",
    );
    await assertVisible(drawer.getByText("Pending"), "fallback pending state");
    await assertEnabled(drawer.getByTestId("market-data-fallback-policy-refresh"), "fallback refresh button after save");

    await drawer.getByTestId("market-data-fallback-policy-refresh").click();
    await assertText(
      drawer.getByTestId("market-data-fallback-policy-status"),
      /Refresh queued\. 19 calls remaining today\./,
      "fallback refresh status",
    );
    await assertText(drawer, /AUD 12\.5600 · 2026-07-03/, "fallback latest close");
    assertEqual(refreshPosts, 1, "fallback refresh POST count");

    const [deactivateResponse] = await Promise.all([
      page.waitForResponse((response) =>
      response.url().includes("/admin/market-data/AU/quote-fallback-policies/deactivate")
      && response.request().method() === "POST",
      ),
      drawer.getByTestId("market-data-fallback-policy-deactivate").click(),
    ]);
    assertResponseOk(deactivateResponse, "quote fallback policy deactivate");
    await assertText(
      drawer.getByTestId("market-data-fallback-policy-status"),
      /Quote fallback policy deactivated\./,
      "fallback deactivate status",
    );
    await assertVisible(drawer.getByText("Inactive"), "fallback inactive state");
  });

  test("[quote-fallback-visibility]: portfolio EODHD fallback chip → shows source and provider symbol", async ({
    dashboard,
    page,
    portfolio,
    settings,
    testUser,
  }) => {
    const ticker = uniqueTicker("EOD");
    const providerSymbol = `${ticker}.AU`;
    const account = await seedAccountForUser(testUser.userId, {
      name: `EODHD AUD ${ticker}`,
      defaultCurrency: "AUD",
    });

    await settings.arrange.seedInstruments([
      {
        ticker,
        name: "EODHD Portfolio Fallback E2E",
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
    await portfolio.assert.holdingsTableIsVisible();
    const chip = page.getByTestId(`holdings-price-state-${ticker}-AU`);
    await assertText(chip, /EODHD fallback/, "portfolio EODHD fallback chip");
    await assertFallbackPriceChipPopover(page, chip, providerSymbol);
  });
});

async function assertFallbackPriceChipPopover(page: Page, chip: Locator, providerSymbol: string): Promise<void> {
  await chip.hover();
  const popover = page
    .locator("[data-radix-popper-content-wrapper]")
    .filter({ hasText: "Basis:" });
  await popover.first().waitFor({ state: "visible" });
  const count = await popover.count();
  assertEqual(count, 1, "EODHD fallback chip details popover count");
  await assertText(popover, /Fallback EOD close/, "fallback popover basis");
  await assertText(popover, /EODHD EOD/, "fallback popover source");
  await assertText(popover, new RegExp(escapeRegExp(providerSymbol)), "fallback popover provider symbol");
  await assertText(popover, /Australia\/Sydney/, "fallback popover time zone");
  await page.keyboard.press("Escape");
  await popover.waitFor({ state: "hidden" });
}

async function assertVisible(locator: Locator, description: string): Promise<void> {
  await locator.waitFor({ state: "visible" }).catch((error: unknown) => {
    throw new Error(`Expected ${description} to be visible: ${String(error)}`);
  });
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

async function assertInputValue(locator: Locator, expected: string, description: string): Promise<void> {
  await assertVisible(locator, description);
  const actual = await locator.inputValue();
  if (actual !== expected) {
    throw new Error(`Expected ${description} value ${expected}, got ${actual}`);
  }
}

async function assertDisabled(locator: Locator, description: string): Promise<void> {
  await assertVisible(locator, description);
  if (!(await locator.isDisabled())) {
    throw new Error(`Expected ${description} to be disabled`);
  }
}

async function assertEnabled(locator: Locator, description: string): Promise<void> {
  await assertVisible(locator, description);
  if (!(await locator.isEnabled())) {
    throw new Error(`Expected ${description} to be enabled`);
  }
}

function assertResponseOk(response: Response, description: string): void {
  if (!response.ok()) {
    throw new Error(`Expected ${description} response to be ok, got ${response.status()} ${response.statusText()}`);
  }
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

function quoteFallbackPolicy(
  ticker: string,
  providerSymbol: string,
  snapshot: {
    latestSnapshotClose: number;
    previousClose: number;
    lastRefreshAt: string;
    marketDate: string;
  },
): QuoteFallbackPolicyDto {
  return {
    id: `policy-${ticker}`,
    marketCode: "AU",
    ticker,
    provider: "eodhd",
    priceType: "eod_close",
    providerSymbol,
    active: true,
    reason: null,
    createdAt: "2026-07-03T08:00:00.000Z",
    updatedAt: snapshot.lastRefreshAt,
    deactivatedAt: null,
    lastRefreshStatus: "success",
    lastRefreshAt: snapshot.lastRefreshAt,
    lastRefreshError: null,
    lastRefreshErrorCode: null,
    latestSnapshot: {
      id: `snapshot-${ticker}`,
      policyId: `policy-${ticker}`,
      marketCode: "AU",
      ticker,
      provider: "eodhd",
      priceType: "eod_close",
      providerSymbol,
      marketDate: snapshot.marketDate,
      close: snapshot.latestSnapshotClose,
      previousClose: snapshot.previousClose,
      currency: "AUD",
      currencySource: "provider",
      source: "EODHD",
      fetchedAt: snapshot.lastRefreshAt,
      providerMetadata: {},
      createdAt: snapshot.lastRefreshAt,
    },
  };
}
