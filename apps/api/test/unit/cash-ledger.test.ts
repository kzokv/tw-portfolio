import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { BookedTradeEvent, CashLedgerEntry, DividendDeductionEntry, DividendLedgerEntry } from "../../src/types/store.js";

let app: AppInstance;

/** Helper to seed a cash ledger entry directly into the store. */
function makeCashEntry(overrides: Partial<CashLedgerEntry> = {}): CashLedgerEntry {
  return {
    id: randomUUID(),
    userId: "user-1",
    accountId: "acc-1",
    entryDate: "2025-01-15",
    entryType: "TRADE_SETTLEMENT_OUT",
    amount: -10000,
    currency: "TWD",
    source: "trade_settlement",
    ...overrides,
  };
}

/** Helper to seed a booked trade event directly into the store. */
function makeTradeEvent(overrides: Partial<BookedTradeEvent> = {}): BookedTradeEvent {
  return {
    id: randomUUID(),
    userId: "user-1",
    accountId: "acc-1",
    ticker: "2330",
    // KZO-169: BookedTradeEvent.marketCode is required.
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2025-01-15",
    commissionAmount: 20,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: {
      id: "fp-default",
      // KZO-183: fee profiles are account-scoped.
      accountId: "acc-1",
      name: "Default Broker",
      boardCommissionRate: 1.425,
      commissionDiscountPercent: 0,
      minimumCommissionAmount: 20,
      commissionCurrency: "TWD",
      commissionRoundingMode: "FLOOR",
      taxRoundingMode: "FLOOR",
      stockSellTaxRateBps: 30,
      stockDayTradeTaxRateBps: 15,
      etfSellTaxRateBps: 10,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT",
    },
    ...overrides,
  };
}

/** Helper to seed a dividend ledger entry. */
function makeDividendLedgerEntry(overrides: Partial<DividendLedgerEntry> = {}): DividendLedgerEntry {
  return {
    id: randomUUID(),
    accountId: "acc-1",
    dividendEventId: "div-event-1",
    eligibleQuantity: 100,
    expectedCashAmount: 1200,
    expectedStockQuantity: 0,
    receivedCashAmount: 1080,
    receivedStockQuantity: 0,
    postingStatus: "posted",
    reconciliationStatus: "open",
    version: 1,
    sourceCompositionStatus: "provided",
    ...overrides,
  };
}

async function seedCashEntries(...entries: CashLedgerEntry[]) {
  const store = await app.persistence.loadStore("user-1");
  store.accounting.facts.cashLedgerEntries.push(...entries);
}

async function seedTradeEvents(...events: BookedTradeEvent[]) {
  const store = await app.persistence.loadStore("user-1");
  store.accounting.facts.tradeEvents.push(...events);
}

async function seedDividendLedgerEntries(...entries: DividendLedgerEntry[]) {
  const store = await app.persistence.loadStore("user-1");
  store.accounting.facts.dividendLedgerEntries.push(...entries);
}

async function seedDividendDeductionEntries(...entries: DividendDeductionEntry[]) {
  const store = await app.persistence.loadStore("user-1");
  store.accounting.facts.dividendDeductionEntries.push(...entries);
}

async function seedDividendEvents(...events: Array<{
  id: string;
  ticker: string;
  eventType: string;
  exDividendDate: string;
  paymentDate: string | null;
  cashDividendPerShare: number;
  cashDividendCurrency: string;
  stockDividendPerShare: number;
  source: string;
}>) {
  const store = await app.persistence.loadStore("user-1");
  store.marketData.dividendEvents.push(...events as typeof store.marketData.dividendEvents[number][]);
}

describe("GET /portfolio/cash-ledger", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // --- 1. Empty state ---
  it("returns empty entries and summary when no cash entries exist", async () => {
    const res = await app.inject({ method: "GET", url: "/portfolio/cash-ledger" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual({ entries: [], summary: [], total: 0 });
  });

  // --- 2. Returns all entries unfiltered ---
  it("returns all entries unfiltered", async () => {
    await seedCashEntries(
      makeCashEntry({ entryType: "TRADE_SETTLEMENT_OUT", amount: -5000, entryDate: "2025-01-10" }),
      makeCashEntry({ entryType: "TRADE_SETTLEMENT_IN", amount: 8000, entryDate: "2025-01-12" }),
      makeCashEntry({ entryType: "DIVIDEND_RECEIPT", amount: 1200, entryDate: "2025-01-14" }),
    );

    const res = await app.inject({ method: "GET", url: "/portfolio/cash-ledger" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(3);
    expect(body.summary).toHaveLength(1); // all same account + currency
  });

  // --- 3. Filter by date range ---
  it("filters entries by date range", async () => {
    await seedCashEntries(
      makeCashEntry({ entryDate: "2025-01-10", amount: -1000 }),
      makeCashEntry({ entryDate: "2025-01-15", amount: -2000 }),
      makeCashEntry({ entryDate: "2025-01-20", amount: -3000 }),
      makeCashEntry({ entryDate: "2025-01-25", amount: -4000 }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/portfolio/cash-ledger?fromEntryDate=2025-01-15&toEntryDate=2025-01-20",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(2);
    const dates = body.entries.map((e: { entryDate: string }) => e.entryDate);
    expect(dates).toContain("2025-01-15");
    expect(dates).toContain("2025-01-20");
  });

  // --- 4. Filter by accountId ---
  it("filters entries by accountId", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", amount: -1000 }),
      makeCashEntry({ accountId: "acc-1", amount: -2000 }),
      makeCashEntry({ accountId: "acc-2", amount: -3000 }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/portfolio/cash-ledger?accountId=acc-1",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries.every((e: { accountId: string }) => e.accountId === "acc-1")).toBe(true);
  });

  // --- 5. Filter by single entryType ---
  it("filters entries by single entryType", async () => {
    await seedCashEntries(
      makeCashEntry({ entryType: "TRADE_SETTLEMENT_IN", amount: 5000 }),
      makeCashEntry({ entryType: "TRADE_SETTLEMENT_OUT", amount: -3000 }),
      makeCashEntry({ entryType: "DIVIDEND_RECEIPT", amount: 1200 }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/portfolio/cash-ledger?entryType=TRADE_SETTLEMENT_IN",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].entryType).toBe("TRADE_SETTLEMENT_IN");
  });

  // --- 6. Filter by multiple entryType ---
  it("filters entries by multiple entryType values", async () => {
    await seedCashEntries(
      makeCashEntry({ entryType: "TRADE_SETTLEMENT_IN", amount: 5000 }),
      makeCashEntry({ entryType: "TRADE_SETTLEMENT_OUT", amount: -3000 }),
      makeCashEntry({ entryType: "DIVIDEND_RECEIPT", amount: 1200 }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/portfolio/cash-ledger?entryType=TRADE_SETTLEMENT_IN&entryType=DIVIDEND_RECEIPT",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(2);
    const types = body.entries.map((e: { entryType: string }) => e.entryType);
    expect(types).toContain("TRADE_SETTLEMENT_IN");
    expect(types).toContain("DIVIDEND_RECEIPT");
  });

  // --- 7. Limit applied ---
  it("applies limit to returned entries", async () => {
    await seedCashEntries(
      makeCashEntry({ amount: -1000, entryDate: "2025-01-01" }),
      makeCashEntry({ amount: -2000, entryDate: "2025-01-02" }),
      makeCashEntry({ amount: -3000, entryDate: "2025-01-03" }),
      makeCashEntry({ amount: -4000, entryDate: "2025-01-04" }),
      makeCashEntry({ amount: -5000, entryDate: "2025-01-05" }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/portfolio/cash-ledger?limit=2",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(2);
  });

  // --- 8. Enrichment — trade settlement ---
  it("enriches settlement entries with ticker, side, and tradeDetail", async () => {
    const tradeId = randomUUID();
    const trade = makeTradeEvent({
      id: tradeId,
      ticker: "2330",
      type: "BUY",
      quantity: 100,
      unitPrice: 595,
      commissionAmount: 85,
      taxAmount: 0,
    });
    await seedTradeEvents(trade);
    await seedCashEntries(
      makeCashEntry({
        entryType: "TRADE_SETTLEMENT_OUT",
        amount: -59585,
        relatedTradeEventId: tradeId,
        entryDate: "2025-01-15",
      }),
    );

    const res = await app.inject({ method: "GET", url: "/portfolio/cash-ledger" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(1);

    const entry = body.entries[0];
    expect(entry.ticker).toBe("2330");
    expect(entry.side).toBe("BUY");
    expect(entry.tradeDetail).toEqual({
      quantity: 100,
      unitPrice: 595,
      commissionAmount: 85,
      taxAmount: 0,
    });
    expect(entry.dividendDetail).toBeUndefined();
  });

  // --- 9. Enrichment — dividend ---
  it("enriches dividend entries with ticker and dividendDetail", async () => {
    const dleId = randomUUID();
    const divEventId = "div-event-1";

    await seedDividendEvents({
      id: divEventId,
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2025-02-01",
      paymentDate: "2025-02-20",
      cashDividendPerShare: 12,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    });

    await seedDividendLedgerEntries(
      makeDividendLedgerEntry({
        id: dleId,
        dividendEventId: divEventId,
        expectedCashAmount: 1200,
        receivedCashAmount: 1080,
      }),
    );

    await seedCashEntries(
      makeCashEntry({
        entryType: "DIVIDEND_RECEIPT",
        amount: 1080,
        relatedDividendLedgerEntryId: dleId,
        entryDate: "2025-02-20",
      }),
    );

    await seedDividendDeductionEntries({
      id: randomUUID(),
      dividendLedgerEntryId: dleId,
      deductionType: "WITHHOLDING_TAX",
      amount: 120,
      currencyCode: "TWD",
      withheldAtSource: true,
      source: "test",
    });

    const res = await app.inject({ method: "GET", url: "/portfolio/cash-ledger" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(1);

    const entry = body.entries[0];
    expect(entry.ticker).toBe("2330");
    expect(entry.dividendDetail).toEqual({
      expectedCashAmount: 1200,
      receivedCashAmount: 1080,
      deductionTotal: 120,
    });
    expect(entry.tradeDetail).toBeUndefined();
  });

  // --- 10. Summary computation ---
  it("computes summary subtotals per (accountId, currency) with amounts rounded to 2 decimals", async () => {
    await seedCashEntries(
      // Account 1, TWD
      makeCashEntry({ accountId: "acc-1", currency: "TWD", amount: -10000.555, entryDate: "2025-01-10" }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", amount: 5000.333, entryDate: "2025-01-11", entryType: "TRADE_SETTLEMENT_IN" }),
      // Account 1, USD
      makeCashEntry({ accountId: "acc-1", currency: "USD", amount: -250.125, entryDate: "2025-01-12" }),
      // Account 2, TWD
      makeCashEntry({ accountId: "acc-2", currency: "TWD", amount: -30000, entryDate: "2025-01-13" }),
      makeCashEntry({ accountId: "acc-2", currency: "TWD", amount: 15000.999, entryDate: "2025-01-14", entryType: "TRADE_SETTLEMENT_IN" }),
    );

    const res = await app.inject({ method: "GET", url: "/portfolio/cash-ledger" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.summary).toHaveLength(3);

    const findSummary = (accountId: string, currency: string) =>
      body.summary.find((s: { accountId: string; currency: string }) =>
        s.accountId === accountId && s.currency === currency,
      );

    const acc1Twd = findSummary("acc-1", "TWD");
    expect(acc1Twd).toBeDefined();
    expect(acc1Twd.amount).toBeCloseTo(-5000.22, 2);

    const acc1Usd = findSummary("acc-1", "USD");
    expect(acc1Usd).toBeDefined();
    expect(acc1Usd.amount).toBeCloseTo(-250.13, 2);

    const acc2Twd = findSummary("acc-2", "TWD");
    expect(acc2Twd).toBeDefined();
    expect(acc2Twd.amount).toBeCloseTo(-14999, 2);
  });

  // --- Sorting: entries returned in entryDate DESC order ---
  it("returns entries sorted by entryDate descending", async () => {
    await seedCashEntries(
      makeCashEntry({ entryDate: "2025-01-10", amount: -1000 }),
      makeCashEntry({ entryDate: "2025-01-20", amount: -2000 }),
      makeCashEntry({ entryDate: "2025-01-15", amount: -3000 }),
    );

    const res = await app.inject({ method: "GET", url: "/portfolio/cash-ledger" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const dates = body.entries.map((e: { entryDate: string }) => e.entryDate);
    expect(dates).toEqual(["2025-01-20", "2025-01-15", "2025-01-10"]);
  });

  // --- Enrichment: entries with no related events have null ticker/side ---
  it("returns null ticker and side for entries without related events", async () => {
    await seedCashEntries(
      makeCashEntry({ entryType: "MANUAL_ADJUSTMENT", amount: 500 }),
    );

    const res = await app.inject({ method: "GET", url: "/portfolio/cash-ledger" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].ticker).toBeNull();
    expect(body.entries[0].side).toBeNull();
    expect(body.entries[0].tradeDetail).toBeUndefined();
    expect(body.entries[0].dividendDetail).toBeUndefined();
  });

  it("returns paired FX transfer account names and timing headers", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounts.push({
      id: "acc-2",
      userId: "user-1",
      name: "USD Wallet",
      feeProfileId: store.feeProfiles[0]!.id,
      defaultCurrency: "USD",
      accountType: "wallet",
    });

    await seedCashEntries(
      makeCashEntry({
        id: "fx-out",
        accountId: "acc-1",
        entryType: "FX_TRANSFER_OUT",
        amount: -30000,
        currency: "TWD",
        fxTransferId: "fx-1",
      }),
      makeCashEntry({
        id: "fx-in",
        accountId: "acc-2",
        entryType: "FX_TRANSFER_IN",
        amount: 1000,
        currency: "USD",
        fxTransferId: "fx-1",
      }),
    );

    const res = await app.inject({ method: "GET", url: "/portfolio/cash-ledger?accountId=acc-1" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["server-timing"]).toContain("list_cash_ledger;dur=");
    expect(res.headers["server-timing"]).toContain("cash_ledger_enrichment;dur=");
    const body = res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].fxTransferDetail).toEqual({
      pairedAccountId: "acc-2",
      pairedAccountName: "USD Wallet",
      pairedAmount: 1000,
      pairedCurrency: "USD",
      effectiveRate: 0.03333333,
    });
  });
});
