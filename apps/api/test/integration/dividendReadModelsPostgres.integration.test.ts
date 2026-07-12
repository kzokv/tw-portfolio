import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import {
  buildTickerDividendOpenReconciliationPage,
  buildTickerDividendPostedHistoryPage,
} from "../../src/services/tickerDetails.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or " +
      "npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

async function resetDatabase(): Promise<void> {
  const resetPool = new Pool({ connectionString: databaseUrl });
  const client = await resetPool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");
  } finally {
    client.release();
    await resetPool.end();
  }
}

describePostgres("dividend read model parity", () => {
  let persistence: PostgresPersistence;
  let accountId: string;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    accountId = store.accounts[0]!.id;
    store.instruments = [
      ...store.instruments.filter((instrument) => !(instrument.ticker === "2330" && instrument.marketCode === "TW")),
      { ticker: "2330", name: "TSMC", type: "STOCK", marketCode: "TW", isProvisional: false },
    ];
    store.accounting.projections.holdings.push({
      accountId,
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    for (let index = 1; index <= 12; index += 1) {
      const day = String(index).padStart(2, "0");
      const eventId = `event-${day}`;
      store.marketData.dividendEvents.push({
        id: eventId,
        ticker: "2330",
        marketCode: "TW",
        eventType: "CASH",
        exDividendDate: `2026-01-${day}`,
        paymentDate: `2026-02-${day}`,
        cashDividendPerShare: 10,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        source: "test",
      });
      store.accounting.facts.dividendLedgerEntries.push({
        id: `ledger-${day}`,
        accountId,
        dividendEventId: eventId,
        eligibleQuantity: 10,
        expectedCashAmount: 100,
        expectedStockQuantity: 0,
        receivedCashAmount: 0,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: index === 1 ? "open" : "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: `2026-02-${day}T09:00:00.000Z`,
      });
      store.accounting.facts.cashLedgerEntries.push({
        id: `cash-receipt-${day}`,
        userId: "user-1",
        accountId,
        entryDate: `2026-02-${day}`,
        entryType: "DIVIDEND_RECEIPT",
        amount: 100 + index,
        currency: "TWD",
        relatedDividendLedgerEntryId: `ledger-${day}`,
        source: "test",
        bookedAt: `2026-02-${day}T09:00:01.000Z`,
      });
    }
    await persistence.saveStore(store);
  });

  afterEach(async () => {
    await persistence?.close();
  });

  it("[postgres ticker read models]: posted/open builders → preserve pagination and open separation", async () => {
    const store = await persistence.loadStore("user-1");

    const posted = buildTickerDividendPostedHistoryPage(store, "2330", "TW", new Set([accountId]), { page: 2, limit: 10 });
    const open = buildTickerDividendOpenReconciliationPage(store, "2330", "TW", new Set([accountId]), { page: 1, limit: 10 });

    expect(posted.total).toBe(12);
    expect(posted.items.map((item) => item.dividendLedgerEntryId)).toEqual(["ledger-02", "ledger-01"]);
    expect(posted.items.map((item) => item.receivedCashAmount)).toEqual([102, 101]);
    expect(posted.items.map((item) => item.actualNetAmount)).toEqual([102, 101]);
    expect(open.total).toBe(1);
    expect(open.items.map((item) => item.dividendLedgerEntryId)).toEqual(["ledger-01"]);
  });

  it("[postgres dividend review]: generated expectations → use replay-style eligibility and authoritative ratio state", async () => {
    const store = await persistence.loadStore("user-1");
    store.marketData.dividendEvents = [{
      id: "event-expected-generated",
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH_AND_STOCK",
      exDividendDate: "2026-03-01",
      paymentDate: "2026-03-20",
      cashDividendPerShare: 3,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 3,
      stockDistributionRatio: 0.25,
      stockDistributionRatioState: "authoritative",
      stockParValueAmount: 10,
      source: "test",
    }];
    store.accounting.facts.dividendLedgerEntries = [];
    store.accounting.facts.cashLedgerEntries = store.accounting.facts.cashLedgerEntries.filter(
      (entry) => entry.entryType !== "DIVIDEND_RECEIPT",
    );
    store.accounting.facts.tradeEvents.push({
      id: "buy-expected-generated",
      userId: "user-1",
      accountId,
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 100,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-10",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    });
    store.accounting.facts.positionActions.push(
      {
        id: "split-before-ex-div",
        accountId,
        ticker: "2330",
        marketCode: "TW",
        actionType: "SPLIT",
        actionDate: "2026-02-01",
        quantity: 100,
        ratioNumerator: 2,
        ratioDenominator: 1,
        source: "test",
        bookedAt: "2026-02-01T09:00:00.000Z",
      },
      {
        id: "stock-dividend-before-ex-div",
        accountId,
        ticker: "2330",
        marketCode: "TW",
        actionType: "STOCK_DIVIDEND",
        actionDate: "2026-02-10",
        quantity: 10,
        source: "test",
        bookedAt: "2026-02-10T09:00:00.000Z",
      },
    );
    await persistence.saveStore(store);

    const persistedStore = await persistence.loadStore("user-1");
    expect(persistedStore.marketData.dividendEvents.find((event) => event.id === "event-expected-generated")).toMatchObject({
      stockDistributionRatio: 0.25,
      stockDistributionRatioState: "authoritative",
      stockParValueAmount: 10,
    });

    const fullStoreRead = vi.spyOn(persistence, "loadStore").mockRejectedValue(
      new Error("dividend review must not hydrate the full user store"),
    );
    const review = await persistence.listDividendReviewRows("user-1", {
      page: 1,
      limit: 10,
      sortBy: "paymentDate",
      sortOrder: "desc",
    });
    expect(fullStoreRead).not.toHaveBeenCalled();
    fullStoreRead.mockRestore();

    const generatedRow = review.rows.find((row) => row.id === `expected:${accountId}:event-expected-generated`);
    expect(generatedRow).toMatchObject({
      id: `expected:${accountId}:event-expected-generated`,
      rowKind: "expected",
      eligibleQuantity: 210,
      expectedCashAmount: 630,
      expectedStockQuantity: 52,
      stockDistributionRatio: 0.25,
      stockDistributionRatioState: "authoritative",
      expectedStockCalcState: "resolved",
    });

    const generatedEventIndex = store.marketData.dividendEvents.findIndex((event) => event.id === "event-expected-generated");
    store.marketData.dividendEvents[generatedEventIndex] = {
      ...store.marketData.dividendEvents[generatedEventIndex]!,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
    };
    await persistence.saveStore(store);

    const unresolvedReview = await persistence.listDividendReviewRows("user-1", {
      page: 1,
      limit: 10,
      sortBy: "paymentDate",
      sortOrder: "desc",
    });

    const unresolvedRow = unresolvedReview.rows.find((row) => row.id === `expected:${accountId}:event-expected-generated`);
    expect(unresolvedRow).toMatchObject({
      expectedStockQuantity: 0,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      expectedStockCalcState: "needs_action",
    });
  });

  it("[postgres destructive guard]: rejects stale accounting revisions and deletes snapshots atomically", async () => {
    const store = await persistence.loadStore("user-1");
    const staleRevision = await persistence.getAccountAccountingRevision("user-1", accountId);
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(
      `UPDATE dividend_ledger_entries
          SET reconciliation_status = CASE WHEN reconciliation_status = 'open' THEN 'matched' ELSE 'open' END
        WHERE account_id = $1`,
      [accountId],
    );

    await expect(persistence.saveAccountingStoreWithAudit("user-1", store.accounting, {
      actorUserId: "user-1",
      action: "dividend_destructive_confirmed",
      targetUserId: "user-1",
      metadata: { result: "guard-test" },
    }, {
      expectedAccountRevision: { accountId, revision: staleRevision },
    })).rejects.toMatchObject({
      code: "dividend_destructive_preview_row_drift",
      statusCode: 409,
    });

    await persistence.bulkUpsertHoldingSnapshots("user-1", [{
      id: "guard-snapshot",
      userId: "user-1",
      accountId,
      ticker: "2330",
      marketCode: "TW",
      snapshotDate: "2026-03-01",
      quantity: 210,
      closePrice: 100,
      marketValue: 21000,
      costBasis: 10000,
      unrealizedPnl: 11000,
      cumulativeRealizedPnl: 0,
      cumulativeDividends: 0,
      isProvisional: false,
      currency: "TWD",
      valueNative: 21000,
      costBasisNative: 10000,
      unrealizedPnlNative: 11000,
      providerSource: "test",
      generatedAt: "2026-03-01T10:00:00.000Z",
      generationRunId: "guard-run",
    }]);
    const latestStore = await persistence.loadStore("user-1");
    const currentRevision = await persistence.getAccountAccountingRevision("user-1", accountId);
    await persistence.saveAccountingStoreWithAudit("user-1", latestStore.accounting, {
      actorUserId: "user-1",
      action: "dividend_destructive_confirmed",
      targetUserId: "user-1",
      metadata: { result: "snapshot-delete-test" },
    }, {
      expectedAccountRevision: { accountId, revision: currentRevision },
      deleteHoldingSnapshotScopes: [{ accountId, ticker: "2330", marketCode: "TW", fromDate: "2026-03-01" }],
    });
    expect(await persistence.countHoldingSnapshotsAfterDate("user-1", accountId, "2330", "2026-03-01", "TW")).toBe(0);
    await pool.end();
  });
});
