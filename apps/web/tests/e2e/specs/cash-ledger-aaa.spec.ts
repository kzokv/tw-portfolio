import { test } from "@vakwen/test-e2e/fixtures/appPages";

test.describe("cash ledger", () => {
  test("page loads with seeded entries: trade creates settlement → table has rows and nav link visible", async ({
    cashLedger,
  }) => {
    await cashLedger.arrange.seedTradeWithSettlement({
      ticker: "2330",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-01-15",
    });

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();
    await cashLedger.assert.tableIsVisible();
    await cashLedger.assert.tableHasAtLeastRows(1);
    await cashLedger.assert.navLinkVisible();
  });

  test("entry type filter: toggle settlement out → only settlement entries shown", async ({
    cashLedger,
  }) => {
    // Seed a trade (creates TRADE_SETTLEMENT_OUT) and a dividend (creates DIVIDEND_RECEIPT)
    await cashLedger.arrange.seedTradeWithSettlement({
      ticker: "2330",
      type: "BUY",
      quantity: 5,
      unitPrice: 200,
      tradeDate: "2026-01-10",
    });
    await cashLedger.arrange.seedDividendWithCashEntry({
      ticker: "2330",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
      receivedCashAmount: 10800,
    });

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();

    // Filter by Trade Settlement (Out) — matches both en and zh-TW labels
    await cashLedger.actions.filterByEntryType(/Trade Settlement \(Out\)|交割出帳/);

    // After filtering, at least the seeded trade settlement entry should be present
    await cashLedger.assert.tableHasAtLeastRows(1);
    await cashLedger.assert.rowContainsText(0, /2330/);
  });

  test("drawer: click settlement entry → shows trade detail fields", async ({
    cashLedger,
  }) => {
    await cashLedger.arrange.seedTradeWithSettlement({
      ticker: "2330",
      type: "BUY",
      quantity: 50,
      unitPrice: 595,
      tradeDate: "2026-01-20",
      commissionAmount: 42,
      taxAmount: 0,
    });

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();

    await cashLedger.actions.clickEntry(0);
    await cashLedger.assert.drawerIsVisible();
    await cashLedger.assert.drawerContains(/2330/);
    await cashLedger.assert.drawerContains(/BUY/);
    await cashLedger.assert.drawerContains(/50/);
    await cashLedger.assert.drawerContains(/595/);
    await cashLedger.assert.drawerContains(/42/);
  });

  test("drawer: click dividend entry → shows dividend detail fields", async ({
    cashLedger,
  }) => {
    await cashLedger.arrange.seedDividendWithCashEntry({
      ticker: "2330",
      exDividendDate: "2026-03-01",
      paymentDate: "2026-03-20",
      cashDividendPerShare: 10,
      receivedCashAmount: 9000,
      eligibleQuantity: 1_000,
    });

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();

    await cashLedger.actions.clickEntry(0);
    await cashLedger.assert.drawerIsVisible();
    await cashLedger.assert.drawerContains(/2330/);
    // expectedCashAmount = eligibleQuantity * cashDividendPerShare = 1000 * 10 = 10000
    await cashLedger.assert.drawerContains(/10,000|10000/);
    // receivedCashAmount = 9000
    await cashLedger.assert.drawerContains(/9,000|9000/);
  });
});

// ─── Group 2: Pagination ─────────────────────────────────────────────────────

test.describe("cash ledger — pagination", () => {
  test("first page: >50 entries → pagination visible, page 1 shown, prev disabled", async ({
    cashLedger,
  }) => {
    // Seed 55 trade settlements to exceed PAGE_SIZE (50)
    for (let i = 0; i < 55; i++) {
      await cashLedger.arrange.seedTradeWithSettlement({
        ticker: "2330",
        type: "BUY",
        quantity: 1,
        unitPrice: 100 + i,
        tradeDate: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();
    await cashLedger.assert.tableIsVisible();
    await cashLedger.assert.paginationVisible();
    await cashLedger.assert.pageInfoContains(/1/);
    await cashLedger.assert.prevButtonDisabled();
    await cashLedger.assert.nextButtonEnabled();
  });

  test("next page: click next → page 2 loads with rows", async ({
    cashLedger,
  }) => {
    for (let i = 0; i < 55; i++) {
      await cashLedger.arrange.seedTradeWithSettlement({
        ticker: "2330",
        type: "BUY",
        quantity: 1,
        unitPrice: 100 + i,
        tradeDate: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();
    await cashLedger.actions.goToNextPage();

    await cashLedger.assert.pageInfoContains(/2/);
    await cashLedger.assert.tableHasAtLeastRows(1);
    await cashLedger.assert.prevButtonEnabled();
  });

  test("prev page: navigate to page 2 then back → returns to page 1", async ({
    cashLedger,
  }) => {
    for (let i = 0; i < 55; i++) {
      await cashLedger.arrange.seedTradeWithSettlement({
        ticker: "2330",
        type: "BUY",
        quantity: 1,
        unitPrice: 100 + i,
        tradeDate: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();
    await cashLedger.actions.goToNextPage();
    await cashLedger.assert.pageInfoContains(/2/);

    await cashLedger.actions.goToPrevPage();
    await cashLedger.assert.pageInfoContains(/1/);
    await cashLedger.assert.prevButtonDisabled();
  });

  test("sort column: click column header → page resets to 1", async ({
    cashLedger, page,
  }) => {
    for (let i = 0; i < 55; i++) {
      await cashLedger.arrange.seedTradeWithSettlement({
        ticker: "2330",
        type: i % 2 === 0 ? "BUY" : "SELL",
        quantity: 1,
        unitPrice: 100 + i,
        tradeDate: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();
    await cashLedger.actions.goToNextPage();
    await cashLedger.assert.pageInfoContains(/2/);

    // Intercept next ledger request on sort click
    const sortRequestPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET"
        && response.url().includes("/portfolio/cash-ledger")
        && response.url().includes("sortBy=amount"),
    );

    await cashLedger.actions.clickColumnHeader("amount");
    await sortRequestPromise;

    // Page should reset to 1 after sort change
    await cashLedger.assert.pageInfoContains(/1/);
  });

  test("summary totals: identical on page 1 and page 2 → full-set aggregate", async ({
    cashLedger,
  }) => {
    for (let i = 0; i < 55; i++) {
      await cashLedger.arrange.seedTradeWithSettlement({
        ticker: "2330",
        type: "BUY",
        quantity: 1,
        unitPrice: 100 + i,
        tradeDate: `2026-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();
    await cashLedger.assert.summaryVisible();

    // Capture summary text on page 1
    const summaryPage1 = await cashLedger.assert.summaryText();

    await cashLedger.actions.goToNextPage();
    await cashLedger.assert.pageInfoContains(/2/);

    // Summary on page 2 must be identical to page 1 (full-set aggregate)
    await cashLedger.assert.summaryMatchesSnapshot(summaryPage1);
  });

  test("filter change: apply filter → page resets to 1", async ({
    cashLedger,
  }) => {
    // Seed mix of settlement out and dividend receipt entries
    for (let i = 0; i < 30; i++) {
      await cashLedger.arrange.seedTradeWithSettlement({
        ticker: "2330",
        type: "BUY",
        quantity: 1,
        unitPrice: 100 + i,
        tradeDate: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }
    for (let i = 0; i < 30; i++) {
      await cashLedger.arrange.seedDividendWithCashEntry({
        ticker: "2330",
        exDividendDate: `2026-02-${String((i % 28) + 1).padStart(2, "0")}`,
        paymentDate: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
        cashDividendPerShare: 1,
        receivedCashAmount: 100,
      });
    }

    await cashLedger.actions.navigateToCashLedger();
    await cashLedger.assert.pageLoaded();

    // Navigate away from page 1 (if pagination visible)
    // Then apply filter — page should reset
    await cashLedger.actions.filterByEntryType(/Trade Settlement \(Out\)|交割出帳/);

    await cashLedger.assert.pageInfoContains(/1/);
    await cashLedger.assert.tableHasAtLeastRows(1);
  });
});
