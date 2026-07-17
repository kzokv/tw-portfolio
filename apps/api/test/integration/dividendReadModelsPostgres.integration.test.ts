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
const REVIEW_SORT_COLUMNS = [
  "paymentDate", "ticker", "account", "expectedCashAmount", "expectedGrossAmount",
  "expectedNetAmount", "nhiAmount", "bankFeeAmount", "otherDeductionAmount",
  "receivedCashAmount", "actualNetAmount", "varianceAmount", "reconciliationStatus",
] as const;

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

    const templateAccount = store.accounts[0]!;
    const templateFeeProfile = store.feeProfiles.find((profile) => profile.id === templateAccount.feeProfileId)!;
    const reconciliationStatuses = ["open", "matched", "explained", "resolved"] as const;
    for (let index = 1; index <= 12; index += 1) {
      const day = String(index).padStart(2, "0");
      const rowAccountId = `review-account-${day}`;
      const rowFeeProfileId = `review-fee-profile-${day}`;
      const ticker = `R${day}`;
      store.feeProfiles.push({
        ...templateFeeProfile,
        id: rowFeeProfileId,
        accountId: rowAccountId,
        name: `Review ${day} Fee Profile`,
        taxRules: undefined,
      });
      store.accounts.push({
        ...templateAccount,
        id: rowAccountId,
        name: `Review ${day}`,
        feeProfileId: rowFeeProfileId,
      });
      store.instruments.push({
        ticker, name: `Review ${day}`, type: "ETF", marketCode: "TW", isProvisional: false,
      });
      const event = store.marketData.dividendEvents.find((candidate) => candidate.id === `event-${day}`)!;
      event.ticker = ticker;
      const ledger = store.accounting.facts.dividendLedgerEntries.find((candidate) => candidate.id === `ledger-${day}`)!;
      ledger.accountId = rowAccountId;
      ledger.expectedCashAmount = index * 1_000;
      ledger.reconciliationStatus = reconciliationStatuses[index % reconciliationStatuses.length]!;
      ledger.reconciliationNote = ledger.reconciliationStatus === "explained" ? "Explained in sort fixture" : undefined;
      const receipt = store.accounting.facts.cashLedgerEntries.find((candidate) => candidate.id === `cash-receipt-${day}`)!;
      receipt.accountId = rowAccountId;
      store.accounting.facts.dividendDeductionEntries.push(
        {
          id: `nhi-${day}`, dividendLedgerEntryId: ledger.id,
          deductionType: "NHI_SUPPLEMENTAL_PREMIUM", amount: index * 10,
          currencyCode: "TWD", withheldAtSource: true, source: "test",
        },
        {
          id: `bank-${day}`, dividendLedgerEntryId: ledger.id,
          deductionType: "BANK_FEE", amount: index * 3,
          currencyCode: "TWD", withheldAtSource: false, source: "test",
        },
        {
          id: `other-${day}`, dividendLedgerEntryId: ledger.id,
          deductionType: "OTHER", amount: index,
          currencyCode: "TWD", withheldAtSource: false, source: "test",
        },
      );
    }
    const pendingEntry = store.accounting.facts.dividendLedgerEntries.find((entry) => entry.id === "ledger-01")!;
    pendingEntry.sourceCompositionStatus = "unknown_pending_disclosure";
    await persistence.saveStore(store);
    const fixturePool = new Pool({ connectionString: databaseUrl });
    await fixturePool.query(
      `INSERT INTO market_data.instruments (ticker, market_code, name, instrument_type)
       VALUES ('R01', 'TW', 'Review 01', 'ETF')
       ON CONFLICT (ticker, market_code) DO UPDATE SET instrument_type = EXCLUDED.instrument_type`,
    );
    await fixturePool.end();

    const pageOneFirst = await persistence.listDividendReviewPrimary("user-1", {
      page: 1, limit: 10, sortBy: "paymentDate", sortOrder: "asc",
    });
    const pageTwo = await persistence.listDividendReviewPrimary("user-1", {
      page: 2, limit: 10, sortBy: "paymentDate", sortOrder: "asc",
    });
    const pageOneAgain = await persistence.listDividendReviewPrimary("user-1", {
      page: 1, limit: 10, sortBy: "paymentDate", sortOrder: "asc",
    });
    expect(pageTwo.total).toBe(12);
    expect(pageTwo.rows.map((row) => row.id)).toEqual(["ledger-11", "ledger-12"]);
    expect(pageTwo.rows.map((row) => row.id)).not.toEqual(pageOneFirst.rows.map((row) => row.id));
    expect(pageOneAgain.rows.map((row) => row.id)).toEqual(pageOneFirst.rows.map((row) => row.id));
    for (const limit of [25, 50] as const) {
      const widePage = await persistence.listDividendReviewPrimary("user-1", {
        page: 1, limit, sortBy: "paymentDate", sortOrder: "asc",
      });
      expect(widePage.total).toBe(12);
      expect(widePage.rows).toHaveLength(12);
    }
    for (const sortBy of REVIEW_SORT_COLUMNS) {
      for (const sortOrder of ["asc", "desc"] as const) {
        const first = await persistence.listDividendReviewPrimary("user-1", {
          page: 1, limit: 10, sortBy, sortOrder,
        });
        const second = await persistence.listDividendReviewPrimary("user-1", {
          page: 2, limit: 10, sortBy, sortOrder,
        });
        const replay = await persistence.listDividendReviewPrimary("user-1", {
          page: 1, limit: 10, sortBy, sortOrder,
        });
        expect(first.total, `${sortBy}/${sortOrder}`).toBe(12);
        expect(first.rows, `${sortBy}/${sortOrder}`).toHaveLength(10);
        expect(second.rows, `${sortBy}/${sortOrder} page 2`).toHaveLength(2);
        expect(replay.rows.map((row) => row.id), `${sortBy}/${sortOrder}`).toEqual(
          first.rows.map((row) => row.id),
        );
        const values = [...first.rows, ...second.rows].map((row) => {
          switch (sortBy) {
            case "paymentDate": return row.paymentDate ?? "~";
            case "ticker": return row.ticker;
            case "account": return row.accountName ?? "";
            case "expectedCashAmount":
            case "expectedGrossAmount": return row.expectedCashAmount;
            case "expectedNetAmount": return row.expectedNetAmount ?? 0;
            case "nhiAmount": return row.nhiAmount ?? 0;
            case "bankFeeAmount": return row.bankFeeAmount ?? 0;
            case "otherDeductionAmount": return row.otherDeductionAmount ?? 0;
            case "receivedCashAmount": return row.receivedCashAmount;
            case "actualNetAmount": return row.actualNetAmount ?? 0;
            case "varianceAmount": return row.varianceAmount ?? 0;
            case "reconciliationStatus": return row.reconciliationStatus;
          }
        });
        const ordered = [...values].sort((left, right) =>
          (typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left).localeCompare(String(right))) * (sortOrder === "asc" ? 1 : -1));
        expect(values, `${sortBy}/${sortOrder} ordered keys`).toEqual(ordered);
      }
    }

    const pending = await persistence.listDividendReviewPrimary("user-1", {
      page: 1, limit: 10, sortBy: "paymentDate", sortOrder: "asc", sourceComposition: "pending",
    });
    expect(pending.total).toBe(1);
    expect(pending.rows.map((row) => row.id)).toEqual(["ledger-01"]);
    const pendingEnrichment = await persistence.getDividendReviewEnrichment("user-1", {
      sourceComposition: "pending",
    });
    expect(pendingEnrichment.aggregates.totalExpectedCashAmount).toEqual({ TWD: 1_000 });
    expect(pendingEnrichment.sourceComposition).toEqual({ providedCount: 0, pendingCount: 1 });

    const enrichment = await persistence.getDividendReviewEnrichment("user-1", {});
    expect(enrichment.aggregates.totalExpectedCashAmount).toEqual({ TWD: 78_000 });
    expect(enrichment.sourceComposition).toEqual({ providedCount: 11, pendingCount: 1 });

    pendingEntry.postingStatus = "expected";
    pendingEntry.reconciliationStatus = "open";
    pendingEntry.expectedStockCalcState = "resolved";
    const undatedEvent = store.marketData.dividendEvents.find((event) => event.id === "event-01")!;
    undatedEvent.paymentDate = null;
    undatedEvent.eventType = "CASH_AND_STOCK";
    undatedEvent.stockDividendPerShare = 1;
    undatedEvent.stockDistributionRatio = null;
    undatedEvent.stockDistributionRatioState = "unresolved";
    await persistence.saveStore(store);
    const unresolvedPersisted = await persistence.listDividendReviewPrimary("user-1", {
      fromPaymentDate: "2026-01-01", toPaymentDate: "2026-12-31",
      sourceComposition: "pending", page: 1, limit: 10,
      sortBy: "paymentDate", sortOrder: "asc",
    });
    expect(unresolvedPersisted.rows[0]).toMatchObject({
      id: "ledger-01", stockDistributionRatio: null, expectedStockCalcState: "needs_action",
    });

    const fullStoreRead = vi.spyOn(persistence, "loadStore").mockRejectedValue(
      new Error("targeted dividend detail must not load the full store"),
    );
    const detail = await persistence.getDividendReviewRowDetail("user-1", "ledger-01");
    expect(detail).toMatchObject({
      id: "ledger-01", accountId: "review-account-01", ticker: "R01", postingStatus: "expected",
      paymentDate: null, stockDistributionRatio: null, expectedStockCalcState: "needs_action",
    });
    expect(detail).toHaveProperty("deductions");
    expect(detail).toHaveProperty("sourceLines");
    expect(await persistence.getDividendReviewRowDetail("user-2", "ledger-01")).toBeNull();
    expect(fullStoreRead).not.toHaveBeenCalled();
    fullStoreRead.mockRestore();
  });

  it("[postgres dividend review detail]: amended calculation → retains superseded history", async () => {
    const store = await persistence.loadStore("user-1");
    const event = store.marketData.dividendEvents.find((candidate) => candidate.id === "event-01")!;
    event.eventType = "STOCK";
    event.cashDividendPerShare = 0;
    event.stockDividendPerShare = 1;
    event.stockDistributionAmountRaw = 1;
    event.stockDistributionRatio = null;
    event.stockDistributionRatioState = "unresolved";
    event.stockProviderValueUnit = "TWD_PER_SHARE";
    event.stockProviderSource = "finmind";
    event.stockProviderDataset = "TaiwanStockDividend";

    const ledger = store.accounting.facts.dividendLedgerEntries.find((candidate) => candidate.id === "ledger-01")!;
    ledger.expectedCashAmount = 0;
    ledger.expectedStockQuantity = 1;
    ledger.receivedStockQuantity = 1;
    ledger.expectedStockCalcState = "resolved";
    ledger.stockReconciliationStatus = "matched";
    ledger.activeCalculationId = "calculation-history-v1";
    store.accounting.facts.dividendCalculationVersions.push({
      id: "calculation-history-v1",
      userId: "user-1",
      accountId,
      dividendEventId: event.id,
      calculationVersion: 1,
      status: "confirmed",
      method: "custom_ratio",
      providerValue: "1",
      providerUnit: "TWD_PER_SHARE",
      providerSource: "finmind",
      providerDataset: "TaiwanStockDividend",
      providerAuthoritativeRatio: null,
      selectedParValue: null,
      customRatio: "0.1",
      ratio: "0.1",
      theoreticalShares: "1",
      expectedWholeShares: 1,
      fractionalRemainder: "0",
      requiresHighRatioConfirmation: false,
      confirmedAt: "2026-02-01T09:00:00.000Z",
      priorCalculationId: null,
      dividendLedgerEntryId: ledger.id,
      drift: null,
      createdAt: "2026-02-01T09:00:00.000Z",
    });
    await persistence.saveStore(store);

    const amended = await persistence.amendDividendCalculation("user-1", {
      accountId,
      dividendEventId: event.id,
      dividendLedgerEntryId: ledger.id,
      method: "custom_ratio",
      customRatio: "0.2",
      expectedActiveCalculationId: "calculation-history-v1",
      expectedCalculationVersion: 1,
      providerValue: "1",
      providerUnit: "TWD_PER_SHARE",
      providerSource: "finmind",
      providerDataset: "TaiwanStockDividend",
      providerAuthoritativeRatio: null,
      ratio: "0.2",
      theoreticalShares: "2",
      expectedWholeShares: 2,
      fractionalRemainder: "0",
      requiresHighRatioConfirmation: false,
      drift: null,
      auditInput: {
        actorUserId: "user-1",
        metadata: { source: "postgres-history-regression" },
      },
    });

    const detail = await persistence.getDividendReviewRowDetail("user-1", ledger.id);
    expect(detail?.activeCalculation).toMatchObject({
      id: amended.id,
      status: "amended",
      supersededAt: null,
    });
    expect(detail?.calculationHistory).toEqual([
      expect.objectContaining({
        id: amended.id,
        status: "amended",
        supersededAt: null,
      }),
      expect.objectContaining({
        id: "calculation-history-v1",
        status: "confirmed",
        supersededAt: expect.any(String),
      }),
    ]);
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
      stockProviderValue: "1",
      stockProviderValueUnit: "TWD_PER_SHARE",
      stockProviderSource: "finmind",
      stockProviderDataset: "TaiwanStockDividend",
      source: "test",
    }, {
      id: "event-per-lot-fifo",
      ticker: "LOT",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-03-02",
      paymentDate: "2026-03-21",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    }, {
      id: "event-mixed-null-order",
      ticker: "ORDER",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-03-03",
      paymentDate: "2026-03-22",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    }, {
      id: "event-invalid-fraction",
      ticker: "BAD",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-03-04",
      paymentDate: "2026-03-23",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    }, {
      id: "event-insufficient-sell",
      ticker: "SHORT",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-03-05",
      paymentDate: "2026-03-24",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    }, {
      id: "event-reversal-supersession",
      ticker: "REV",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-03-06",
      paymentDate: "2026-03-25",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
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
    }, ...[
      { id: "lot-buy-3", ticker: "LOT", type: "BUY" as const, quantity: 3, tradeDate: "2026-01-01", bookingSequence: 10 },
      { id: "lot-buy-5", ticker: "LOT", type: "BUY" as const, quantity: 5, tradeDate: "2026-01-02", bookingSequence: 11 },
      { id: "lot-sell-2", ticker: "LOT", type: "SELL" as const, quantity: 2, tradeDate: "2026-02-02", bookingSequence: 12 },
      { id: "order-buy", ticker: "ORDER", type: "BUY" as const, quantity: 3, tradeDate: "2026-02-01", bookingSequence: 20,
        tradeTimestamp: "2026-02-01T09:00:00.000Z" },
      { id: "bad-buy", ticker: "BAD", type: "BUY" as const, quantity: 3, tradeDate: "2026-01-01", bookingSequence: 30 },
      { id: "short-buy", ticker: "SHORT", type: "BUY" as const, quantity: 1, tradeDate: "2026-01-01", bookingSequence: 40 },
      { id: "short-sell", ticker: "SHORT", type: "SELL" as const, quantity: 2, tradeDate: "2026-02-01", bookingSequence: 41 },
      { id: "rev-buy", ticker: "REV", type: "BUY" as const, quantity: 3, tradeDate: "2026-01-01", bookingSequence: 50 },
    ].map((trade) => ({
      ...trade,
      userId: "user-1",
      accountId,
      marketCode: "TW" as const,
      instrumentType: "STOCK" as const,
      unitPrice: 100,
      priceCurrency: "TWD",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    })));
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
      {
        id: "per-lot-reverse-split",
        accountId,
        ticker: "LOT",
        marketCode: "TW",
        actionType: "REVERSE_SPLIT",
        actionDate: "2026-02-01",
        quantity: 4,
        ratioNumerator: 1,
        ratioDenominator: 2,
        cashInLieuAmount: 1,
        source: "test",
        bookedAt: "2026-02-01T09:00:00.000Z",
      },
      {
        id: "untimestamped-action-first",
        accountId,
        ticker: "ORDER",
        marketCode: "TW",
        actionType: "SPLIT",
        actionDate: "2026-02-01",
        quantity: 0,
        ratioNumerator: 2,
        ratioDenominator: 1,
        source: "test",
        bookedAt: "2026-02-01T09:00:00.000Z",
      },
      {
        id: "invalid-fraction-without-cil",
        accountId,
        ticker: "BAD",
        marketCode: "TW",
        actionType: "REVERSE_SPLIT",
        actionDate: "2026-02-01",
        quantity: 1,
        ratioNumerator: 1,
        ratioDenominator: 2,
        source: "test",
        bookedAt: "2026-02-01T09:00:00.000Z",
      },
      {
        id: "reversed-split",
        accountId,
        ticker: "REV",
        marketCode: "TW",
        actionType: "SPLIT",
        actionDate: "2026-02-01",
        quantity: 6,
        ratioNumerator: 2,
        ratioDenominator: 1,
        source: "test",
        bookedAt: "2026-02-01T09:00:00.000Z",
      },
      {
        id: "reversal-of-split",
        accountId,
        ticker: "REV",
        marketCode: "TW",
        actionType: "REVERSE_SPLIT",
        actionDate: "2026-02-02",
        quantity: 3,
        ratioNumerator: 1,
        ratioDenominator: 2,
        reversalOfPositionActionId: "reversed-split",
        source: "test",
        bookedAt: "2026-02-02T09:00:00.000Z",
      },
      {
        id: "superseded-split",
        accountId,
        ticker: "REV",
        marketCode: "TW",
        actionType: "SPLIT",
        actionDate: "2026-02-03",
        quantity: 30,
        ratioNumerator: 10,
        ratioDenominator: 1,
        supersededAt: "2026-02-04T00:00:00.000Z",
        source: "test",
        bookedAt: "2026-02-03T09:00:00.000Z",
      },
    );
    store.accounting.facts.dividendCalculationVersions.push({
      id: "calculation-expected-generated",
      userId: "user-1",
      accountId,
      dividendEventId: "event-expected-generated",
      calculationVersion: 1,
      status: "confirmed",
      method: "custom_ratio",
      providerValue: "1",
      providerUnit: "TWD_PER_SHARE",
      providerSource: "finmind",
      providerDataset: "TaiwanStockDividend",
      providerAuthoritativeRatio: null,
      selectedParValue: null,
      customRatio: "0.5",
      ratio: "0.5",
      theoreticalShares: "105",
      expectedWholeShares: 105,
      fractionalRemainder: "0",
      requiresHighRatioConfirmation: false,
      confirmedAt: "2026-02-28T09:00:00.000Z",
      priorCalculationId: null,
      dividendLedgerEntryId: null,
      drift: null,
      createdAt: "2026-02-28T09:00:00.000Z",
    });
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
    const calendarSnapshotRead = vi.spyOn(persistence, "listDividendCalendarSnapshot").mockRejectedValue(
      new Error("dividend review must not use the calendar snapshot surface"),
    );
    const singleDetailRead = vi.spyOn(persistence, "getDividendLedgerEntryWithDetails").mockRejectedValue(
      new Error("compatibility review must bulk-hydrate only the selected page"),
    );
    const review = await persistence.listDividendReviewRows("user-1", {
      page: 1,
      limit: 10,
      sortBy: "paymentDate",
      sortOrder: "desc",
    });
    const primary = await persistence.listDividendReviewPrimary("user-1", {
      page: 1,
      limit: 10,
      sortBy: "paymentDate",
      sortOrder: "desc",
    });
    const enrichment = await persistence.getDividendReviewEnrichment("user-1", {});
    expect(fullStoreRead).not.toHaveBeenCalled();
    expect(calendarSnapshotRead).not.toHaveBeenCalled();
    expect(singleDetailRead).not.toHaveBeenCalled();
    expect(primary.rows[0]).not.toHaveProperty("deductions");
    expect(primary.rows[0]).not.toHaveProperty("sourceLines");
    expect(enrichment.aggregates).toEqual(review.aggregates);
    fullStoreRead.mockRestore();
    calendarSnapshotRead.mockRestore();
    singleDetailRead.mockRestore();

    const generatedRow = review.rows.find((row) => row.id === `expected:${accountId}:event-expected-generated`);
    expect(generatedRow).toMatchObject({
      id: `expected:${accountId}:event-expected-generated`,
      rowKind: "expected",
      eligibleQuantity: 210,
      expectedCashAmount: 630,
      expectedStockQuantity: 105,
      stockDistributionRatio: 0.5,
      stockDistributionRatioState: "derived_non_authoritative",
      expectedStockCalcState: "resolved",
      provider: {
        value: "1",
        unit: "TWD_PER_SHARE",
        source: "finmind",
        dataset: "TaiwanStockDividend",
      },
      activeCalculation: expect.objectContaining({
        id: "calculation-expected-generated",
        status: "confirmed",
        method: "custom_ratio",
        expectedWholeShares: 105,
      }),
    });
    expect(review.rows.find((row) => row.id === `expected:${accountId}:event-per-lot-fifo`)).toMatchObject({
      eligibleQuantity: 1,
      expectedCashAmount: 1,
    });
    expect(review.rows.find((row) => row.id === `expected:${accountId}:event-mixed-null-order`)).toMatchObject({
      eligibleQuantity: 3,
      expectedCashAmount: 3,
    });
    expect(review.rows.some((row) => row.id === `expected:${accountId}:event-invalid-fraction`)).toBe(false);
    expect(review.rows.some((row) => row.id === `expected:${accountId}:event-insufficient-sell`)).toBe(false);
    expect(review.rows.find((row) => row.id === `expected:${accountId}:event-reversal-supersession`)).toMatchObject({
      eligibleQuantity: 3,
      expectedCashAmount: 3,
    });

    const generatedEventIndex = store.marketData.dividendEvents.findIndex((event) => event.id === "event-expected-generated");
    store.marketData.dividendEvents[generatedEventIndex] = {
      ...store.marketData.dividendEvents[generatedEventIndex]!,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
    };
    await persistence.saveStore(store);
    await persistence.resetDividendCalculation("user-1", {
      accountId,
      dividendEventId: "event-expected-generated",
      expectedActiveCalculationId: "calculation-expected-generated",
      expectedCalculationVersion: 1,
      auditInput: {
        actorUserId: "user-1",
        metadata: { source: "postgres-read-model-test" },
      },
    });

    const unresolvedReview = await persistence.listDividendReviewRows("user-1", {
      page: 1,
      limit: 10,
      sortBy: "paymentDate",
      sortOrder: "desc",
    });

    const unresolvedRow = unresolvedReview.rows.find((row) => row.id === `expected:${accountId}:event-expected-generated`);
    expect(unresolvedRow).toMatchObject({
      expectedStockQuantity: null,
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
