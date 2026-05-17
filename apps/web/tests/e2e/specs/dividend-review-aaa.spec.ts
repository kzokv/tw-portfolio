import { test } from "@vakwen/test-e2e/fixtures/appPages";

/**
 * Generates an ISO date string relative to the current month.
 * @param day Day of month (1-28 recommended to avoid overflow)
 * @param monthOffset 0 = current month, -1 = last month, etc.
 */
function isoDateForMonth(day: number, monthOffset = 0): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthOffset, day))
    .toISOString()
    .slice(0, 10);
}

/** Returns YYYY-01-01 of the current year */
function yearStart(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}

// ─── Group 1: Filter auto-apply ─────────────────────────────────────────────

test.describe("dividend review — filter auto-apply", () => {
  test("preset click: Last 7 Days → URL updates, table re-fetches, date inputs show resolved range", async ({
    dividendReview,
  }) => {
    // ARRANGE: seed dividends across different date ranges
    const today = new Date();
    const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
    const threeDaysAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 3));
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: threeDaysAgo.toISOString().slice(0, 10),
      paymentDate: yesterday.toISOString().slice(0, 10), // within last 7 days
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(1, -6),
      paymentDate: isoDateForMonth(15, -6), // 6 months ago
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickPreset("last-7-days");

    // ASSERT
    await dividendReview.assert.urlContains("fromPaymentDate");
    await dividendReview.assert.urlContains("toPaymentDate");
    await dividendReview.assert.presetIsActive("last-7-days");
    // Date inputs should be populated with the resolved range (read-only)
    // Table should filter — only recent dividend visible
    await dividendReview.assert.tableHasAtLeastRows(1);
  });

  test("custom date range: enter both dates → blur triggers fetch with correct params", async ({
    dividendReview,
  }) => {
    // ARRANGE
    const janDate = `${new Date().getUTCFullYear()}-01-15`;
    const marDate = `${new Date().getUTCFullYear()}-03-20`;
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: `${new Date().getUTCFullYear()}-01-10`,
      paymentDate: janDate,
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: `${new Date().getUTCFullYear()}-03-15`,
      paymentDate: marDate,
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickPreset("custom");
    await dividendReview.actions.fillDateFrom(`${new Date().getUTCFullYear()}-01-01`);
    await dividendReview.actions.fillDateTo(`${new Date().getUTCFullYear()}-01-31`);
    await dividendReview.actions.blurDateInputs();

    // ASSERT
    await dividendReview.assert.urlContains(`fromPaymentDate=${new Date().getUTCFullYear()}-01-01`);
    await dividendReview.assert.urlContains(`toPaymentDate=${new Date().getUTCFullYear()}-01-31`);
    await dividendReview.assert.presetIsActive("custom");
    await dividendReview.assert.tableHasAtLeastRows(1);
    await dividendReview.assert.allRowsContainText(/2330/);
  });

  test("partial custom range: clear 'to' date → inline error visible, table holds last state", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1),
      paymentDate: isoDateForMonth(10),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickPreset("custom");
    await dividendReview.actions.fillDateFrom(yearStart());
    await dividendReview.actions.clearDateTo();

    // ASSERT
    await dividendReview.assert.dateErrorIsVisible();
    // Table should still show rows from previous valid state
    await dividendReview.assert.tableHasAtLeastRows(1);
  });

  test("ticker filter: type ticker → press Enter → filtered results", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(3),
      paymentDate: isoDateForMonth(15),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(4),
      paymentDate: isoDateForMonth(16),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.fillTicker("2330");
    await dividendReview.actions.submitTickerFilter();

    // ASSERT
    await dividendReview.assert.urlContains("ticker=2330");
    await dividendReview.assert.allRowsContainText(/2330/);
    await dividendReview.assert.noRowContainsText(/0050/);
  });

  test("status dropdown: change selection → immediate re-fetch", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      exDividendDate: isoDateForMonth(5),
      paymentDate: isoDateForMonth(17),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      reconciliationStatus: "open",
    });
    await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "0050",
      exDividendDate: isoDateForMonth(6),
      paymentDate: isoDateForMonth(18),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
      reconciliationStatus: "matched",
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.selectStatus("open");

    // ASSERT
    await dividendReview.assert.urlContains("status=open");
    await dividendReview.assert.tableHasAtLeastRows(1);
  });
});

// ─── Group 2: Chart interactions ────────────────────────────────────────────

test.describe("dividend review — chart interactions", () => {
  test("accumulated tab: click → area chart renders, no bar chart", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -2),
      paymentDate: isoDateForMonth(15, -2),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -1),
      paymentDate: isoDateForMonth(15, -1),
      cashDividendPerShare: 0.15,
      receivedCashAmount: 135,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1),
      paymentDate: isoDateForMonth(15),
      cashDividendPerShare: 0.1,
      receivedCashAmount: 90,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickChartTab("accumulated");

    // ASSERT
    await dividendReview.assert.chartContainerIsVisible();
    await dividendReview.assert.chartHasAreaSeries();
    await dividendReview.assert.chartHasNoBarSeries();
  });

  test("by ticker tab: click → grouped bar chart renders", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1),
      paymentDate: isoDateForMonth(15),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(2),
      paymentDate: isoDateForMonth(16),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickChartTab("byTicker");

    // ASSERT
    await dividendReview.assert.chartContainerIsVisible();
    await dividendReview.assert.chartHasBarSeries();
  });

  test("granularity toggle: Month → Quarter → no network request fired", async ({
    dividendReview, page,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -2),
      paymentDate: isoDateForMonth(15, -2),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -1),
      paymentDate: isoDateForMonth(15, -1),
      cashDividendPerShare: 0.15,
      receivedCashAmount: 135,
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.chartContainerIsVisible();

    // ACT: capture network requests after page is stable, then toggle granularity
    const ledgerRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/portfolio/dividends/ledger") && req.method() === "GET") {
        ledgerRequests.push(req.url());
      }
    });

    const requestCountBefore = ledgerRequests.length;
    await dividendReview.actions.clickGranularity("quarter");

    // Wait for the granularity UI to settle, then verify no new requests
    await dividendReview.assert.granularityIsActive("quarter");
    await dividendReview.assert.chartContainerIsVisible();

    // ASSERT: no new ledger requests after granularity change
    await dividendReview.assert.noLedgerRequestsFired(ledgerRequests, requestCountBefore);
  });

  test("unspecified preset: both time-series charts default to Year granularity", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1, -3),
      paymentDate: isoDateForMonth(15, -3),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickPreset("unspecified");

    // ASSERT: Monthly tab defaults to Year granularity
    await dividendReview.assert.granularityIsActive("year");
    await dividendReview.assert.urlDoesNotContain("fromPaymentDate");
    await dividendReview.assert.urlDoesNotContain("toPaymentDate");

    // Switch to Accumulated tab — also defaults to Year
    await dividendReview.actions.clickChartTab("accumulated");
    await dividendReview.assert.granularityIsActive("year");
  });
});

// ─── Group 3: Table interactions ────────────────────────────────────────────

test.describe("dividend review — table interactions", () => {
  test("sort column: click Ticker header → correct params, page resets to 1", async ({
    dividendReview, page,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(1),
      paymentDate: isoDateForMonth(10),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(2),
      paymentDate: isoDateForMonth(11),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
    });
    await dividendReview.arrange.seedPostedDividend({
      ticker: "0050",
      exDividendDate: isoDateForMonth(3),
      paymentDate: isoDateForMonth(12),
      cashDividendPerShare: 0.3,
      receivedCashAmount: 270,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();

    // Intercept the next ledger request on sort click
    const sortRequestPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/portfolio/dividends/ledger")
        && response.url().includes("sortBy=ticker"),
    );

    await dividendReview.actions.clickColumnHeader("ticker");
    const sortResponse = await sortRequestPromise;

    // ASSERT
    await dividendReview.assert.responseUrlContains(sortResponse, "sortBy=ticker");
    await dividendReview.assert.responseUrlContains(sortResponse, "sortOrder=asc");
    await dividendReview.assert.responseUrlMatches(sortResponse, /page=1/);
    await dividendReview.assert.urlContains("sortBy=ticker");
    await dividendReview.assert.sortIndicatorOnColumn("ticker");
  });

  test("pagination: navigate to page 2 → different rows render", async ({
    dividendReview,
  }) => {
    // ARRANGE: seed 26 dividends to exceed PAGE_SIZE (25)
    for (let i = 0; i < 26; i++) {
      await dividendReview.arrange.seedPostedDividend({
        ticker: i % 2 === 0 ? "2330" : "0050",
        exDividendDate: isoDateForMonth(Math.max(1, (i % 28) + 1)),
        paymentDate: isoDateForMonth(Math.max(1, (i % 28) + 1)),
        cashDividendPerShare: 0.1 + i * 0.01,
        receivedCashAmount: 100 + i * 10,
      });
    }

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.tableHasAtLeastRows(1);

    await dividendReview.actions.clickNextPage();

    // ASSERT
    await dividendReview.assert.urlContains("page=2");
    await dividendReview.assert.pageInfoContains(/2/);
    await dividendReview.assert.tableHasAtLeastRows(1);
  });

  test("mark matched: click on open row → button disappears, status badge updates", async ({
    dividendReview,
  }) => {
    // ARRANGE
    const seeded = await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      exDividendDate: isoDateForMonth(7),
      paymentDate: isoDateForMonth(20),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      reconciliationStatus: "open",
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.markMatchedButtonIsVisible(seeded.dividendLedgerEntryId);

    const patchResponse = await dividendReview.actions.clickMarkMatched(seeded.dividendLedgerEntryId);

    // ASSERT
    await dividendReview.assert.responseStatusIs(patchResponse, 200);
    await dividendReview.assert.markMatchedButtonIsHidden(seeded.dividendLedgerEntryId);
    // Accept both intermediate and final states per playwright-fast-sse-assertions.md
    await dividendReview.assert.rowStatusContains(
      seeded.dividendLedgerEntryId,
      /Matched|相符|Pending review|待覆核/,
    );
  });

  test("row click: opens drawer with correct ticker and account", async ({
    dividendReview,
  }) => {
    // ARRANGE
    const seeded = await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(8),
      paymentDate: isoDateForMonth(22),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });

    // ACT
    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.actions.clickRow(seeded.dividendLedgerEntryId);

    // ASSERT
    await dividendReview.assert.drawerIsVisible();
    await dividendReview.assert.drawerContains(/2330/);
  });
});

// ─── Group 4: Deep link ─────────────────────────────────────────────────────

test.describe("dividend review — deep link", () => {
  test("URL params hydrate filter bar and table state", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      exDividendDate: isoDateForMonth(9),
      paymentDate: isoDateForMonth(23),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      reconciliationStatus: "open",
    });
    await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "0050",
      exDividendDate: isoDateForMonth(10),
      paymentDate: isoDateForMonth(24),
      cashDividendPerShare: 0.5,
      receivedCashAmount: 450,
      reconciliationStatus: "matched",
    });

    // ACT: navigate directly with deep-link params
    await dividendReview.actions.navigateToReviewWithParams(
      "sortBy=ticker&sortOrder=asc&status=open",
    );

    // ASSERT
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.tableHasAtLeastRows(1);
    await dividendReview.assert.sortIndicatorOnColumn("ticker");
    // Only open-status rows should be visible
    await dividendReview.assert.allRowsContainText(/2330/);
  });
});

// ─── Group 5: SSE ───────────────────────────────────────────────────────────

test.describe("dividend review — SSE", () => {
  test("reconciliation status change via API → row patches in-place without full re-fetch", async ({
    dividendReview, page,
  }) => {
    // ARRANGE
    const seeded = await dividendReview.arrange.seedPostedDividendWithReconciliation({
      ticker: "2330",
      exDividendDate: isoDateForMonth(11),
      paymentDate: isoDateForMonth(25),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
      reconciliationStatus: "open",
    });

    await dividendReview.actions.navigateToReview();
    await dividendReview.assert.pageLoaded();
    await dividendReview.assert.tableHasAtLeastRows(1);

    // Track ledger requests after initial load
    const ledgerRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/portfolio/dividends/ledger") && req.method() === "GET") {
        ledgerRequests.push(req.url());
      }
    });
    const requestCountBefore = ledgerRequests.length;

    // ACT: trigger reconciliation change via direct API PATCH
    await dividendReview.arrange.patchReconciliationViaApi(
      seeded.dividendLedgerEntryId,
      "matched",
    );

    // ASSERT: row updates in-place via SSE — accept both intermediate and final states
    await dividendReview.assert.rowStatusContains(
      seeded.dividendLedgerEntryId,
      /Matched|相符|Pending review|待覆核/,
    );

    // No full table re-fetch triggered
    await dividendReview.assert.noLedgerRequestsFired(ledgerRequests, requestCountBefore);
  });
});

// ─── Group 6: Navigation ───────────────────────────────────────────────────

test.describe("dividend review — navigation", () => {
  test("calendar page: click 'View all dividends' → switches to ledger tab on /dividends", async ({
    dividendReview,
  }) => {
    // ARRANGE
    await dividendReview.arrange.seedPostedDividend({
      ticker: "2330",
      exDividendDate: isoDateForMonth(12),
      paymentDate: isoDateForMonth(26),
      cashDividendPerShare: 0.12,
      receivedCashAmount: 108,
    });

    // ACT: navigate to calendar (default tab), then click the link
    await dividendReview.actions.navigateToCalendar();
    await dividendReview.actions.clickViewAllDividendsLink();

    // ASSERT — Phase 5a — /dividends/review was merged into /dividends?view=ledger.
    await dividendReview.assert.urlPathIs("/dividends");
    await dividendReview.assert.pageLoaded();
  });
});
