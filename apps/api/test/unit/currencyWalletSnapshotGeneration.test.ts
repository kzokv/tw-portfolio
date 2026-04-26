// KZO-165 — Senior QA Phase 1 (Tier 2 parallel).
//
// Unit-level coverage for the new currency-wallet stub aggregator
// (`apps/api/src/services/currencyWalletSnapshotGeneration.ts`). The
// aggregator walks `cash_ledger_entries` grouped by (accountId, currency),
// computes a running balance, and emits one `CurrencyWalletSnapshot` per
// `(accountId, currency, date-with-activity)` with FX columns stubbed.
//
// Per the locked scope-todo (D5/D9):
//   - `wacFxToUsd === null`
//   - `realizedFxPnlLifetime === 0`
//   - `providerSource === null`
//
// Per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` no daily-bars
// are seeded by this file (cash-ledger-only). Ticker `2002` is the locked
// project-wide pick for KZO-165 — present on the trades-related test files
// but unused here because cash ledger entries aren't ticker-scoped.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import type { CashLedgerEntry } from "../../src/types/store.js";
import type { CurrencyWalletSnapshot } from "../../src/persistence/types.js";
import { generateCurrencyWalletSnapshots } from "../../src/services/currencyWalletSnapshotGeneration.js";

let app: AppInstance;
let persistence: MemoryPersistence;

function makeCashEntry(overrides: Partial<CashLedgerEntry> = {}): CashLedgerEntry {
  return {
    id: randomUUID(),
    userId: "user-1",
    accountId: "acc-1",
    entryDate: "2025-01-15",
    entryType: "MANUAL_ADJUSTMENT",
    amount: 1000,
    currency: "TWD",
    source: "test_seed",
    ...overrides,
  };
}

async function seedCashEntries(...entries: CashLedgerEntry[]): Promise<void> {
  const store = await persistence.loadStore("user-1");
  store.accounting.facts.cashLedgerEntries.push(...entries);
}

async function getAllWalletSnapshotsForUser(
  userId: string,
): Promise<CurrencyWalletSnapshot[]> {
  return persistence._getCurrencyWalletSnapshotsForUser(userId);
}

beforeEach(async () => {
  app = await buildApp({ persistenceBackend: "memory" });
  persistence = app.persistence as MemoryPersistence;
});

afterEach(async () => {
  await app.close();
});

describe("generateCurrencyWalletSnapshots — running balance per (accountId, currency)", () => {
  it("two TWD entries on two distinct dates → two wallet rows with running balance", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-02", amount: 5000 }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-05", amount: -1500 }),
    );

    const result = await generateCurrencyWalletSnapshots("user-1", persistence);
    expect(result.totalRows).toBe(2);

    const rows = await getAllWalletSnapshotsForUser("user-1");
    expect(rows).toHaveLength(2);

    // Day 1: +5000 → balance 5000
    expect(rows[0].accountId).toBe("acc-1");
    expect(rows[0].currency).toBe("TWD");
    expect(rows[0].date).toBe("2025-01-02");
    expect(rows[0].balanceNative).toBe(5000);

    // Day 2: -1500 → cumulative balance 3500
    expect(rows[1].accountId).toBe("acc-1");
    expect(rows[1].currency).toBe("TWD");
    expect(rows[1].date).toBe("2025-01-05");
    expect(rows[1].balanceNative).toBe(3500);
  });

  it("two accounts, same currency: distinct wallet rows per account (independent balances)", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-02", amount: 1000 }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-03", amount: 500 }),
      makeCashEntry({ accountId: "acc-2", currency: "TWD", entryDate: "2025-01-02", amount: 7000 }),
    );

    const result = await generateCurrencyWalletSnapshots("user-1", persistence);
    expect(result.totalRows).toBe(3);

    const rows = await getAllWalletSnapshotsForUser("user-1");
    expect(rows).toHaveLength(3);

    // acc-1 TWD: two rows, balances 1000 then 1500
    const acc1Rows = rows.filter((r) => r.accountId === "acc-1");
    expect(acc1Rows.map((r) => r.date)).toEqual(["2025-01-02", "2025-01-03"]);
    expect(acc1Rows.map((r) => r.balanceNative)).toEqual([1000, 1500]);

    // acc-2 TWD: one row, balance 7000 (independent of acc-1)
    const acc2Rows = rows.filter((r) => r.accountId === "acc-2");
    expect(acc2Rows).toHaveLength(1);
    expect(acc2Rows[0].balanceNative).toBe(7000);
  });

  it("same account, multiple currencies: distinct wallet rows per currency", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-02", amount: 30000 }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-03", amount: -10000 }),
      makeCashEntry({ accountId: "acc-1", currency: "USD", entryDate: "2025-01-02", amount: 1000 }),
      makeCashEntry({ accountId: "acc-1", currency: "USD", entryDate: "2025-01-04", amount: 250 }),
    );

    const result = await generateCurrencyWalletSnapshots("user-1", persistence);
    expect(result.totalRows).toBe(4);

    const rows = await getAllWalletSnapshotsForUser("user-1");
    const twdRows = rows.filter((r) => r.currency === "TWD");
    const usdRows = rows.filter((r) => r.currency === "USD");

    // TWD bucket: 30000 → 20000
    expect(twdRows.map((r) => r.balanceNative)).toEqual([30000, 20000]);
    expect(twdRows.map((r) => r.date)).toEqual(["2025-01-02", "2025-01-03"]);

    // USD bucket: 1000 → 1250 (independent running balance per currency)
    expect(usdRows.map((r) => r.balanceNative)).toEqual([1000, 1250]);
    expect(usdRows.map((r) => r.date)).toEqual(["2025-01-02", "2025-01-04"]);
  });

  it("FX columns are stubbed null/0/null on every emitted row (D5 + D9)", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-02", amount: 5000 }),
      makeCashEntry({ accountId: "acc-1", currency: "USD", entryDate: "2025-01-02", amount: 100 }),
      makeCashEntry({ accountId: "acc-2", currency: "TWD", entryDate: "2025-01-03", amount: 200 }),
    );

    await generateCurrencyWalletSnapshots("user-1", persistence);
    const rows = await getAllWalletSnapshotsForUser("user-1");

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.wacFxToUsd).toBeNull();
      expect(row.realizedFxPnlLifetime).toBe(0);
      expect(row.providerSource).toBeNull();
    }
  });

  it("multiple entries on the same (accountId, currency, date) collapse into a single row", async () => {
    // Two entries on the same date for the same (accountId, currency) should
    // sum into a single end-of-day balance, not duplicate the row. PK
    // (account_id, currency, date) enforces this in Postgres; the aggregator
    // must collapse client-side too.
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-02", amount: 1000 }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-02", amount: 2000 }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-03", amount: -500 }),
    );

    const result = await generateCurrencyWalletSnapshots("user-1", persistence);
    expect(result.totalRows).toBe(2);

    const rows = await getAllWalletSnapshotsForUser("user-1");
    expect(rows).toHaveLength(2);
    // Day 1 collapsed: 1000 + 2000 = 3000
    expect(rows[0].date).toBe("2025-01-02");
    expect(rows[0].balanceNative).toBe(3000);
    // Day 2: cumulative 3000 - 500 = 2500
    expect(rows[1].date).toBe("2025-01-03");
    expect(rows[1].balanceNative).toBe(2500);
  });

  it("idempotent: re-run produces the same row count (delete-then-upsert semantics)", async () => {
    await seedCashEntries(
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-02", amount: 1000 }),
      makeCashEntry({ accountId: "acc-1", currency: "TWD", entryDate: "2025-01-03", amount: 500 }),
    );

    const first = await generateCurrencyWalletSnapshots("user-1", persistence);
    const second = await generateCurrencyWalletSnapshots("user-1", persistence);

    expect(first.totalRows).toBe(second.totalRows);
    const rows = await getAllWalletSnapshotsForUser("user-1");
    expect(rows).toHaveLength(2); // not 4 — deleteAll wipes prior run
  });

  it("no cash entries → zero wallet rows (graceful empty)", async () => {
    const result = await generateCurrencyWalletSnapshots("user-1", persistence);
    expect(result.totalRows).toBe(0);

    const rows = await getAllWalletSnapshotsForUser("user-1");
    expect(rows).toHaveLength(0);
  });
});
