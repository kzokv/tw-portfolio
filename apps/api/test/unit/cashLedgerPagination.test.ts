import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { CashLedgerEntry } from "../../src/types/store.js";
import type { CashLedgerListOptions } from "../../src/persistence/types.js";

let app: AppInstance;
const USER_ID = "user-1";

function makeCashEntry(overrides: Partial<CashLedgerEntry> = {}): CashLedgerEntry {
  return {
    id: randomUUID(),
    userId: USER_ID,
    accountId: "acc-1",
    entryDate: "2025-01-15",
    entryType: "TRADE_SETTLEMENT_OUT",
    amount: -10000,
    currency: "TWD",
    source: "trade_settlement",
    ...overrides,
  };
}

async function seedCashEntries(...entries: CashLedgerEntry[]) {
  const store = await app.persistence.loadStore(USER_ID);
  store.accounting.facts.cashLedgerEntries.push(...entries);
}

const defaultOpts: CashLedgerListOptions = {
  page: 1,
  limit: 50,
  sortBy: "entryDate",
  sortOrder: "desc",
};

describe("MemoryPersistence.listCashLedgerEntries — filter/sort/page/summary", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── 1. Empty state ──────────────────────────────────────────────────────────

  it("UCL-01: empty store → returns empty entries, total 0, empty summary", async () => {
    const result = await app.persistence.listCashLedgerEntries(USER_ID, defaultOpts);
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.summary).toEqual([]);
  });

  // ── 2. Basic return ─────────────────────────────────────────────────────────

  it("UCL-02: returns all entries unfiltered with correct total", async () => {
    await seedCashEntries(
      makeCashEntry({ entryDate: "2025-01-10", amount: -5000 }),
      makeCashEntry({ entryDate: "2025-01-12", amount: 8000, entryType: "TRADE_SETTLEMENT_IN" }),
      makeCashEntry({ entryDate: "2025-01-14", amount: 1200, entryType: "DIVIDEND_RECEIPT" }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, defaultOpts);
    expect(result.entries).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  // ── 3. Date range filter ────────────────────────────────────────────────────

  it("UCL-03: fromEntryDate/toEntryDate filters by date range", async () => {
    await seedCashEntries(
      makeCashEntry({ entryDate: "2025-01-10", amount: -1000 }),
      makeCashEntry({ entryDate: "2025-01-15", amount: -2000 }),
      makeCashEntry({ entryDate: "2025-01-20", amount: -3000 }),
      makeCashEntry({ entryDate: "2025-01-25", amount: -4000 }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      fromEntryDate: "2025-01-15",
      toEntryDate: "2025-01-20",
    });

    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(2);
    const dates = result.entries.map((e) => e.entryDate);
    expect(dates).toContain("2025-01-15");
    expect(dates).toContain("2025-01-20");
  });

  // ── 4. Account filter ───────────────────────────────────────────────────────

  it("UCL-04: accountId filter returns only matching account entries", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", amount: -1000 }),
      makeCashEntry({ accountId: "acc-1", amount: -2000 }),
      makeCashEntry({ accountId: "acc-2", amount: -3000 }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      accountId: "acc-1",
    });

    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.entries.every((e) => e.accountId === "acc-1")).toBe(true);
  });

  // ── 5. Entry type filter ────────────────────────────────────────────────────

  it("UCL-05: entryType filter returns only matching types", async () => {
    await seedCashEntries(
      makeCashEntry({ entryType: "TRADE_SETTLEMENT_IN", amount: 5000 }),
      makeCashEntry({ entryType: "TRADE_SETTLEMENT_OUT", amount: -3000 }),
      makeCashEntry({ entryType: "DIVIDEND_RECEIPT", amount: 1200 }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      entryType: ["TRADE_SETTLEMENT_IN", "DIVIDEND_RECEIPT"],
    });

    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(2);
    const types = result.entries.map((e) => e.entryType);
    expect(types).toContain("TRADE_SETTLEMENT_IN");
    expect(types).toContain("DIVIDEND_RECEIPT");
  });

  // ── 6. Pagination ───────────────────────────────────────────────────────────

  it("UCL-06: page/limit returns correct slice with correct total", async () => {
    await seedCashEntries(
      makeCashEntry({ entryDate: "2025-01-01", amount: -1000 }),
      makeCashEntry({ entryDate: "2025-01-02", amount: -2000 }),
      makeCashEntry({ entryDate: "2025-01-03", amount: -3000 }),
      makeCashEntry({ entryDate: "2025-01-04", amount: -4000 }),
      makeCashEntry({ entryDate: "2025-01-05", amount: -5000 }),
    );

    const page1 = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      page: 1,
      limit: 2,
    });
    expect(page1.entries).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      page: 2,
      limit: 2,
    });
    expect(page2.entries).toHaveLength(2);
    expect(page2.total).toBe(5);

    const page3 = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      page: 3,
      limit: 2,
    });
    expect(page3.entries).toHaveLength(1);
    expect(page3.total).toBe(5);
  });

  // ── 7. Sort by entryDate DESC (default) ─────────────────────────────────────

  it("UCL-07: sortBy entryDate DESC returns entries in descending date order", async () => {
    await seedCashEntries(
      makeCashEntry({ entryDate: "2025-01-10", amount: -1000 }),
      makeCashEntry({ entryDate: "2025-01-20", amount: -2000 }),
      makeCashEntry({ entryDate: "2025-01-15", amount: -3000 }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, defaultOpts);
    const dates = result.entries.map((e) => e.entryDate);
    expect(dates).toEqual(["2025-01-20", "2025-01-15", "2025-01-10"]);
  });

  // ── 8. Sort by amount ASC ───────────────────────────────────────────────────

  it("UCL-08: sortBy amount ASC returns entries in ascending amount order", async () => {
    await seedCashEntries(
      makeCashEntry({ amount: 5000, entryDate: "2025-01-10" }),
      makeCashEntry({ amount: -3000, entryDate: "2025-01-11" }),
      makeCashEntry({ amount: 1200, entryDate: "2025-01-12" }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "amount",
      sortOrder: "asc",
    });

    const amounts = result.entries.map((e) => e.amount);
    expect(amounts).toEqual([-3000, 1200, 5000]);
  });

  // ── 9. Summary computed over full filtered set, not page slice ──────────────

  it("UCL-09: summary is computed over full filtered set, not page slice", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", currency: "TWD", amount: -10000, entryDate: "2025-01-01" }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", amount: 5000, entryDate: "2025-01-02" }),
      makeCashEntry({ accountId: "acc-1", currency: "USD", amount: -250, entryDate: "2025-01-03" }),
      makeCashEntry({ accountId: "acc-2", currency: "TWD", amount: -30000, entryDate: "2025-01-04" }),
    );

    // Request page 1 with limit 2 — only 2 entries returned, but summary covers all 4
    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      page: 1,
      limit: 2,
    });

    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.summary).toHaveLength(3); // acc-1/TWD, acc-1/USD, acc-2/TWD

    const findSummary = (accountId: string, currency: string) =>
      result.summary.find((s) => s.accountId === accountId && s.currency === currency);

    expect(findSummary("acc-1", "TWD")?.amount).toBe(-5000);
    expect(findSummary("acc-1", "USD")?.amount).toBe(-250);
    expect(findSummary("acc-2", "TWD")?.amount).toBe(-30000);
  });

  // ── 10. Tiebreaker sort: bookedAt DESC NULLS LAST, id ASC ──────────────────

  it("UCL-10: tiebreaker sorts by bookedAt DESC then id ASC for same primary sort value", async () => {
    const id1 = "aaaa-0001";
    const id2 = "aaaa-0002";
    const id3 = "aaaa-0003";

    await seedCashEntries(
      makeCashEntry({ id: id1, entryDate: "2025-01-15", bookedAt: "2025-01-15T10:00:00Z", amount: -100 }),
      makeCashEntry({ id: id2, entryDate: "2025-01-15", bookedAt: "2025-01-15T12:00:00Z", amount: -200 }),
      makeCashEntry({ id: id3, entryDate: "2025-01-15", bookedAt: undefined, amount: -300 }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      sortBy: "entryDate",
      sortOrder: "desc",
    });

    // Same entryDate → bookedAt DESC NULLS LAST → id2 (12:00), id1 (10:00), id3 (null)
    const ids = result.entries.map((e) => e.id);
    expect(ids).toEqual([id2, id1, id3]);
  });

  // ── 11. Combined filters ────────────────────────────────────────────────────

  it("UCL-11: combined filters (date + account + entryType) narrow results correctly", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", entryType: "TRADE_SETTLEMENT_OUT", entryDate: "2025-01-10", amount: -1000 }),
      makeCashEntry({ accountId: "acc-1", entryType: "DIVIDEND_RECEIPT", entryDate: "2025-01-15", amount: 500 }),
      makeCashEntry({ accountId: "acc-2", entryType: "DIVIDEND_RECEIPT", entryDate: "2025-01-15", amount: 700 }),
      makeCashEntry({ accountId: "acc-1", entryType: "DIVIDEND_RECEIPT", entryDate: "2025-01-25", amount: 900 }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      accountId: "acc-1",
      entryType: ["DIVIDEND_RECEIPT"],
      fromEntryDate: "2025-01-10",
      toEntryDate: "2025-01-20",
    });

    expect(result.entries).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.entries[0].amount).toBe(500);
  });

  // ── 12. Sort by entryType ASC/DESC ─────────────────────────────────────────

  it("UCL-12: sortBy entryType ASC/DESC sorts lexicographically", async () => {
    const trade = makeCashEntry({ entryType: "TRADE_SETTLEMENT_OUT", entryDate: "2025-01-10" });
    const div = makeCashEntry({ entryType: "DIVIDEND_RECEIPT", entryDate: "2025-01-11" });
    const manual = makeCashEntry({ entryType: "MANUAL_ADJUSTMENT", entryDate: "2025-01-12" });
    await seedCashEntries(trade, div, manual);

    const asc = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, sortBy: "entryType", sortOrder: "asc",
    });
    // DIVIDEND_RECEIPT < MANUAL_ADJUSTMENT < TRADE_SETTLEMENT_OUT
    expect(asc.entries.map((e) => e.id)).toEqual([div.id, manual.id, trade.id]);

    const desc = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, sortBy: "entryType", sortOrder: "desc",
    });
    expect(desc.entries.map((e) => e.id)).toEqual([trade.id, manual.id, div.id]);
  });

  // ── 13. Sort by currency ASC/DESC ──────────────────────────────────────────

  it("UCL-13: sortBy currency ASC/DESC sorts lexicographically", async () => {
    const twd = makeCashEntry({ currency: "TWD", entryDate: "2025-01-10" });
    const usd = makeCashEntry({ currency: "USD", entryDate: "2025-01-11" });
    const jpy = makeCashEntry({ currency: "JPY", entryDate: "2025-01-12" });
    await seedCashEntries(usd, twd, jpy);

    const asc = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, sortBy: "currency", sortOrder: "asc",
    });
    expect(asc.entries.map((e) => e.id)).toEqual([jpy.id, twd.id, usd.id]);

    const desc = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, sortBy: "currency", sortOrder: "desc",
    });
    expect(desc.entries.map((e) => e.id)).toEqual([usd.id, twd.id, jpy.id]);
  });

  // ── 14. Sort by accountId ASC/DESC ─────────────────────────────────────────

  it("UCL-14: sortBy accountId ASC/DESC sorts lexicographically", async () => {
    const a1 = makeCashEntry({ accountId: "acc-1", entryDate: "2025-01-10" });
    const a2 = makeCashEntry({ accountId: "acc-2", entryDate: "2025-01-11" });
    const a3 = makeCashEntry({ accountId: "acc-3", entryDate: "2025-01-12" });
    await seedCashEntries(a2, a3, a1);

    const asc = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, sortBy: "accountId", sortOrder: "asc",
    });
    expect(asc.entries.map((e) => e.id)).toEqual([a1.id, a2.id, a3.id]);

    const desc = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, sortBy: "accountId", sortOrder: "desc",
    });
    expect(desc.entries.map((e) => e.id)).toEqual([a3.id, a2.id, a1.id]);
  });

  // ── 15. Sort by entryDate ASC ──────────────────────────────────────────────

  it("UCL-15: sortBy entryDate ASC returns entries in ascending date order", async () => {
    await seedCashEntries(
      makeCashEntry({ entryDate: "2025-01-20", amount: -2000 }),
      makeCashEntry({ entryDate: "2025-01-10", amount: -1000 }),
      makeCashEntry({ entryDate: "2025-01-15", amount: -3000 }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, sortBy: "entryDate", sortOrder: "asc",
    });
    const dates = result.entries.map((e) => e.entryDate);
    expect(dates).toEqual(["2025-01-10", "2025-01-15", "2025-01-20"]);
  });

  // ── 16. Sort by amount DESC ────────────────────────────────────────────────

  it("UCL-16: sortBy amount DESC returns entries in descending amount order", async () => {
    const low = makeCashEntry({ amount: -50000, entryDate: "2025-01-10" });
    const mid = makeCashEntry({ amount: -2000, entryDate: "2025-01-11" });
    const high = makeCashEntry({ amount: 10000, entryDate: "2025-01-12", entryType: "TRADE_SETTLEMENT_IN" });
    await seedCashEntries(mid, low, high);

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, sortBy: "amount", sortOrder: "desc",
    });
    expect(result.entries.map((e) => e.id)).toEqual([high.id, mid.id, low.id]);
  });

  // ── 17. bookedAt=null sorts last in tiebreaker ────────────────────────────

  it("UCL-17: bookedAt null sorts last in tiebreaker regardless of id", async () => {
    const idA = "00000000-0000-4000-8000-aaaaaaaaaaaa";
    const idB = "00000000-0000-4000-8000-bbbbbbbbbbbb";
    const idNull = "00000000-0000-4000-8000-000000000001";

    await seedCashEntries(
      makeCashEntry({ id: idNull, entryDate: "2025-01-15", amount: -1000 }), // bookedAt undefined — id is lowest
      makeCashEntry({ id: idA, entryDate: "2025-01-15", amount: -1000, bookedAt: "2025-01-15T12:00:00Z" }),
      makeCashEntry({ id: idB, entryDate: "2025-01-15", amount: -1000, bookedAt: "2025-01-15T10:00:00Z" }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, sortBy: "amount", sortOrder: "asc",
    });
    // bookedAt DESC: idA (12:00) > idB (10:00); null sorts last despite lowest id
    expect(result.entries.map((e) => e.id)).toEqual([idA, idB, idNull]);
  });

  // ── 18. Page past end → empty ──────────────────────────────────────────────

  it("UCL-18: page past end → empty entries but total reflects full count", async () => {
    await seedCashEntries(
      makeCashEntry({ entryDate: "2025-01-10", amount: -1000 }),
      makeCashEntry({ entryDate: "2025-01-11", amount: -2000 }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, page: 99, limit: 50,
    });
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(2);
  });

  // ── 19. Page 1 and page 2 have identical summary (invariant) ──────────────

  it("UCL-19: page 1 and page 2 return identical summary totals", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", currency: "TWD", amount: -10000, entryDate: "2025-01-01" }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", amount: 5000, entryDate: "2025-01-02", entryType: "TRADE_SETTLEMENT_IN" }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", amount: -3000, entryDate: "2025-01-03" }),
      makeCashEntry({ accountId: "acc-2", currency: "USD", amount: -500, entryDate: "2025-01-04" }),
      makeCashEntry({ accountId: "acc-2", currency: "USD", amount: 200, entryDate: "2025-01-05", entryType: "TRADE_SETTLEMENT_IN" }),
    );

    const page1 = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, page: 1, limit: 2,
    });
    const page2 = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, page: 2, limit: 2,
    });

    const sortSummary = (s: typeof page1.summary) =>
      [...s].sort((a, b) => `${a.accountId}:${a.currency}`.localeCompare(`${b.accountId}:${b.currency}`));

    expect(sortSummary(page1.summary)).toEqual(sortSummary(page2.summary));
  });

  // ── 20. No matches filter → empty ─────────────────────────────────────────

  it("UCL-20: no matching filter → empty entries, total 0, summary empty", async () => {
    await seedCashEntries(
      makeCashEntry({ entryDate: "2025-01-10", amount: -1000 }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      accountId: "acc-nonexistent",
    });

    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.summary).toEqual([]);
  });

  // ── 21. Filter → summary only over filtered subset ────────────────────────

  it("UCL-21: filter applied → summary computed over filtered subset only", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", entryType: "TRADE_SETTLEMENT_OUT", amount: -10000, entryDate: "2025-01-10" }),
      makeCashEntry({ accountId: "acc-1", entryType: "DIVIDEND_RECEIPT", amount: 1200, entryDate: "2025-01-14" }),
      makeCashEntry({ accountId: "acc-2", entryType: "TRADE_SETTLEMENT_OUT", amount: -50000, entryDate: "2025-01-15" }),
    );

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts,
      accountId: "acc-1",
    });

    expect(result.total).toBe(2);
    expect(result.summary).toHaveLength(1);
    expect(result.summary[0]!.accountId).toBe("acc-1");
    expect(result.summary[0]!.amount).toBe(-8800);
  });

  // ── 22. total = full filtered count, not page length ──────────────────────

  it("UCL-22: total equals full filtered count, not page length", async () => {
    for (let i = 0; i < 7; i++) {
      await seedCashEntries(
        makeCashEntry({
          entryDate: `2025-01-${String(i + 1).padStart(2, "0")}`,
          amount: -(i + 1) * 1000,
        }),
      );
    }

    const result = await app.persistence.listCashLedgerEntries(USER_ID, {
      ...defaultOpts, page: 1, limit: 3,
    });
    expect(result.entries).toHaveLength(3);
    expect(result.total).toBe(7);
  });
});
