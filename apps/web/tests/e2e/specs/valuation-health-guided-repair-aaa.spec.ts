import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { TestEnv } from "@vakwen/config/test";
import type { DashboardPerformanceDto } from "@vakwen/shared-types";
import type { APIRequestContext } from "@playwright/test";
import {
  seedResolvedShareFromAdmin,
  seedUser,
  switchIdentity,
} from "./helpers/sharing";

const VRT_US = {
  ticker: "VRT",
  name: "Vertiv Holdings Co",
  instrumentType: "STOCK" as const,
  marketCode: "US" as const,
  barsBackfillStatus: "ready",
};

const staleUsPerformance: DashboardPerformanceDto = {
  range: "1M",
  rangeStartDate: "2026-05-13",
  rangeEndDate: "2026-06-13",
  reportingCurrency: "TWD",
  fxStatus: "complete",
  requestedAsOf: "2026-06-13",
  lastReliableDate: "2026-06-12",
  diagnostics: {
    latestSnapshotDate: "2026-06-13",
    latestReliableValuationDate: "2026-06-12",
    latestComparableSnapshotDate: "2026-06-12",
    latestPartialSnapshotDate: "2026-06-13",
    hasPartialMarketData: true,
    expectedLatestValuationDate: "2026-06-13",
    staleSinceDate: null,
    knownGapReasons: ["stale_snapshot"],
  },
  points: [
    {
      date: "2026-06-12",
      totalCostAmount: 900,
      marketValueAmount: 1100,
      unrealizedPnlAmount: 200,
      cumulativeRealizedPnlAmount: 0,
      cumulativeDividendsAmount: 0,
      totalReturnAmount: 200,
      totalReturnPercent: 22.2,
      fxAvailable: true,
    },
    {
      date: "2026-06-13",
      totalCostAmount: 900,
      marketValueAmount: 1200,
      unrealizedPnlAmount: 300,
      cumulativeRealizedPnlAmount: 0,
      cumulativeDividendsAmount: 0,
      totalReturnAmount: 300,
      totalReturnPercent: 33.3,
      fxAvailable: true,
      isPartialMarketData: true,
      missingContributorKeys: ["acc-us|US|V"],
    },
  ],
  valuationHealth: {
    status: "material",
    reason: "missing_snapshot_value",
    reportingCurrency: "TWD",
    currentValueAmount: 1200,
    snapshotValueAmount: 1100,
    deltaAmount: 100,
    relativeDeltaBps: 833,
    minorUnitTolerance: 1,
    thresholds: {
      relativeBps: 50,
      absoluteAud: 10,
      absoluteUsd: 10,
      absoluteTwd: 300,
      absoluteKrw: 9000,
    },
    latestBarAsOf: "2026-06-13",
    latestSnapshotDate: "2026-06-12",
    latestUsableSnapshotDate: "2026-06-12",
    latestComparableSnapshotDate: "2026-06-12",
    latestPartialSnapshotDate: "2026-06-13",
    expectedLatestValuationDate: "2026-06-13",
    title: "Market data out of sync",
    marketFreshness: [{
      marketCode: "US",
      latestBarDate: "2026-06-13",
      latestSnapshotDate: "2026-06-12",
      staleTickerCount: 1,
      missingTickerCount: 0,
    }],
    affectedHoldings: [{
      ticker: "VRT",
      marketCode: "US",
      currentReportingValueAmount: 1200,
      latestBarDate: "2026-06-13",
      latestSnapshotDate: "2026-06-12",
      backfillStatus: "ready",
      status: "stale_snapshot",
      recommendedAction: "run_snapshot_repair",
    }],
    recommendedActions: ["run_snapshot_repair"],
  },
};

const sharedAudPerformance: DashboardPerformanceDto = {
  range: "1M",
  rangeStartDate: "2026-05-13",
  rangeEndDate: "2026-06-13",
  reportingCurrency: "AUD",
  fxStatus: "complete",
  requestedAsOf: "2026-06-13",
  lastReliableDate: "2026-06-13",
  diagnostics: {
    latestSnapshotDate: "2026-06-13",
    latestReliableValuationDate: "2026-06-13",
    latestComparableSnapshotDate: "2026-06-13",
    latestPartialSnapshotDate: null,
    hasPartialMarketData: false,
    expectedLatestValuationDate: "2026-06-13",
    staleSinceDate: null,
    knownGapReasons: [],
  },
  points: [
    {
      date: "2026-06-12",
      totalCostAmount: 1000,
      marketValueAmount: 1250,
      unrealizedPnlAmount: 250,
      cumulativeRealizedPnlAmount: 0,
      cumulativeDividendsAmount: 0,
      totalReturnAmount: 250,
      totalReturnPercent: 25,
      fxAvailable: true,
    },
    {
      date: "2026-06-13",
      totalCostAmount: 1000,
      marketValueAmount: 1321.45,
      unrealizedPnlAmount: 321.45,
      cumulativeRealizedPnlAmount: 0,
      cumulativeDividendsAmount: 0,
      totalReturnAmount: 321.45,
      totalReturnPercent: 32.145,
      fxAvailable: true,
    },
  ],
  valuationHealth: {
    status: "healthy",
    reason: "within_threshold",
    reportingCurrency: "AUD",
    currentValueAmount: 1321.45,
    snapshotValueAmount: 1321.45,
    deltaAmount: 0,
    relativeDeltaBps: 0,
    minorUnitTolerance: 0.01,
    thresholds: {
      relativeBps: 50,
      absoluteAud: 10,
      absoluteUsd: 10,
      absoluteTwd: 300,
      absoluteKrw: 9000,
    },
    latestBarAsOf: "2026-06-13",
    latestSnapshotDate: "2026-06-13",
    latestUsableSnapshotDate: "2026-06-13",
    latestComparableSnapshotDate: "2026-06-13",
    latestPartialSnapshotDate: null,
    expectedLatestValuationDate: "2026-06-13",
    affectedHoldings: [],
    recommendedActions: [],
  },
};

async function seedReportingCurrencyPreference(
  request: APIRequestContext,
  userId: string,
  reportingCurrency: "TWD" | "USD" | "AUD" | "KRW",
): Promise<void> {
  const response = await request.post(new URL("/__e2e/seed-user-preferences", TestEnv.apiBaseUrl).href, {
    data: { userId, preferences: { reportingCurrency } },
    headers: { "x-user-id": userId },
  });
  if (!response.ok()) {
    throw new Error(`seed-user-preferences failed: ${response.status()} ${await response.text()}`);
  }
}

test("[valuation-health-A]: non-admin Portfolio Trend mismatch details copy admin-help deep link", async ({
  appShell,
  dashboard,
  e2eUserId,
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as Window & { __copiedAdminHelp?: string }).__copiedAdminHelp = text;
        },
      },
    });
  });
  await page.route(/\/dashboard\/performance\?range=1M$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(staleUsPerformance),
    });
  });
  const reset = await request.post(new URL("/__e2e/reset", TestEnv.apiBaseUrl).href, {
    headers: { "x-user-id": e2eUserId, "x-user-role": "member" },
  });
  await appShell.assert.mxAssertEqual(reset.ok(), true, "member reset response");
  await switchIdentity(page, { userId: e2eUserId, role: "member" });

  await appShell.actions.setViewport(1440, 960);
  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();

  const trendCard = page.getByTestId("dashboard-performance-card");
  await trendCard.waitFor({ state: "visible" });
  await trendCard.getByText("Market data out of sync").waitFor({ state: "visible" });
  await page.getByTestId("dashboard-performance-partial-marker").waitFor({ state: "visible" });
  await page.getByTestId("valuation-health-market-freshness").getByText("US").waitFor({ state: "visible" });
  await page.getByTestId("valuation-health-user-tip").getByText("Admin repair required").waitFor({ state: "visible" });
  await appShell.assert.mxAssertEqual(
    await page.getByTestId("valuation-health-admin-repair-US").count(),
    0,
    "viewer admin repair action count",
  );

  await page.getByTestId("valuation-health-copy-admin-link-US").click();

  const copied = await page.evaluate(() => (window as Window & { __copiedAdminHelp?: string }).__copiedAdminHelp ?? "");
  await appShell.assert.mxAssertIncludes(copied, "Market: US", "copied admin-help market");
  await appShell.assert.mxAssertIncludes(copied, "Tickers: VRT", "copied admin-help tickers");
  await appShell.assert.mxAssertIncludes(copied, "/admin/market-data/US/backfill?repair=valuation", "copied admin-help route");
  await appShell.assert.mxAssertIncludes(copied, "targetDate=2026-06-13", "copied admin-help target date");
});

test("[valuation-health-B]: admin guided repair deep link prefills market tickers target date and range", async ({
  appShell,
  settings,
  page,
}) => {
  await settings.arrange.seedInstruments([VRT_US]);

  await appShell.actions.navigateToRoute(
    "/admin/market-data/US/backfill?repair=valuation&tickers=VRT&targetDate=2026-06-13&fromDate=2026-06-12&startDate=2026-06-12&endDate=2026-06-13",
  );
  await appShell.assert.appIsReady();

  const repairCard = page.getByTestId("market-data-snapshot-repair");
  await repairCard.waitFor({ state: "visible" });
  await repairCard.getByText("Guided valuation repair").waitFor({ state: "visible" });
  await repairCard.getByText("US", { exact: true }).waitFor({ state: "visible" });
  await repairCard.getByText("VRT", { exact: true }).first().waitFor({ state: "visible" });
  await repairCard.getByText("2026-06-13").first().waitFor({ state: "visible" });
  await repairCard.getByText("2026-06-12 to 2026-06-13").waitFor({ state: "visible" });
  await repairCard.getByRole("button", { name: "Preview guided backfill" }).waitFor({ state: "visible" });
});

test("[valuation-health-C]: delegated Portfolio Trend keeps owner context reporting currency", async ({
  appShell,
  page,
  request,
  sharing,
}) => {
  const owner = await seedUser({
    sub: "e2e-shared-trend-owner-sub",
    email: "shared-trend-owner@example.com",
    name: "Shared Trend Owner",
    role: "admin",
  });
  const delegate = await seedUser({
    sub: "e2e-shared-trend-delegate-sub",
    email: "shared-trend-delegate@example.com",
    name: "Shared Trend Delegate",
    role: "member",
  });
  await seedReportingCurrencyPreference(request, owner.userId, "AUD");
  await seedReportingCurrencyPreference(request, delegate.userId, "TWD");
  const { shareId } = await seedResolvedShareFromAdmin(delegate.email, owner.userId);
  await page.route(/\/dashboard\/performance\?range=1M$/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(sharedAudPerformance),
    });
  });

  await switchIdentity(page, { userId: delegate.userId, role: "member" });
  await sharing.actions.navigateToSharing();
  await appShell.assert.appIsReady();
  await page.getByRole("tab", { name: /Inbound/ }).click();
  const openSharedDashboard = page.getByTestId(`sharing-open-dashboard-${shareId}`);
  await openSharedDashboard.scrollIntoViewIfNeeded();
  await openSharedDashboard.click();
  await appShell.assert.appIsReady();

  const trendCard = page.getByTestId("dashboard-performance-card");
  await trendCard.waitFor({ state: "visible" });
  await trendCard.getByText("A$1,321.45").first().waitFor({ state: "visible" });
  await trendCard.getByText("Healthy").first().waitFor({ state: "visible" });
  await appShell.assert.mxAssertEqual(
    await trendCard.getByText("NT$1,321.45").count(),
    0,
    "delegate preference TWD must not render Portfolio Trend value",
  );
});
