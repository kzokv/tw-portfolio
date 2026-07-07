import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { BookedTradeEvent, DividendEvent, DividendLedgerEntry } from "../../src/types/store.js";

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

async function seedLedgerEntry(accountId: string, dividendEventId: string): Promise<void> {
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
  };
  store.accounting.facts.dividendLedgerEntries.push(entry);
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
      receivedCashAmount: 0,
      postingStatus: "expected",
      reconciliationStatus: "open",
    });
    expect(review.aggregates.totalExpectedCashAmount).toEqual({ TWD: 3000 });
    expect(review.aggregates.openCount).toBe(1);
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
    const event = await seedDividendEvent();

    const snapshot = await app.persistence.listDividendCalendarSnapshot(USER_ID, {
      fromPaymentDate: "2024-07-01",
      toPaymentDate: "2024-07-31",
      limit: 20,
    });

    expect(snapshot.dividendEvents.map((entry) => entry.id)).toEqual([event.id]);
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
});
