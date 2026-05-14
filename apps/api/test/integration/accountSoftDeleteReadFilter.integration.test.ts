/**
 * ui-enhancement — Integration smoke test for the "every account-scoped
 * read path filters deleted_at IS NULL" invariant.
 *
 * Per architect-design.md §6, the Backend Implementer's commit message
 * carries the canonical audit ledger of all touched read paths. This file
 * smokes the most critical 2-3 to catch obvious regressions.
 *
 * Cases (smoke):
 *  - GET /accounts (`persistence.loadStore`-derived listing) excludes
 *    soft-deleted accounts.
 *  - `getAccountIncludingDeleted` returns the soft-deleted row (used by the
 *    purge route's typed-name check).
 *
 * Note: exhaustive coverage of every read path emerges naturally from
 * Suite-6/7 (E2E) — a soft-deleted account that's invisible in all surfaces
 * end-to-end is the canonical signal.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");
const { createDefaultFeeProfile } = await import("../../src/services/store.js");
const { generateHoldingSnapshots } = await import("../../src/services/snapshotGeneration.js");
const { generateCurrencyWalletSnapshots } = await import("../../src/services/currencyWalletSnapshotGeneration.js");

/**
 * Seed a fresh account + matching FeeProfile (composite FK per migration 042).
 */
function pushAccountWithProfile(
  store: { accounts: Array<Record<string, unknown>>; feeProfiles: Array<Record<string, unknown>> },
  account: {
    id: string;
    userId: string;
    name: string;
    defaultCurrency: "TWD" | "USD" | "AUD";
    accountType: "broker" | "bank" | "wallet";
  },
): void {
  const feeProfileId = `fp-${account.id}`;
  store.feeProfiles.push(
    createDefaultFeeProfile(account.id, account.defaultCurrency, feeProfileId) as unknown as Record<string, unknown>,
  );
  store.accounts.push({ ...account, feeProfileId });
}

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";
if (runPostgresIntegration && !managedCiStack) {
  throw new Error("RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host");
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("Account-scoped read filter (Postgres)", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;
  let ownerUserId: string;

  async function resetDatabase(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");
    } finally {
      client.release();
    }
  }
  async function applyNumberedMigrations(): Promise<void> {
    const manifest = await migrationManifestPromise;
    const client = await pool.connect();
    try {
      for (const file of manifest.numberedMigrations) {
        const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(sql);
      }
    } finally {
      client.release();
    }
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    const seeded = await persistence.resolveOrCreateUser(
      "google",
      "uie-read-filter-sub",
      { email: "uie-read-filter@example.com", name: "Filter Owner" },
    );
    ownerUserId = seeded.userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("loadStore returns only active accounts; soft-deleted ones absent", async () => {
    const before = await persistence!.loadStore(ownerUserId);
    pushAccountWithProfile(before as never, {
      id: "acc-filter-hide",
      userId: ownerUserId,
      name: "Hide Me Filter",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    await persistence!.saveStore(before);

    await persistence!.softDeleteAccount("acc-filter-hide", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    const after = await persistence!.loadStore(ownerUserId);
    expect(after.accounts.find((a) => a.id === "acc-filter-hide")).toBeUndefined();
  });

  it("getAccountIncludingDeleted returns the soft-deleted row (used by /purge typed-name check)", async () => {
    const store = await persistence!.loadStore(ownerUserId);
    pushAccountWithProfile(store as never, {
      id: "acc-filter-include",
      userId: ownerUserId,
      name: "Includes Even When Deleted",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    await persistence!.saveStore(store);

    await persistence!.softDeleteAccount("acc-filter-include", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    const found = await persistence!.getAccountIncludingDeleted("acc-filter-include", ownerUserId);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("Includes Even When Deleted");
  });

  it("listSoftDeletedAccounts emits only soft-deleted rows ordered by deleted_at DESC", async () => {
    const store = await persistence!.loadStore(ownerUserId);
    pushAccountWithProfile(store as never, {
      id: "acc-list-1", userId: ownerUserId, name: "L1", defaultCurrency: "TWD", accountType: "broker",
    });
    pushAccountWithProfile(store as never, {
      id: "acc-list-2", userId: ownerUserId, name: "L2", defaultCurrency: "TWD", accountType: "broker",
    });
    await persistence!.saveStore(store);

    await persistence!.softDeleteAccount("acc-list-1", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });
    // Small delay so deleted_at sorts deterministically.
    await new Promise((r) => setTimeout(r, 50));
    await persistence!.softDeleteAccount("acc-list-2", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    const result = await persistence!.listSoftDeletedAccounts(ownerUserId);
    expect(result.length).toBeGreaterThanOrEqual(2);
    const positions = result.map((r) => r.id);
    expect(positions.indexOf("acc-list-2")).toBeLessThan(positions.indexOf("acc-list-1"));
  });

  // ── ui-enhancement iter 3 (P1-2 Codex) ─────────────────────────────────
  //
  // Extended coverage for "every account-scoped read path filters
  // deleted_at IS NULL". Each case seeds account A with one piece of
  // data, soft-deletes A, then asserts the data does NOT surface in the
  // matching read path.

  /**
   * Helper — seed an account A and stamp a trade event + cash ledger entry +
   * lot owned by A. Mirrors the canonical in-memory shape from
   * `apps/api/test/integration/postgres-migrations.integration.test.ts:1360+`:
   *
   *  - account row + matching FeeProfile (composite FK per migration 042)
   *  - BookedTradeEvent with `feeSnapshot: <real FeeProfile>` (NOT null —
   *    saveStore writes the snapshot row + the FK on trade_events via this)
   *  - Lot with `openQuantity` / `totalCostAmount` / `costCurrency`
   *  - CashLedgerEntry with `entryType` (NOT `type`) + `userId` + `source`
   *
   * The architect's iter-3 directive explicitly mandated this shape after
   * QA helper drift caused 7 saveStore validator failures.
   */
  async function seedAccountWithData(
    accountId: string,
    name: string,
    ticker: string,
  ): Promise<void> {
    const store = await persistence!.loadStore(ownerUserId);
    pushAccountWithProfile(store as never, {
      id: accountId,
      userId: ownerUserId,
      name,
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    // The fresh FeeProfile we just pushed; saveStore will use this for the
    // trade_event.fee_policy_snapshot_id FK via the embedded `feeSnapshot`.
    const feeProfile = store.feeProfiles.find((p) => p.accountId === accountId);
    if (!feeProfile) {
      throw new Error(`Test helper invariant: expected feeProfile for ${accountId}`);
    }

    // Trade event — canonical BookedTradeEvent shape; embedded feeSnapshot
    // is the load-bearing field (saveStore writes the FK from it).
    const tradeId = `trade-${accountId}-${ticker}`;
    store.accounting.facts.tradeEvents.push({
      id: tradeId,
      userId: ownerUserId,
      accountId,
      ticker,
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-15",
      tradeTimestamp: "2026-01-15T01:00:00.000Z",
      bookingSequence: 1,
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      source: "test-helper",
      sourceReference: tradeId,
      bookedAt: "2026-01-15T01:00:00.000Z",
    });

    // Lot — Lot type fields per libs/domain/src/types.ts:91+.
    store.accounting.projections.lots.push({
      id: `lot-${accountId}-${ticker}`,
      accountId,
      ticker,
      openQuantity: 10,
      totalCostAmount: 1000,
      costCurrency: "TWD",
      openedAt: "2026-01-15",
      openedSequence: 1,
    });

    // CashLedgerEntry — uses `entryType` not `type`; includes `userId`+`source`.
    store.accounting.facts.cashLedgerEntries.push({
      id: `cash-${accountId}`,
      userId: ownerUserId,
      accountId,
      entryDate: "2026-01-15",
      entryType: "TRADE_SETTLEMENT_OUT",
      amount: -1000,
      currency: "TWD",
      relatedTradeEventId: tradeId,
      source: "test-helper",
      sourceReference: `cash-${accountId}`,
      bookedAt: "2026-01-15T01:00:01.000Z",
    });

    await persistence!.saveStore(store);
  }

  it("loadStore.tradeEvents excludes trades belonging to a soft-deleted account", async () => {
    await seedAccountWithData("acc-trade-hide", "Trade Hide", "0050");
    await persistence!.softDeleteAccount("acc-trade-hide", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    const after = await persistence!.loadStore(ownerUserId);
    expect(after.accounting.facts.tradeEvents.find((t) => t.accountId === "acc-trade-hide")).toBeUndefined();
  });

  it("loadStore.cashLedgerEntries excludes cash entries belonging to a soft-deleted account", async () => {
    await seedAccountWithData("acc-cash-hide", "Cash Hide", "0051");
    await persistence!.softDeleteAccount("acc-cash-hide", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    const after = await persistence!.loadStore(ownerUserId);
    expect(after.accounting.facts.cashLedgerEntries.find((e) => e.accountId === "acc-cash-hide")).toBeUndefined();
  });

  it("loadStore.lots excludes lots belonging to a soft-deleted account", async () => {
    await seedAccountWithData("acc-lots-hide", "Lots Hide", "0052");
    await persistence!.softDeleteAccount("acc-lots-hide", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    const after = await persistence!.loadStore(ownerUserId);
    expect(after.accounting.projections.lots.find((l) => l.accountId === "acc-lots-hide")).toBeUndefined();
  });

  it("listCashLedgerEntries excludes entries belonging to a soft-deleted account", async () => {
    await seedAccountWithData("acc-cle-hide", "Cash Ledger Hide", "0053");
    await persistence!.softDeleteAccount("acc-cle-hide", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    const result = await persistence!.listCashLedgerEntries(ownerUserId, {
      page: 1,
      limit: 100,
      sortBy: "entryDate",
      sortOrder: "desc",
    });
    expect(result.entries.find((e) => e.accountId === "acc-cle-hide")).toBeUndefined();
  });

  // ── Layer-boundary documentation ─────────────────────────────────────────
  //
  // The canonical "deleted_at IS NULL" filter point per Backend's P1-2
  // centralization lives at `loadStore` and the aggregate read paths that
  // derive from it (the 4 assertions above + `listCashLedgerEntries`).
  //
  // Lower-level persistence helpers — `getAccountAvailableBalance`,
  // `getTradeEventsForAccountTicker`, etc. — are intentionally NOT contracted
  // to filter at this layer. They serve:
  //   - Recompute / snapshot-generation paths that operate on already-
  //     filtered stores (consumers gate via loadStore).
  //   - Historical / reconciliation queries that need to see all underlying
  //     data regardless of an account's deleted_at state.
  //
  // The negative-regression test below adds the sibling-survives invariant
  // (per-account filtering, NOT global "delete-everything-when-any-deleted").

  it("active sibling account's data SURVIVES when another account is soft-deleted (negative regression guard)", async () => {
    // This is the load-bearing guard: the filter must be PER-ACCOUNT, not
    // "all data when any account is deleted." Seed two accounts; soft-delete
    // one; assert the other's data is still readable.
    await seedAccountWithData("acc-victim", "Victim", "0056");
    await seedAccountWithData("acc-survivor", "Survivor", "0057");
    await persistence!.softDeleteAccount("acc-victim", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    const after = await persistence!.loadStore(ownerUserId);
    expect(after.accounts.find((a) => a.id === "acc-survivor")).toBeDefined();
    expect(after.accounting.facts.tradeEvents.find((t) => t.accountId === "acc-survivor")).toBeDefined();
    expect(after.accounting.projections.lots.find((l) => l.accountId === "acc-survivor")).toBeDefined();
    expect(after.accounting.facts.cashLedgerEntries.find((e) => e.accountId === "acc-survivor")).toBeDefined();
    // And victim's data is gone.
    expect(after.accounts.find((a) => a.id === "acc-victim")).toBeUndefined();
    expect(after.accounting.facts.tradeEvents.find((t) => t.accountId === "acc-victim")).toBeUndefined();
    expect(after.accounting.projections.lots.find((l) => l.accountId === "acc-victim")).toBeUndefined();
    expect(after.accounting.facts.cashLedgerEntries.find((e) => e.accountId === "acc-victim")).toBeUndefined();
  });

  // ── ui-enhancement iter 4 (Codex HIGH-1 + HIGH-2 regression guards) ─────
  //
  // HIGH-1: `getSnapshotGenerationInputs` no-scope path + the aggregated
  // reporting-currency reader were feeding soft-deleted-account trades into
  // the daily snapshot writer. Backend patched them in iter 4 to filter via
  // `accounts.deleted_at IS NULL`. The guard below seeds an account with
  // trades, soft-deletes it, runs `generateHoldingSnapshots`, then verifies
  // that NO `daily_holding_snapshots` rows land for the soft-deleted account.
  //
  // HIGH-2: `getCashLedgerEntriesForWalletReplay` Postgres path was leaking
  // soft-deleted-account cash entries into wallet replay. Backend patched
  // it to filter at the same JOIN layer. Per
  // `replay-position-history-invariants.md` companion §C the wallet
  // generator inherits invariants 3+4 (typed errors propagate; zero-amount
  // entries already excluded by CHECK constraint). This guard asserts the
  // soft-delete filter as a third invariant for the wallet generator:
  // soft-deleted accounts must not produce `currency_wallet_snapshots` rows.

  it("HIGH-1 regression — generateHoldingSnapshots does NOT write daily_holding_snapshots for soft-deleted accounts", async () => {
    // Seed two accounts so the negative-regression-guard pattern carries:
    // soft-deleted A is filtered out, surviving B's snapshots still land.
    await seedAccountWithData("acc-snap-hidden", "Snapshot Hidden", "9151");
    await seedAccountWithData("acc-snap-active", "Snapshot Active", "9152");
    await persistence!.softDeleteAccount("acc-snap-hidden", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    // Seed a daily bar for the survivor so the snapshot writer has price
    // data to walk; the hidden account's ticker stays barless so the only
    // reason it might surface in the writer's output is the deleted_at leak.
    await pool.query(
      `INSERT INTO market_data.instruments (ticker, market_code, name, instrument_type, bars_backfill_status)
       VALUES ($1, 'TW', 'Synthetic 9152', 'STOCK', 'ready')
       ON CONFLICT (ticker, market_code) DO UPDATE
         SET bars_backfill_status = EXCLUDED.bars_backfill_status`,
      ["9152"],
    );
    await pool.query(
      `INSERT INTO market_data.daily_bars (ticker, market_code, bar_date, open, high, low, close, volume)
       VALUES ($1, 'TW', '2026-01-15', 100, 110, 95, 105, 100000)
       ON CONFLICT DO NOTHING`,
      ["9152"],
    );

    await generateHoldingSnapshots(ownerUserId, persistence!);

    const { rows: hiddenSnapshotRows } = await pool.query(
      "SELECT id FROM daily_holding_snapshots WHERE account_id = $1",
      ["acc-snap-hidden"],
    );
    expect(hiddenSnapshotRows.length).toBe(0);

    // Negative-regression sibling: active account's snapshots land OK.
    const { rows: activeSnapshotRows } = await pool.query(
      "SELECT id FROM daily_holding_snapshots WHERE account_id = $1",
      ["acc-snap-active"],
    );
    expect(activeSnapshotRows.length).toBeGreaterThanOrEqual(1);
  });

  it("HIGH-2 regression — generateCurrencyWalletSnapshots does NOT write currency_wallet_snapshots for soft-deleted accounts", async () => {
    await seedAccountWithData("acc-wallet-hidden", "Wallet Hidden", "9251");
    await seedAccountWithData("acc-wallet-active", "Wallet Active", "9252");
    await persistence!.softDeleteAccount("acc-wallet-hidden", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    await generateCurrencyWalletSnapshots(ownerUserId, persistence!);

    // currency_wallet_snapshots has no `id` column — use COUNT(*) instead.
    const { rows: hiddenWalletRows } = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM currency_wallet_snapshots WHERE account_id = $1",
      ["acc-wallet-hidden"],
    );
    expect(hiddenWalletRows[0].count).toBe(0);

    // Negative-regression sibling: active account's wallet snapshot lands OK.
    const { rows: activeWalletRows } = await pool.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM currency_wallet_snapshots WHERE account_id = $1",
      ["acc-wallet-active"],
    );
    expect(activeWalletRows[0].count).toBeGreaterThanOrEqual(1);
  });

  it("HIGH regression — getMonitoredSet does NOT return tickers from soft-deleted accounts", async () => {
    // Two accounts, each with a distinct ticker. Soft-delete A; B survives.
    // getMonitoredSet feeds the daily-refresh enqueue path, so a leak here
    // would re-enqueue backfills for accounts the user has deleted.
    await seedAccountWithData("acc-mon-hidden", "Monitored Hidden", "9351");
    await seedAccountWithData("acc-mon-active", "Monitored Active", "9352");
    await persistence!.softDeleteAccount("acc-mon-hidden", ownerUserId, {
      actorUserId: ownerUserId,
      ipAddress: null,
      metadata: {},
    });

    const monitored = await persistence!.getMonitoredSet(ownerUserId);
    const tickers = new Set(monitored.map((m) => m.ticker));

    expect(tickers.has("9352")).toBe(true);
    expect(tickers.has("9351")).toBe(false);
  });

  it("MEDIUM regression — listDividendLedgerYears does NOT return years from soft-deleted accounts", async () => {
    // Seed two accounts with dividend ledger entries in different years.
    // Soft-delete A (year 2024); B (year 2025) survives. The years listing
    // drives the dividend ledger UI year picker — a leak would surface the
    // hidden account's year as a selectable filter.
    await seedAccountWithData("acc-div-hidden", "Dividend Hidden", "9451");
    await seedAccountWithData("acc-div-active", "Dividend Active", "9452");

    // Seed dividend_events (parent FK target) with distinct payment_date years,
    // then a dividend_ledger_entry for each account that references its event.
    await pool.query(
      `INSERT INTO market_data.dividend_events
         (id, ticker, event_type, ex_dividend_date, payment_date,
          cash_dividend_per_share, stock_dividend_per_share, cash_dividend_currency)
       VALUES
         ('evt-div-hidden', '9451', 'CASH', '2024-06-01', '2024-06-15', 1.0, 0, 'TWD'),
         ('evt-div-active', '9452', 'CASH', '2025-06-01', '2025-06-15', 1.0, 0, 'TWD')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO dividend_ledger_entries
         (id, account_id, dividend_event_id, eligible_quantity,
          expected_cash_amount, expected_stock_quantity, received_stock_quantity,
          posting_status, reconciliation_status)
       VALUES
         ('div-hidden-1', 'acc-div-hidden', 'evt-div-hidden', 100, 100, 0, 0, 'expected', 'open'),
         ('div-active-1', 'acc-div-active', 'evt-div-active', 200, 200, 0, 0, 'expected', 'open')
       ON CONFLICT (id) DO NOTHING`,
    );

    // Soft-delete A so its 2024-year dividend should NOT surface in the year list.
    await persistence!.softDeleteAccount("acc-div-hidden", ownerUserId, {
      actorUserId: null,
      ipAddress: null,
      metadata: {},
    });

    const { years } = await persistence!.listDividendLedgerYears(ownerUserId);

    expect(years).toEqual([2025]);
  });
});
