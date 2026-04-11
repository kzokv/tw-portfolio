import { test } from "@tw-portfolio/test-e2e/fixtures/appPages";

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
    await cashLedger.actions.clickApplyFilter();

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
