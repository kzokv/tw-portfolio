import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import { planDividendLedgerRecompute } from "../../src/services/dividends.js";
import type { BookedTradeEvent, DividendEvent, DividendLedgerEntry, PositionAction } from "../../src/types/store.js";

const USER_ID = "user-1";

let app: AppInstance;

const defaultOpts = {
  page: 1,
  limit: 50,
  sortBy: "paymentDate" as const,
  sortOrder: "desc" as const,
};

async function seedTwdAccount(): Promise<string> {
  const store = await app.persistence.loadStore(USER_ID);
  const account = store.accounts[0]!;
  account.defaultCurrency = "TWD";
  return account.id;
}

async function seedSecondTwdAccount(name: string = "Account B"): Promise<string> {
  const store = await app.persistence.loadStore(USER_ID);
  const primary = store.accounts[0]!;
  const accountId = `acc-${store.accounts.length + 1}`;
  store.accounts.push({
    ...primary,
    id: accountId,
    name,
    defaultCurrency: "TWD",
  });
  return accountId;
}

async function seedInstrumentName(
  ticker: string,
  marketCode: "TW" | "US" | "AU" | "KR",
  name: string,
): Promise<void> {
  const store = await app.persistence.loadStore(USER_ID);
  const instrument = store.instruments.find((entry) => entry.ticker === ticker && entry.marketCode === marketCode);
  if (!instrument) throw new Error(`instrument_not_found:${ticker}:${marketCode}`);
  instrument.name = name;
}

async function seedBuy(
  accountId: string,
  ticker: string,
  quantity: number,
  tradeDate: string,
  overrides: Partial<BookedTradeEvent> = {},
): Promise<BookedTradeEvent> {
  const store = await app.persistence.loadStore(USER_ID);
  const trade: BookedTradeEvent = {
    id: randomUUID(),
    userId: USER_ID,
    accountId,
    ticker,
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate,
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: store.feeProfiles[0]!,
    ...overrides,
  };
  store.accounting.facts.tradeEvents.push(trade);
  return trade;
}

async function seedDividendEvent(overrides: Partial<DividendEvent> = {}): Promise<DividendEvent> {
  const store = await app.persistence.loadStore(USER_ID);
  const event: DividendEvent = {
    id: randomUUID(),
    ticker: "2330",
    eventType: "CASH",
    exDividendDate: "2024-06-01",
    paymentDate: "2024-07-10",
    cashDividendPerShare: 3,
    cashDividendCurrency: "TWD",
    stockDividendPerShare: 0,
    source: "test_seed",
    ...overrides,
  };
  store.marketData.dividendEvents.push(event);
  return event;
}

async function seedLedgerEntry(
  accountId: string,
  dividendEventId: string,
  overrides: Partial<DividendLedgerEntry> = {},
): Promise<void> {
  const store = await app.persistence.loadStore(USER_ID);
  const entry: DividendLedgerEntry = {
    id: randomUUID(),
    accountId,
    dividendEventId,
    eligibleQuantity: 1000,
    expectedCashAmount: 3000,
    expectedStockQuantity: 0,
    receivedCashAmount: 0,
    receivedStockQuantity: 0,
    postingStatus: "posted",
    reconciliationStatus: "open",
    version: 1,
    sourceCompositionStatus: "provided",
    ...overrides,
  };
  store.accounting.facts.dividendLedgerEntries.push(entry);
}

async function seedPositionAction(action: PositionAction): Promise<void> {
  const store = await app.persistence.loadStore(USER_ID);
  store.accounting.facts.positionActions.push(action);
}

describe("MemoryPersistence.listDividendReviewRows", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("includes expected-but-unposted eligible dividend rows without adding them to the ledger list", async () => {
    const accountId = await seedTwdAccount();
    await seedBuy(accountId, "2330", 1000, "2024-05-20");
    const event = await seedDividendEvent();

    const review = await app.persistence.listDividendReviewRows(USER_ID, defaultOpts);
    const ledger = await app.persistence.listDividendLedgerEntries(USER_ID, defaultOpts);

    expect(ledger.ledgerEntries).toEqual([]);
    expect(review.total).toBe(1);
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]).toMatchObject({
      rowKind: "expected",
      accountId,
      dividendEventId: event.id,
      ticker: "2330",
      paymentDate: "2024-07-10",
      cashCurrency: "TWD",
      eligibleQuantity: 1000,
      expectedCashAmount: 3000,
      expectedStockQuantity: 0,
      expectedStockCalcState: "resolved",
      stockDistributionRatio: null,
      receivedCashAmount: 0,
      postingStatus: "expected",
      reconciliationStatus: "open",
    });
    expect(review.aggregates.totalExpectedCashAmount).toEqual({ TWD: 3000 });
    expect(review.aggregates.openCount).toBe(1);
  });

  it("excludes materialized expected ledger rows when expected rows are disabled", async () => {
    const accountId = await seedTwdAccount();
    const event = await seedDividendEvent();
    await seedLedgerEntry(accountId, event.id, { postingStatus: "expected" });

    const review = await app.persistence.listDividendReviewRows(USER_ID, {
      ...defaultOpts,
      excludeExpected: true,
      reconciliationStatus: "open",
    });

    expect(review.rows).toEqual([]);
    expect(review.total).toBe(0);
    expect(review.aggregates.openCount).toBe(0);
  });

  it("backfill recompute refreshes unresolved stock entitlement state when quantity changes", async () => {
    const accountId = await seedTwdAccount();
    await seedBuy(accountId, "2330", 100, "2024-05-20");
    const event = await seedDividendEvent({
      eventType: "STOCK",
      cashDividendPerShare: 0,
      stockDividendPerShare: 3,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockParValueAmount: 10,
    });
    await seedLedgerEntry(accountId, event.id, {
      eligibleQuantity: 0,
      expectedCashAmount: 0,
      expectedStockQuantity: 0,
      expectedStockCalcState: "resolved",
      expectedStockDistributionRatio: 0,
      expectedStockParValueAmount: null,
    });

    const store = await app.persistence.loadStore(USER_ID);
    const changes = planDividendLedgerRecompute(store, accountId, "2330", {
      resetReconciliation: false,
      marketCode: "TW",
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]?.nextEntry).toEqual(expect.objectContaining({
      eligibleQuantity: 100,
      expectedStockQuantity: 0,
      expectedStockCalcState: "needs_action",
      expectedStockDistributionRatio: null,
      expectedStockParValueAmount: 10,
    }));
  });

  it("preserves undated events when a payment-date range is active", async () => {
    const accountId = await seedTwdAccount();
    const event = await seedDividendEvent({ paymentDate: null });
    await seedLedgerEntry(accountId, event.id);

    const review = await app.persistence.listDividendReviewRows(USER_ID, {
      ...defaultOpts,
      fromPaymentDate: "2024-07-01",
      toPaymentDate: "2024-07-31",
    });

    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]).toEqual(expect.objectContaining({
      dividendEventId: event.id,
      paymentDate: null,
    }));
  });

  it("builds generated expected rows from replay-style eligibility and authoritative stock ratios", async () => {
    const accountId = await seedTwdAccount();
    const buy = await seedBuy(accountId, "2330", 100, "2024-05-01");
    await seedPositionAction({
      id: "split-before-ex-div",
      accountId,
      ticker: "2330",
      marketCode: "TW",
      actionType: "SPLIT",
      actionDate: "2024-05-10",
      quantity: 100,
      ratioNumerator: 2,
      ratioDenominator: 1,
      source: "test",
    });
    await seedPositionAction({
      id: "stock-dividend-before-ex-div",
      accountId,
      ticker: "2330",
      marketCode: "TW",
      actionType: "STOCK_DIVIDEND",
      actionDate: "2024-05-20",
      quantity: 10,
      relatedDividendLedgerEntryId: "prior-ledger",
      source: "test",
    });
    const event = await seedDividendEvent({
      eventType: "CASH_AND_STOCK",
      cashDividendPerShare: 3,
      stockDividendPerShare: 3,
      stockDistributionRatio: 0.25,
      stockDistributionRatioState: "authoritative",
      stockParValueAmount: 10,
      exDividendDate: "2024-06-01",
      paymentDate: "2024-07-10",
    });

    const review = await app.persistence.listDividendReviewRows(USER_ID, defaultOpts);

    expect(buy.id).toBeTruthy();
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]).toMatchObject({
      id: `expected:${accountId}:${event.id}`,
      rowKind: "expected",
      eligibleQuantity: 210,
      expectedCashAmount: 630,
      expectedStockQuantity: 52,
      stockDistributionRatio: 0.25,
      stockDistributionRatioState: "authoritative",
      expectedStockCalcState: "resolved",
    });
  });

  it("marks generated expected stock quantity as needs-action when the authoritative ratio is unresolved", async () => {
    const accountId = await seedTwdAccount();
    await seedBuy(accountId, "2330", 100, "2024-05-01");
    const event = await seedDividendEvent({
      eventType: "CASH_AND_STOCK",
      cashDividendPerShare: 3,
      stockDividendPerShare: 3,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockParValueAmount: 10,
    });

    const review = await app.persistence.listDividendReviewRows(USER_ID, defaultOpts);

    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]).toMatchObject({
      id: `expected:${accountId}:${event.id}`,
      expectedStockQuantity: 0,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      expectedStockCalcState: "needs_action",
    });
  });

  it("does not duplicate an expected row when a ledger row already exists for the account and dividend event", async () => {
    const accountId = await seedTwdAccount();
    await seedBuy(accountId, "2330", 1000, "2024-05-20");
    const event = await seedDividendEvent();
    await seedLedgerEntry(accountId, event.id);

    const review = await app.persistence.listDividendReviewRows(USER_ID, defaultOpts);

    expect(review.total).toBe(1);
    expect(review.rows.map(row => row.rowKind)).toEqual(["ledger"]);
  });

  it("derives typed net reconciliation fields and unresolved stock state for review rows", async () => {
    const accountId = await seedTwdAccount();
    await seedBuy(accountId, "2330", 1000, "2024-05-20");
    const event = await seedDividendEvent({
      eventType: "CASH_AND_STOCK",
      cashDividendPerShare: 3,
      stockDividendPerShare: 0.1,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
    });
    const store = await app.persistence.loadStore(USER_ID);
    const entry: DividendLedgerEntry = {
      id: randomUUID(),
      accountId,
      dividendEventId: event.id,
      eligibleQuantity: 1000,
      expectedCashAmount: 3000,
      expectedStockQuantity: 0,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "provided",
    };
    store.accounting.facts.dividendLedgerEntries.push(entry);
    store.accounting.facts.cashLedgerEntries.push({
      id: randomUUID(),
      userId: USER_ID,
      accountId,
      entryDate: "2024-07-10",
      entryType: "DIVIDEND_RECEIPT",
      amount: 2860,
      currency: "TWD",
      relatedDividendLedgerEntryId: entry.id,
      source: "test",
    });
    store.accounting.facts.dividendDeductionEntries.push(
      {
        id: randomUUID(),
        dividendLedgerEntryId: entry.id,
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 100,
        currencyCode: "TWD",
        withheldAtSource: true,
        source: "test",
      },
      {
        id: randomUUID(),
        dividendLedgerEntryId: entry.id,
        deductionType: "BANK_FEE",
        amount: 20,
        currencyCode: "TWD",
        withheldAtSource: true,
        source: "test",
      },
      {
        id: randomUUID(),
        dividendLedgerEntryId: entry.id,
        deductionType: "OTHER",
        amount: 5,
        currencyCode: "TWD",
        withheldAtSource: true,
        source: "test",
      },
    );

    const review = await app.persistence.listDividendReviewRows(USER_ID, defaultOpts);

    expect(review.rows[0]).toMatchObject({
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      expectedStockCalcState: "needs_action",
      nhiAmount: 100,
      bankFeeAmount: 20,
      otherDeductionAmount: 5,
      expectedNetAmount: 2875,
      actualNetAmount: 2860,
      varianceAmount: -15,
    });
  });

  it("orders mixed ledger and expected review rows deterministically when the primary sort ties", async () => {
    const accountA = await seedTwdAccount();
    const accountB = await seedSecondTwdAccount();
    const store = await app.persistence.loadStore(USER_ID);
    store.accounts.find((account) => account.id === accountA)!.name = "Account A";
    await seedBuy(accountA, "AAA", 100, "2024-05-01");
    await seedBuy(accountB, "AAA", 100, "2024-05-01");
    await seedBuy(accountA, "ZZZ", 100, "2024-05-01");

    const sharedEventA = await seedDividendEvent({
      id: "event-aaa-a",
      ticker: "AAA",
      marketCode: "TW",
      exDividendDate: "2024-06-01",
      paymentDate: "2024-07-10",
      cashDividendPerShare: 2,
    });
    const sharedEventB = await seedDividendEvent({
      id: "event-aaa-b",
      ticker: "AAA",
      marketCode: "TW",
      exDividendDate: "2024-06-01",
      paymentDate: "2024-07-10",
      cashDividendPerShare: 2,
    });
    const earlierEvent = await seedDividendEvent({
      id: "event-zzz-earlier",
      ticker: "ZZZ",
      marketCode: "TW",
      exDividendDate: "2024-05-25",
      paymentDate: "2024-07-09",
      cashDividendPerShare: 2,
    });
    const laterTickerEvent = await seedDividendEvent({
      id: "event-zzz-later",
      ticker: "ZZZ",
      marketCode: "TW",
      exDividendDate: "2024-06-01",
      paymentDate: "2024-07-10",
      cashDividendPerShare: 2,
    });
    const tiedLedgerValues = { eligibleQuantity: 100, expectedCashAmount: 200 };
    await seedLedgerEntry(accountB, sharedEventA.id, { id: "ledger-aaa-a", ...tiedLedgerValues });
    await seedLedgerEntry(accountB, sharedEventB.id, { id: "ledger-aaa-b", ...tiedLedgerValues });
    await seedLedgerEntry(accountA, earlierEvent.id, { id: "ledger-zzz-earlier", ...tiedLedgerValues });
    await seedLedgerEntry(accountA, laterTickerEvent.id, { id: "ledger-zzz-later", ...tiedLedgerValues });

    const review = await app.persistence.listDividendReviewRows(USER_ID, {
      ...defaultOpts,
      page: 1,
      limit: 10,
      sortBy: "expectedNetAmount",
      sortOrder: "asc",
    });

    expect(review.rows.map((row) => ({
      id: row.id,
      rowKind: row.rowKind,
      accountId: row.accountId,
      ticker: row.ticker,
      paymentDate: row.paymentDate,
      expectedNetAmount: row.expectedNetAmount,
    }))).toEqual([
      {
        id: "ledger-zzz-earlier",
        rowKind: "ledger",
        accountId: accountA,
        ticker: "ZZZ",
        paymentDate: "2024-07-09",
        expectedNetAmount: 200,
      },
      {
        id: `expected:${accountA}:${sharedEventA.id}`,
        rowKind: "expected",
        accountId: accountA,
        ticker: "AAA",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
      {
        id: `expected:${accountA}:${sharedEventB.id}`,
        rowKind: "expected",
        accountId: accountA,
        ticker: "AAA",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
      {
        id: "ledger-aaa-a",
        rowKind: "ledger",
        accountId: accountB,
        ticker: "AAA",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
      {
        id: "ledger-aaa-b",
        rowKind: "ledger",
        accountId: accountB,
        ticker: "AAA",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
      {
        id: "ledger-zzz-later",
        rowKind: "ledger",
        accountId: accountA,
        ticker: "ZZZ",
        paymentDate: "2024-07-10",
        expectedNetAmount: 200,
      },
    ]);
  });

  it("does not build expected rows from same-ticker trades in another market", async () => {
    const accountId = await seedTwdAccount();
    await seedBuy(accountId, "2330", 1000, "2024-05-20", {
      marketCode: "US",
      priceCurrency: "USD",
    });
    await seedDividendEvent();

    const review = await app.persistence.listDividendReviewRows(USER_ID, defaultOpts);

    expect(review.rows).toEqual([]);
    expect(review.total).toBe(0);
  });

  it("does not build expected rows from reversed trade pairs", async () => {
    const accountId = await seedTwdAccount();
    const original = await seedBuy(accountId, "2330", 1000, "2024-05-20");
    await seedBuy(accountId, "2330", 1000, "2024-05-20", {
      reversalOfTradeEventId: original.id,
    });
    await seedDividendEvent();

    const review = await app.persistence.listDividendReviewRows(USER_ID, defaultOpts);

    expect(review.rows).toEqual([]);
    expect(review.total).toBe(0);
  });

  it("excludes reversed trade pairs from dividend calendar snapshot trade context", async () => {
    const accountId = await seedTwdAccount();
    const original = await seedBuy(accountId, "2330", 1000, "2024-05-20");
    await seedBuy(accountId, "2330", 1000, "2024-05-20", {
      reversalOfTradeEventId: original.id,
    });
    await seedDividendEvent();

    const snapshot = await app.persistence.listDividendCalendarSnapshot(USER_ID, {
      fromPaymentDate: "2024-07-01",
      toPaymentDate: "2024-07-31",
      limit: 20,
    });

    expect(snapshot.dividendEvents).toEqual([]);
    expect(snapshot.tradeEvents).toEqual([]);
  });

  it("applies account eligibility before limiting dividend calendar snapshot events", async () => {
    const accountId = await seedTwdAccount();
    await seedDividendEvent({
      ticker: "1111",
      marketCode: "TW",
      paymentDate: "2024-07-01",
      exDividendDate: "2024-06-01",
    });
    await seedDividendEvent({
      ticker: "2222",
      marketCode: "TW",
      paymentDate: "2024-07-02",
      exDividendDate: "2024-06-02",
    });
    const heldEvent = await seedDividendEvent({
      ticker: "2330",
      marketCode: "TW",
      paymentDate: "2024-07-03",
      exDividendDate: "2024-06-03",
    });
    await seedBuy(accountId, "2330", 1000, "2024-05-20");

    const snapshot = await app.persistence.listDividendCalendarSnapshot(USER_ID, {
      accountId,
      fromPaymentDate: "2024-07-01",
      toPaymentDate: "2024-07-31",
      limit: 2,
    });

    expect(snapshot.dividendEvents.map((entry) => entry.id)).toEqual([heldEvent.id]);
    expect(snapshot.tradeEvents.map((entry) => entry.ticker)).toEqual(["2330"]);
  });

  it("applies all-account eligibility before limiting dividend calendar snapshot events", async () => {
    const accountId = await seedTwdAccount();
    await seedDividendEvent({
      ticker: "1111",
      marketCode: "TW",
      paymentDate: "2024-08-01",
      exDividendDate: "2024-07-01",
    });
    await seedDividendEvent({
      ticker: "2222",
      marketCode: "TW",
      paymentDate: "2024-08-02",
      exDividendDate: "2024-07-02",
    });
    const heldEvent = await seedDividendEvent({
      ticker: "2330",
      marketCode: "TW",
      paymentDate: "2024-08-03",
      exDividendDate: "2024-07-03",
    });
    await seedBuy(accountId, "2330", 1000, "2024-06-20");

    const snapshot = await app.persistence.listDividendCalendarSnapshot(USER_ID, {
      fromPaymentDate: "2024-08-01",
      toPaymentDate: "2024-08-31",
      limit: 2,
    });

    expect(snapshot.dividendEvents.map((entry) => entry.id)).toEqual([heldEvent.id]);
    expect(snapshot.tradeEvents.map((entry) => entry.ticker)).toEqual(["2330"]);
  });

  it("excludes expected-only rows from posted open reconciliation filters", async () => {
    const accountId = await seedTwdAccount();
    await seedBuy(accountId, "2330", 1000, "2024-05-20");
    await seedDividendEvent();

    const review = await app.persistence.listDividendReviewRows(USER_ID, {
      ...defaultOpts,
      postingStatus: "posted",
      reconciliationStatus: "open",
    });

    expect(review.rows).toEqual([]);
    expect(review.total).toBe(0);
  });

  it("filters same-ticker review rows by market code", async () => {
    const accountId = await seedTwdAccount();
    const twEvent = await seedDividendEvent({
      ticker: "DUAL",
      marketCode: "TW",
      cashDividendCurrency: "TWD",
    });
    const usEvent = await seedDividendEvent({
      ticker: "DUAL",
      marketCode: "US",
      cashDividendCurrency: "USD",
    });
    await seedLedgerEntry(accountId, twEvent.id);
    await seedLedgerEntry(accountId, usEvent.id);

    const review = await app.persistence.listDividendReviewRows(USER_ID, {
      ...defaultOpts,
      ticker: "DUAL",
      marketCode: "TW",
    });

    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]).toMatchObject({
      dividendEventId: twEvent.id,
      ticker: "DUAL",
    });
  });

  it("exposes expected rows on the review route while keeping the ledger route ledger-only", async () => {
    const accountId = await seedTwdAccount();
    await seedInstrumentName("2330", "TW", "TSMC");
    await seedBuy(accountId, "2330", 1000, "2024-05-20");
    const event = await seedDividendEvent();

    const reviewResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review?ticker=2330&fromPaymentDate=2024-01-01&toPaymentDate=2024-12-31",
    });
    const ledgerResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?ticker=2330&fromPaymentDate=2024-01-01&toPaymentDate=2024-12-31",
    });

    expect(reviewResponse.statusCode).toBe(200);
    expect(ledgerResponse.statusCode).toBe(200);
    expect(reviewResponse.json()).toMatchObject({
      total: 1,
      reviewRows: [
        {
          rowKind: "expected",
          accountId,
          dividendEventId: event.id,
          ticker: "2330",
          tickerName: "TSMC",
          marketCode: "TW",
        },
      ],
    });
    expect(ledgerResponse.json()).toMatchObject({
      total: 0,
      ledgerEntries: [],
    });
  });

  it("returns paying-today and ex-dividend-today independently by market-local date", async () => {
    const accountId = await seedTwdAccount();
    await seedBuy(accountId, "2330", 1000, "2024-05-20");
    await seedBuy(accountId, "AAPL", 1000, "2024-05-20", {
      marketCode: "US",
      priceCurrency: "USD",
    });
    await seedDividendEvent({
      ticker: "2330",
      marketCode: "TW",
      cashDividendCurrency: "TWD",
      exDividendDate: "2026-07-10",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 3,
    });
    await seedDividendEvent({
      ticker: "AAPL",
      marketCode: "US",
      cashDividendCurrency: "USD",
      exDividendDate: "2026-07-25",
      paymentDate: "2026-07-09",
      cashDividendPerShare: 1,
    });

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/daily-highlights?at=2026-07-10T03:30:00.000Z",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      payingToday: [
        expect.objectContaining({
          ticker: "AAPL",
          marketCode: "US",
          paymentDate: "2026-07-09",
          applicableLocalDate: "2026-07-09",
        }),
      ],
      exDividendToday: [
        expect.objectContaining({
          ticker: "2330",
          marketCode: "TW",
          exDividendDate: "2026-07-10",
          paymentDate: "2026-08-20",
          applicableLocalDate: "2026-07-10",
        }),
      ],
    });
  });

  it("enriches stock dividend review route rows with amendable correction metadata", async () => {
    const accountId = await seedTwdAccount();
    await seedInstrumentName("2330", "TW", "TSMC");
    await seedBuy(accountId, "2330", 100, "2024-05-20");
    const event = await seedDividendEvent({
      eventType: "STOCK",
      stockDividendPerShare: 0.1,
      cashDividendPerShare: 0,
    });
    const store = await app.persistence.loadStore(USER_ID);
    const ledgerEntry: DividendLedgerEntry = {
      id: randomUUID(),
      accountId,
      dividendEventId: event.id,
      eligibleQuantity: 100,
      expectedCashAmount: 0,
      expectedStockQuantity: 10,
      receivedCashAmount: 0,
      receivedStockQuantity: 10,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "unknown_pending_disclosure",
    };
    const positionAction: PositionAction = {
      id: randomUUID(),
      accountId,
      ticker: "2330",
      marketCode: "TW",
      actionType: "STOCK_DIVIDEND",
      actionDate: "2024-07-10",
      quantity: 10,
      parValuePerShare: 10,
      premiumBaseAmount: 100,
      nhiPremiumBaseAmount: 100,
      relatedDividendLedgerEntryId: ledgerEntry.id,
      source: "dividend_posting",
    };
    store.accounting.facts.dividendLedgerEntries.push(ledgerEntry);
    store.accounting.facts.positionActions.push(positionAction);

    const reviewResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review?ticker=2330&fromPaymentDate=2024-01-01&toPaymentDate=2024-12-31",
    });

    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewResponse.json()).toMatchObject({
      total: 1,
      reviewRows: [
        {
          id: ledgerEntry.id,
          rowKind: "ledger",
          eventType: "STOCK",
          correctionMode: "amend",
          amendmentBlockedReason: null,
          linkedPositionActionId: positionAction.id,
          linkedPositionActionStatus: "posted",
          receivedStockQuantity: 10,
          parValueBaseAmount: 100,
          portfolioCostBasisAddedAmount: 0,
        },
      ],
    });
  });
});
