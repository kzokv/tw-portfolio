import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type {
  CashLedgerEntry,
  DividendEvent,
  DividendLedgerEntry,
} from "../../src/types/store.js";

let app: AppInstance;
const USER_ID = "user-1";

// ── Seeding helpers ──────────────────────────────────────────────────────────

async function seedAccount(id: string, name: string): Promise<void> {
  const store = await app.persistence.loadStore(USER_ID);
  if (store.accounts.some((a) => a.id === id)) return;
  store.accounts.push({
    id,
    name,
    userId: USER_ID,
    feeProfileId: store.feeProfiles[0]!.id,
  });
}

async function seedDividendEvent(overrides: Partial<DividendEvent> = {}): Promise<DividendEvent> {
  const store = await app.persistence.loadStore(USER_ID);
  const evt: DividendEvent = {
    id: randomUUID(),
    ticker: "AAPL",
    eventType: "CASH",
    exDividendDate: "2024-03-01",
    paymentDate: "2024-03-15",
    cashDividendPerShare: 1,
    cashDividendCurrency: "USD",
    stockDividendPerShare: 0,
    source: "test_seed",
    ...overrides,
  };
  store.marketData.dividendEvents.push(evt);
  return evt;
}

async function seedLedgerEntry(
  overrides: Partial<DividendLedgerEntry> = {},
): Promise<DividendLedgerEntry> {
  const store = await app.persistence.loadStore(USER_ID);
  const entry: DividendLedgerEntry = {
    id: randomUUID(),
    accountId: "acc-1",
    dividendEventId: "replace-me",
    eligibleQuantity: 10,
    expectedCashAmount: 100,
    expectedStockQuantity: 0,
    receivedCashAmount: 100,
    receivedStockQuantity: 0,
    postingStatus: "posted",
    reconciliationStatus: "open",
    version: 1,
    sourceCompositionStatus: "provided",
    ...overrides,
  };
  store.accounting.facts.dividendLedgerEntries.push(entry);
  return entry;
}

/** Seed a DIVIDEND_RECEIPT cash ledger entry so received-amount subqueries see it. */
async function seedReceipt(
  ledgerEntryId: string,
  amount: number,
  currency: string,
  accountId: string = "acc-1",
): Promise<void> {
  const store = await app.persistence.loadStore(USER_ID);
  const entry: CashLedgerEntry = {
    id: randomUUID(),
    userId: USER_ID,
    accountId,
    entryDate: "2024-03-15",
    entryType: "DIVIDEND_RECEIPT",
    amount,
    currency,
    relatedDividendLedgerEntryId: ledgerEntryId,
    source: "test_seed",
  };
  store.accounting.facts.cashLedgerEntries.push(entry);
}

/**
 * Convenience: create a dividend event + ledger entry + receipt pair in one call.
 * Returns the ledger entry id so the caller can reference it in assertions.
 */
async function seedFullEntry(params: {
  ticker: string;
  currency: string;
  paymentDate: string | null;
  expected: number;
  received: number;
  reconciliationStatus?: DividendLedgerEntry["reconciliationStatus"];
  accountId?: string;
  postingStatus?: DividendLedgerEntry["postingStatus"];
}): Promise<DividendLedgerEntry> {
  const evt = await seedDividendEvent({
    ticker: params.ticker,
    cashDividendCurrency: params.currency,
    paymentDate: params.paymentDate,
    exDividendDate: params.paymentDate ?? "2024-01-01",
  });
  const entry = await seedLedgerEntry({
    accountId: params.accountId ?? "acc-1",
    dividendEventId: evt.id,
    expectedCashAmount: params.expected,
    receivedCashAmount: params.received,
    reconciliationStatus: params.reconciliationStatus ?? "open",
    postingStatus: params.postingStatus ?? "posted",
  });
  if (params.received !== 0) {
    await seedReceipt(entry.id, params.received, params.currency, params.accountId ?? "acc-1");
  }
  return entry;
}

// ── Default query options ─────────────────────────────────────────────────────

const defaultOpts = {
  page: 1,
  limit: 50,
  sortBy: "paymentDate" as const,
  sortOrder: "desc" as const,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MemoryPersistence.listDividendLedgerEntries — filter/sort/page/aggregates", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── 1.1 Ticker filter ─────────────────────────────────────────────────────

  it("UM-01: ticker filter → returns only matching ticker rows and correct total", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-04-15", expected: 200, received: 200 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-05-15", expected: 300, received: 300 });
    await seedFullEntry({ ticker: "GOOG", currency: "USD", paymentDate: "2024-06-15", expected: 400, received: 400 });
    await seedFullEntry({ ticker: "GOOG", currency: "USD", paymentDate: "2024-07-15", expected: 500, received: 500 });

    const result = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      ticker: "AAPL",
    });

    expect(result.ledgerEntries).toHaveLength(3);
    expect(result.total).toBe(3);
    const eventIds = new Set(result.ledgerEntries.map((e) => e.dividendEventId));
    const store = await app.persistence.loadStore(USER_ID);
    for (const id of eventIds) {
      expect(store.marketData.dividendEvents.find((ev) => ev.id === id)?.ticker).toBe("AAPL");
    }
  });

  it("UM-02: ticker filter with no matches → empty array, total 0, aggregates empty", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });

    const result = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      ticker: "MSFT",
    });

    expect(result.ledgerEntries).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.aggregates.openCount).toBe(0);
    expect(result.aggregates.totalExpectedCashAmount).toEqual({});
    expect(result.aggregates.totalReceivedCashAmount).toEqual({});
    expect(result.aggregates.byMonth).toEqual({});
    expect(result.aggregates.byTicker).toEqual({});
  });

  // ── 1.2 Sort behavior ─────────────────────────────────────────────────────

  it("UM-03/04: sortBy=paymentDate asc and desc", async () => {
    const aprId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-04-15", expected: 200, received: 200 })
    ).id;
    const marId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 })
    ).id;
    const mayId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-05-15", expected: 300, received: 300 })
    ).id;

    const asc = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "paymentDate",
      sortOrder: "asc",
    });
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([marId, aprId, mayId]);

    const desc = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "paymentDate",
      sortOrder: "desc",
    });
    expect(desc.ledgerEntries.map((e) => e.id)).toEqual([mayId, aprId, marId]);
  });

  it("UM-05: sortBy=ticker sorts alphabetically by event ticker", async () => {
    const msftId = (
      await seedFullEntry({ ticker: "MSFT", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 })
    ).id;
    const aaplId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 100, received: 100 })
    ).id;
    const googId = (
      await seedFullEntry({ ticker: "GOOG", currency: "USD", paymentDate: "2024-03-17", expected: 100, received: 100 })
    ).id;

    const asc = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "ticker",
      sortOrder: "asc",
    });
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([aaplId, googId, msftId]);
  });

  it("UM-06: sortBy=account sorts by account display name", async () => {
    // Default account "Main" (acc-1) + new "Alpha Broker" (acc-2) + "Zeta Broker" (acc-3)
    await seedAccount("acc-2", "Alpha Broker");
    await seedAccount("acc-3", "Zeta Broker");

    const mainId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100, accountId: "acc-1" })
    ).id; // "Main"
    const zetaId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 100, received: 100, accountId: "acc-3" })
    ).id; // "Zeta Broker"
    const alphaId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17", expected: 100, received: 100, accountId: "acc-2" })
    ).id; // "Alpha Broker"

    const asc = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "account",
      sortOrder: "asc",
    });
    // Alpha < Main < Zeta alphabetically
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([alphaId, mainId, zetaId]);
  });

  it("UM-07: sortBy=expectedCashAmount numerically", async () => {
    const midId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 200, received: 200 })
    ).id;
    const lowId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 50, received: 50 })
    ).id;
    const highId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17", expected: 1000, received: 1000 })
    ).id;

    const desc = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "expectedCashAmount",
      sortOrder: "desc",
    });
    expect(desc.ledgerEntries.map((e) => e.id)).toEqual([highId, midId, lowId]);
  });

  it("UM-08: sortBy=receivedCashAmount numerically", async () => {
    const midId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 200, received: 150 })
    ).id;
    const lowId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 200, received: 20 })
    ).id;
    const highId = (
      await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17", expected: 200, received: 900 })
    ).id;

    const asc = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "receivedCashAmount",
      sortOrder: "asc",
    });
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([lowId, midId, highId]);
  });

  it("UM-09: sortBy=reconciliationStatus lexicographic", async () => {
    const openId = (
      await seedFullEntry({
        ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100,
        reconciliationStatus: "open",
      })
    ).id;
    const matchedId = (
      await seedFullEntry({
        ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 100, received: 100,
        reconciliationStatus: "matched",
      })
    ).id;
    const explainedId = (
      await seedFullEntry({
        ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17", expected: 100, received: 100,
        reconciliationStatus: "explained",
      })
    ).id;

    const asc = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "reconciliationStatus",
      sortOrder: "asc",
    });
    // 'explained' < 'matched' < 'open'
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([explainedId, matchedId, openId]);
  });

  it("UM-10: stable id tiebreaker — tied sort values preserve id ASC in both directions", async () => {
    // Two entries with identical expectedCashAmount but distinct ids.
    // Seeding with explicit ids lets us assert exact tiebreaker ordering.
    const idA = "00000000-0000-4000-8000-aaaaaaaaaaaa";
    const idB = "00000000-0000-4000-8000-bbbbbbbbbbbb";
    const evt = await seedDividendEvent({
      ticker: "AAPL",
      cashDividendCurrency: "USD",
      paymentDate: "2024-03-15",
      exDividendDate: "2024-03-01",
    });
    await seedLedgerEntry({ id: idA, dividendEventId: evt.id, expectedCashAmount: 100 });
    await seedLedgerEntry({ id: idB, dividendEventId: evt.id, expectedCashAmount: 100 });

    const asc = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "expectedCashAmount",
      sortOrder: "asc",
    });
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([idA, idB]);

    const desc = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "expectedCashAmount",
      sortOrder: "desc",
    });
    // Primary sort desc on a tie: id tiebreaker stays ASC (stable, not flipped)
    expect(desc.ledgerEntries.map((e) => e.id)).toEqual([idA, idB]);
  });

  // ── 1.3 Pagination ────────────────────────────────────────────────────────

  it("UM-11/12/13: page/limit slicing returns correct windows with total preserved", async () => {
    // 5 entries sorted desc by paymentDate → index 0 is 2024-05-15, index 4 is 2024-01-15
    const e1 = (await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-01-15", expected: 10, received: 10 })).id;
    const e2 = (await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-02-15", expected: 20, received: 20 })).id;
    const e3 = (await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 30, received: 30 })).id;
    const e4 = (await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-04-15", expected: 40, received: 40 })).id;
    const e5 = (await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-05-15", expected: 50, received: 50 })).id;

    const page1 = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, page: 1, limit: 2,
    });
    expect(page1.ledgerEntries.map((e) => e.id)).toEqual([e5, e4]);
    expect(page1.total).toBe(5);

    const page2 = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, page: 2, limit: 2,
    });
    expect(page2.ledgerEntries.map((e) => e.id)).toEqual([e3, e2]);
    expect(page2.total).toBe(5);

    const page3 = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, page: 3, limit: 2,
    });
    expect(page3.ledgerEntries.map((e) => e.id)).toEqual([e1]);
    expect(page3.total).toBe(5);
  });

  it("UM-14: page past end → empty array but total reflects full filtered count", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-04-15", expected: 100, received: 100 });

    const result = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, page: 99, limit: 50,
    });
    expect(result.ledgerEntries).toEqual([]);
    expect(result.total).toBe(2);
  });

  // ── 1.4 Aggregates over FULL filtered set ─────────────────────────────────

  it("UM-15/16: totalExpectedCashAmount + totalReceivedCashAmount currency-keyed sum over full set", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 90 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 200, received: 180 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17", expected: 50, received: 50 });
    await seedFullEntry({ ticker: "2330", currency: "TWD", paymentDate: "2024-03-18", expected: 300, received: 270 });
    await seedFullEntry({ ticker: "2330", currency: "TWD", paymentDate: "2024-03-19", expected: 400, received: 360 });

    // Page=1 limit=2 deliberately truncates visible rows — aggregates must still reflect all 5.
    const result = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, page: 1, limit: 2,
    });

    expect(result.ledgerEntries).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.aggregates.totalExpectedCashAmount).toEqual({ USD: 350, TWD: 700 });
    expect(result.aggregates.totalReceivedCashAmount).toEqual({ USD: 320, TWD: 630 });

    // Requesting page 2 must yield the same aggregates (invariant).
    const page2 = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, page: 2, limit: 2,
    });
    expect(page2.aggregates.totalExpectedCashAmount).toEqual({ USD: 350, TWD: 700 });
    expect(page2.aggregates.totalReceivedCashAmount).toEqual({ USD: 320, TWD: 630 });
  });

  it("UM-17: openCount counts only reconciliationStatus==='open' across the full filtered set", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100, reconciliationStatus: "open" });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 100, received: 100, reconciliationStatus: "open" });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17", expected: 100, received: 100, reconciliationStatus: "matched" });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-18", expected: 100, received: 100, reconciliationStatus: "matched" });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-19", expected: 100, received: 100, reconciliationStatus: "explained" });

    const result = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, page: 1, limit: 1,
    });
    expect(result.ledgerEntries).toHaveLength(1);
    expect(result.total).toBe(5);
    expect(result.aggregates.openCount).toBe(2);
  });

  it("UM-18: aggregates.byMonth shape — keyed by YYYY-MM then currency", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-10", expected: 100, received: 90 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-20", expected: 200, received: 180 });
    await seedFullEntry({ ticker: "2330", currency: "TWD", paymentDate: "2024-03-25", expected: 300, received: 270 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-04-10", expected: 400, received: 360 });

    const result = await app.persistence.listDividendLedgerEntries(USER_ID, defaultOpts);
    expect(result.aggregates.byMonth).toEqual({
      "2024-03": {
        USD: { expected: 300, received: 270 },
        TWD: { expected: 300, received: 270 },
      },
      "2024-04": {
        USD: { expected: 400, received: 360 },
      },
    });
  });

  it("UM-19: aggregates.byTicker shape — keyed by ticker then currency", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-10", expected: 100, received: 90 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-20", expected: 200, received: 180 });
    await seedFullEntry({ ticker: "GOOG", currency: "USD", paymentDate: "2024-03-25", expected: 400, received: 360 });

    const result = await app.persistence.listDividendLedgerEntries(USER_ID, defaultOpts);
    expect(result.aggregates.byTicker).toEqual({
      AAPL: { USD: { expected: 300, received: 270 } },
      GOOG: { USD: { expected: 400, received: 360 } },
    });
  });

  it("UM-20: ticker filter → aggregates recomputed over the filtered subset only", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-10", expected: 100, received: 90 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-20", expected: 200, received: 180 });
    await seedFullEntry({ ticker: "GOOG", currency: "USD", paymentDate: "2024-03-25", expected: 999, received: 999 });

    const result = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, ticker: "AAPL",
    });
    expect(result.total).toBe(2);
    expect(result.aggregates.totalExpectedCashAmount).toEqual({ USD: 300 });
    expect(result.aggregates.byTicker).toEqual({
      AAPL: { USD: { expected: 300, received: 270 } },
    });
    // GOOG must be fully absent from every aggregate structure.
    expect(result.aggregates.byTicker.GOOG).toBeUndefined();
  });

  it("UM-21: reconciliationStatus filter → openCount equals total; aggregates only count filtered rows", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100, reconciliationStatus: "open" });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 100, received: 100, reconciliationStatus: "open" });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17", expected: 999, received: 999, reconciliationStatus: "matched" });

    const result = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, reconciliationStatus: "open",
    });
    expect(result.total).toBe(2);
    expect(result.aggregates.openCount).toBe(2);
    expect(result.aggregates.totalExpectedCashAmount).toEqual({ USD: 200 });
  });

  it("UM-22: total equals full filtered count, not page length", async () => {
    for (let i = 0; i < 7; i++) {
      await seedFullEntry({
        ticker: "AAPL",
        currency: "USD",
        paymentDate: `2024-03-${String(i + 1).padStart(2, "0")}`,
        expected: 100,
        received: 100,
      });
    }

    const result = await app.persistence.listDividendLedgerEntries(USER_ID, {
      ...defaultOpts, page: 1, limit: 3,
    });
    expect(result.ledgerEntries).toHaveLength(3);
    expect(result.total).toBe(7);
  });
});

// ── 1.5 listDividendLedgerYears ──────────────────────────────────────────────

describe("MemoryPersistence.listDividendLedgerYears", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("UM-23: returns distinct years in descending order", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2023-06-01", expected: 100, received: 100 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-20", expected: 100, received: 100 });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2025-01-15", expected: 100, received: 100 });

    const { years } = await app.persistence.listDividendLedgerYears(USER_ID);
    expect(years).toEqual([2025, 2024, 2023]);
  });

  it("UM-24: excludes superseded entries", async () => {
    const evt = await seedDividendEvent({ ticker: "AAPL", paymentDate: "2022-06-01", exDividendDate: "2022-05-01" });
    await seedLedgerEntry({ dividendEventId: evt.id, supersededAt: "2022-07-01T00:00:00.000Z" });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });

    const { years } = await app.persistence.listDividendLedgerYears(USER_ID);
    expect(years).toEqual([2024]);
  });

  it("UM-25: excludes reversed entries", async () => {
    const originalEvt = await seedDividendEvent({ ticker: "AAPL", paymentDate: "2022-06-01", exDividendDate: "2022-05-01" });
    const original = await seedLedgerEntry({ dividendEventId: originalEvt.id });
    // Reversal: a ledger entry whose reversalOfDividendLedgerEntryId points at original.
    // Both original AND reversal should be excluded from years.
    await seedLedgerEntry({ dividendEventId: originalEvt.id, reversalOfDividendLedgerEntryId: original.id });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });

    const { years } = await app.persistence.listDividendLedgerYears(USER_ID);
    expect(years).toEqual([2024]);
  });

  it("UM-26: excludes entries with null paymentDate", async () => {
    const nullEvt = await seedDividendEvent({ ticker: "AAPL", paymentDate: null, exDividendDate: "2022-05-01" });
    await seedLedgerEntry({ dividendEventId: nullEvt.id, postingStatus: "expected" });
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });

    const { years } = await app.persistence.listDividendLedgerYears(USER_ID);
    expect(years).toEqual([2024]);
  });

  it("UM-27: empty store → returns years: []", async () => {
    const { years } = await app.persistence.listDividendLedgerYears(USER_ID);
    expect(years).toEqual([]);
  });
});

// ── Route-level integration: memory backend + app.inject ─────────────────────

describe("GET /portfolio/dividends/ledger — memory-backed route shape", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("route response includes ledgerEntries, total, and aggregates", async () => {
    await seedFullEntry({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 90 });
    await seedFullEntry({ ticker: "GOOG", currency: "USD", paymentDate: "2024-04-15", expected: 200, received: 180 });

    const res = await app.inject({ method: "GET", url: "/portfolio/dividends/ledger" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty("ledgerEntries");
    expect(body).toHaveProperty("total", 2);
    expect(body).toHaveProperty("aggregates");
    expect(body.aggregates).toMatchObject({
      openCount: expect.any(Number),
      totalExpectedCashAmount: { USD: 300 },
      totalReceivedCashAmount: { USD: 270 },
      byMonth: expect.any(Object),
      byTicker: expect.any(Object),
    });
    // Entries are enriched with ticker/eventType by buildDividendLedgerEntryDetails.
    expect(body.ledgerEntries[0]).toHaveProperty("ticker");
    expect(body.ledgerEntries[0]).toHaveProperty("eventType");
  });

  it("IG-38 analog: user-selected sort NOT overwritten by buildDividendLedgerEntryDetails re-sort", async () => {
    // Seed so that ticker-asc order differs from paymentDate-desc order.
    // paymentDate-desc would give: 2024-05-15 > 2024-04-15 > 2024-03-15
    // ticker-asc should give: AAA > BBB > CCC regardless of payment dates.
    await seedFullEntry({ ticker: "CCC", currency: "USD", paymentDate: "2024-05-15", expected: 100, received: 100 });
    await seedFullEntry({ ticker: "AAA", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });
    await seedFullEntry({ ticker: "BBB", currency: "USD", paymentDate: "2024-04-15", expected: 100, received: 100 });

    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?sortBy=ticker&sortOrder=asc",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const tickers = body.ledgerEntries.map((e: { ticker: string }) => e.ticker);
    expect(tickers).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("schema: sortBy=DROP_TABLE → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?sortBy=%27%3B%20DROP%20TABLE%20users%3B%20--",
    });
    expect(res.statusCode).toBe(400);
  });

  it("schema: page=0 → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?page=0",
    });
    expect(res.statusCode).toBe(400);
  });

  it("schema: limit=501 → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?limit=501",
    });
    expect(res.statusCode).toBe(400);
  });

  it("schema: limit=500 → 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?limit=500",
    });
    expect(res.statusCode).toBe(200);
  });

  it("schema: sortOrder=random → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?sortOrder=random",
    });
    expect(res.statusCode).toBe(400);
  });

  it("schema: page=-1 → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?page=-1",
    });
    expect(res.statusCode).toBe(400);
  });
});
