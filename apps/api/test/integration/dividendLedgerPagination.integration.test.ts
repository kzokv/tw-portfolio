import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import type { DividendLedgerListOptions } from "../../src/persistence/types.js";
import type { DividendLedgerRecomputeChange } from "../../src/services/dividends.js";
import type { DividendLedgerEntry } from "../../src/types/store.js";

// ── Postgres integration gate ─────────────────────────────────────────────────
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

// ── Shared default query options ─────────────────────────────────────────────

const defaultOpts: DividendLedgerListOptions = {
  page: 1,
  limit: 50,
  sortBy: "paymentDate",
  sortOrder: "desc",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describePostgres("PostgresPersistence.listDividendLedgerEntries — pagination/sort/filter/aggregates", () => {
  let persistence: PostgresPersistence;
  let pool: Pool;
  let userId: string;
  let accountId: string;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    userId = store.userId;
    accountId = store.accounts[0]!.id; // "user-1-acc-1"

    pool = new Pool({ connectionString: databaseUrl });

    // KZO-183: dividend events seeded below all use USD currency, but the
    // auto-seeded account defaults to TWD. The dividend market-guard trigger
    // would reject inserts otherwise. Switch the account to USD before tests.
    await pool.query(`UPDATE accounts SET default_currency = 'USD' WHERE id = $1`, [accountId]);
  });

  afterEach(async () => {
    await persistence.close();
    await pool.end();
  });

  // ── Seed helpers ────────────────────────────────────────────────────────────

  async function insertDividendEvent(
    ticker: string,
    currency: string,
    exDivDate: string,
    paymentDate: string | null,
  ): Promise<string> {
    const id = randomUUID();
    const marketCode = currency === "USD" ? "US" : currency === "AUD" ? "AU" : "TW";
    await pool.query(
      `INSERT INTO market_data.dividend_events
         (id, ticker, market_code, event_type, ex_dividend_date, payment_date,
          cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share, source)
       VALUES ($1, $2, $3, 'CASH', $4, $5, 1, $6, 0, 'test_seed')`,
      [id, ticker, marketCode, exDivDate, paymentDate, currency],
    );
    return id;
  }

  async function insertLedgerEntry(params: {
    eventId: string;
    accountId?: string;
    expectedCashAmount: number;
    receivedCashAmount?: number;
    postingStatus?: string;
    reconciliationStatus?: string;
    supersededAt?: string | null;
    reversalOf?: string | null;
    customId?: string;
  }): Promise<string> {
    const id = params.customId ?? randomUUID();
    await pool.query(
      `INSERT INTO dividend_ledger_entries
         (id, account_id, dividend_event_id, eligible_quantity,
          expected_cash_amount, expected_stock_quantity, received_stock_quantity,
          posting_status, reconciliation_status, version,
          source_composition_status, booked_at, superseded_at,
          reversal_of_dividend_ledger_entry_id)
       VALUES ($1, $2, $3, 10,
               $4, 0, 0,
               $5, $6, 1,
               'provided', NOW(), $7,
               $8)`,
      [
        id,
        params.accountId ?? accountId,
        params.eventId,
        params.expectedCashAmount,
        params.postingStatus ?? "posted",
        params.reconciliationStatus ?? "open",
        params.supersededAt ?? null,
        params.reversalOf ?? null,
      ],
    );
    return id;
  }

  it("applies created, updated, and retired dividend rows without rewriting unrelated rows", async () => {
    const updatedEventId = await insertDividendEvent("AAPL", "USD", "2026-03-01", "2026-03-20");
    const createdEventId = await insertDividendEvent("MSFT", "USD", "2026-03-02", "2026-03-21");
    const unrelatedEventId = await insertDividendEvent("GOOG", "USD", "2026-03-03", "2026-03-22");
    const updatedId = await insertLedgerEntry({ eventId: updatedEventId, expectedCashAmount: 10 });
    const unrelatedId = await insertLedgerEntry({ eventId: unrelatedEventId, expectedCashAmount: 30 });

    const nextEntry = (overrides: Partial<DividendLedgerEntry>): DividendLedgerEntry => ({
      id: overrides.id ?? updatedId,
      accountId,
      dividendEventId: overrides.dividendEventId ?? updatedEventId,
      eligibleQuantity: overrides.eligibleQuantity ?? 20,
      expectedCashAmount: overrides.expectedCashAmount ?? 20,
      expectedStockQuantity: 0,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "expected",
      reconciliationStatus: "open",
      version: overrides.version ?? 2,
      sourceCompositionStatus: "unknown_pending_disclosure",
      supersededAt: overrides.supersededAt,
    });
    const change = (
      kind: DividendLedgerRecomputeChange["changeKind"],
      entry: DividendLedgerEntry,
      previousVersion: number,
    ): DividendLedgerRecomputeChange => ({
      changeKind: kind,
      ledgerEntryId: entry.id,
      accountId,
      dividendEventId: entry.dividendEventId,
      previousVersion,
      nextVersion: entry.version,
      previousEligibleQuantity: kind === "created" ? 0 : 10,
      nextEligibleQuantity: entry.eligibleQuantity,
      previousExpectedCashAmount: kind === "created" ? 0 : 10,
      nextExpectedCashAmount: entry.expectedCashAmount,
      previousExpectedStockQuantity: 0,
      nextExpectedStockQuantity: 0,
      reconciliationReset: false,
      previousReconciliationStatus: "open",
      nextReconciliationStatus: "open",
      nextEntry: entry,
    });

    const createdEntry = nextEntry({
      id: "recompute-created",
      dividendEventId: createdEventId,
      eligibleQuantity: 15,
      expectedCashAmount: 15,
      version: 1,
    });
    const applied = await persistence.applyDividendLedgerRecompute(userId, [
      change("updated", nextEntry({}), 1),
      change("created", createdEntry, 0),
    ]);
    expect(applied).toHaveLength(2);

    const retiredEntry = nextEntry({ eligibleQuantity: 0, expectedCashAmount: 0, version: 3, supersededAt: "2026-04-01T00:00:00.000Z" });
    expect(await persistence.applyDividendLedgerRecompute(userId, [change("retired", retiredEntry, 2)])).toHaveLength(1);
    expect(await persistence.applyDividendLedgerRecompute(userId, [change("updated", nextEntry({ version: 4 }), 1)])).toEqual([]);

    const rows = await pool.query<{
      id: string;
      expected_cash_amount: string;
      version: number;
      superseded_at: Date | null;
    }>(
      `SELECT id, expected_cash_amount, version, superseded_at
         FROM dividend_ledger_entries
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [[createdEntry.id, unrelatedId, updatedId]],
    );
    expect(rows.rows.map((row) => ({
      ...row,
      expected_cash_amount: Number(row.expected_cash_amount),
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: createdEntry.id, expected_cash_amount: 15, version: 1 }),
      expect.objectContaining({ id: unrelatedId, expected_cash_amount: 30, version: 1, superseded_at: null }),
      expect.objectContaining({ id: updatedId, expected_cash_amount: 0, version: 3, superseded_at: expect.any(Date) }),
    ]));
  });

  /** Seed a DIVIDEND_RECEIPT cash ledger entry linked to a ledger row. */
  async function insertReceipt(
    ledgerEntryId: string,
    amount: number,
    currency: string,
    targetUserId: string = userId,
    targetAccountId: string = accountId,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO cash_ledger_entries
         (id, user_id, account_id, entry_date, entry_type, amount, currency,
          related_dividend_ledger_entry_id, source)
       VALUES ($1, $2, $3, CURRENT_DATE, 'DIVIDEND_RECEIPT', $4, $5, $6, 'test_seed')`,
      [randomUUID(), targetUserId, targetAccountId, amount, currency, ledgerEntryId],
    );
  }

  async function insertTrade(params: {
    ticker: string;
    marketCode?: string;
    quantity?: number;
    tradeDate?: string;
    reversalOf?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const bookedAt = `${params.tradeDate ?? "2024-03-01"}T00:00:00.000Z`;
    const feePolicySnapshotId = `trade-fee-snapshot:${id}`;
    await pool.query(
      `INSERT INTO trade_fee_policy_snapshots (
         id, user_id, profile_id_at_booking, profile_name_at_booking, board_commission_rate,
         commission_discount_percent, minimum_commission_amount, commission_currency,
         commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
         stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode, booked_at
       ) VALUES (
         $1, $2, 'fp-default', 'Default Broker', 1.425,
         0, 20, 'USD',
         'FLOOR', 'FLOOR', 30,
         15, 10, 0,
         'CHARGED_UPFRONT', $3
       )`,
      [feePolicySnapshotId, userId, bookedAt],
    );
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, ticker, market_code, instrument_type, trade_type,
         quantity, unit_price, price_currency, trade_date, trade_timestamp, booking_sequence,
         commission_amount, tax_amount, is_day_trade, fee_policy_snapshot_id,
         source, source_reference, booked_at, reversal_of_trade_event_id
       ) VALUES (
         $1, $2, $3, $4, $5, 'STOCK', 'BUY',
         $6, 100, 'USD', $7, $8, 1,
         0, 0, false, $9,
         'test_seed', $1, $8, $10
       )`,
      [
        id,
        userId,
        accountId,
        params.ticker,
        params.marketCode ?? "US",
        params.quantity ?? 10,
        params.tradeDate ?? "2024-03-01",
        bookedAt,
        feePolicySnapshotId,
        params.reversalOf ?? null,
      ],
    );
    return id;
  }

  /** Convenience: event + entry + optional receipt in one call. */
  async function seedFull(params: {
    ticker: string;
    currency: string;
    paymentDate: string | null;
    expected: number;
    received: number;
    reconciliationStatus?: string;
    accountId?: string;
    customId?: string;
  }): Promise<string> {
    const eventId = await insertDividendEvent(
      params.ticker,
      params.currency,
      params.paymentDate ?? "2024-01-01",
      params.paymentDate,
    );
    const entryId = await insertLedgerEntry({
      eventId,
      accountId: params.accountId,
      expectedCashAmount: params.expected,
      receivedCashAmount: params.received,
      reconciliationStatus: params.reconciliationStatus,
      customId: params.customId,
    });
    if (params.received !== 0) {
      await insertReceipt(entryId, params.received, params.currency, userId, params.accountId ?? accountId);
    }
    return entryId;
  }

  it("preserves instrument display names when hydrating the Postgres store", async () => {
    await pool.query(
      `INSERT INTO market_data.instruments (ticker, market_code, name, instrument_type, bars_backfill_status)
       VALUES ('DVDNAME', 'US', 'Dividend Name Corp', 'STOCK', 'ready')
       ON CONFLICT (ticker, market_code)
       DO UPDATE SET name = EXCLUDED.name, instrument_type = EXCLUDED.instrument_type`,
    );

    const store = await persistence.loadStore(userId);

    expect(store.instruments).toContainEqual(expect.objectContaining({
      ticker: "DVDNAME",
      marketCode: "US",
      name: "Dividend Name Corp",
    }));
  });

  // ── IG-01/02: Response shape + default order ───────────────────────────────

  it("IG-01/02: default call returns { ledgerEntries, total, aggregates } ordered by payment_date DESC", async () => {
    const idMar = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });
    const idApr = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-04-15", expected: 200, received: 200 });
    const idMay = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-05-15", expected: 300, received: 300 });

    const result = await persistence.listDividendLedgerEntries(userId, defaultOpts);
    expect(result.ledgerEntries.map((e) => e.id)).toEqual([idMay, idApr, idMar]);
    expect(result.total).toBe(3);
    expect(result.aggregates).toMatchObject({
      totalExpectedCashAmount: { USD: 600 },
      totalReceivedCashAmount: { USD: 600 },
      openCount: 3,
    });
  });

  it("IG-R1: review call returns expected rows and full aggregates from the consolidated query", async () => {
    await insertTrade({ ticker: "AAPL", quantity: 10, tradeDate: "2024-03-01" });
    const eventId = await insertDividendEvent("AAPL", "USD", "2024-03-15", "2024-04-15");

    const result = await persistence.listDividendReviewRows(userId, {
      ...defaultOpts,
      ticker: "AAPL",
    });

    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      rowKind: "expected",
      dividendEventId: eventId,
      ticker: "AAPL",
      eligibleQuantity: 10,
      expectedCashAmount: 10,
      receivedCashAmount: 0,
      postingStatus: "expected",
      reconciliationStatus: "open",
    });
    expect(result.aggregates).toMatchObject({
      totalExpectedCashAmount: { USD: 10 },
      totalReceivedCashAmount: { USD: 0 },
      openCount: 1,
      byTicker: { AAPL: { USD: { expected: 10, received: 0 } } },
    });
  });

  // ── IG-03: Ticker filter ───────────────────────────────────────────────────

  it("IG-03: ticker filter returns only matching rows", async () => {
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-04-15", expected: 200, received: 200 });
    await seedFull({ ticker: "GOOG", currency: "USD", paymentDate: "2024-05-15", expected: 999, received: 999 });

    const result = await persistence.listDividendLedgerEntries(userId, { ...defaultOpts, ticker: "AAPL" });
    expect(result.total).toBe(2);
    expect(result.ledgerEntries).toHaveLength(2);
    expect(result.aggregates.totalExpectedCashAmount).toEqual({ USD: 300 });
    expect(result.aggregates.byTicker).toEqual({ AAPL: { USD: { expected: 300, received: 300 } } });
  });

  it("IG-03b: marketCode filter scopes ticker rows by event market", async () => {
    await seedFull({ ticker: "BHP", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });

    const usResult = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts,
      ticker: "BHP",
      marketCode: "US",
    });
    const auResult = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts,
      ticker: "BHP",
      marketCode: "AU",
    });

    expect(usResult.total).toBe(1);
    expect(usResult.ledgerEntries[0]!.expectedCashAmount).toBe(100);
    expect(auResult.total).toBe(0);
  });

  // ── IG-04/05: Existing filters still work ──────────────────────────────────

  it("IG-04: reconciliationStatus + postingStatus filters still work after refactor", async () => {
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 0, reconciliationStatus: "open" });
    const expectedEventId = await insertDividendEvent("AAPL", "USD", "2024-04-01", "2024-04-15");
    await insertLedgerEntry({
      eventId: expectedEventId,
      expectedCashAmount: 200,
      postingStatus: "expected",
      reconciliationStatus: "open",
    });
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-05-15", expected: 300, received: 300, reconciliationStatus: "matched" });

    const result = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, reconciliationStatus: "open", postingStatus: "posted",
    });
    expect(result.total).toBe(1);
    expect(result.ledgerEntries[0]!.postingStatus).toBe("posted");
    expect(result.ledgerEntries[0]!.reconciliationStatus).toBe("open");
  });

  it("IG-05: ticker filter + reconciliationStatus filter intersect", async () => {
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100, reconciliationStatus: "open" });
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-04-15", expected: 200, received: 200, reconciliationStatus: "matched" });
    await seedFull({ ticker: "GOOG", currency: "USD", paymentDate: "2024-05-15", expected: 999, received: 999, reconciliationStatus: "open" });

    const result = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, ticker: "AAPL", reconciliationStatus: "open",
    });
    expect(result.total).toBe(1);
    expect(result.ledgerEntries[0]!.expectedCashAmount).toBe(100);
  });

  // ── IG-06..IG-11: Sort columns ────────────────────────────────────────────

  it("IG-06/07: sortBy=ticker ASC and DESC", async () => {
    const aId = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 100, received: 100 });
    const gId = await seedFull({ ticker: "GOOG", currency: "USD", paymentDate: "2024-03-16", expected: 100, received: 100 });
    const mId = await seedFull({ ticker: "MSFT", currency: "USD", paymentDate: "2024-03-17", expected: 100, received: 100 });

    const asc = await persistence.listDividendLedgerEntries(userId, { ...defaultOpts, sortBy: "ticker", sortOrder: "asc" });
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([aId, gId, mId]);

    const desc = await persistence.listDividendLedgerEntries(userId, { ...defaultOpts, sortBy: "ticker", sortOrder: "desc" });
    expect(desc.ledgerEntries.map((e) => e.id)).toEqual([mId, gId, aId]);
  });

  it("IG-08: sortBy=account uses accounts.name", async () => {
    // Seed a second account under user-1 with a name that sorts BEFORE the default one.
    // KZO-183: each account requires its own owner fee profile (composite FK ownership).
    // Wrap account + fee_profile insert in a transaction so the deferred FK fires at COMMIT.
    const acc2Id = "user-1-acc-2";
    const acc2ProfileId = "user-1-acc-2-fp-default";
    {
      const txClient = await pool.connect();
      try {
        await txClient.query("BEGIN");
        await txClient.query(
          `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
           VALUES ($1, $2, $3, $4, 'USD', 'broker')`,
          [acc2Id, userId, "Alpha Broker", acc2ProfileId],
        );
        await txClient.query(
          `INSERT INTO fee_profiles (
             id, account_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent,
             commission_discount_bps, minimum_commission_amount, commission_currency,
             commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
             stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
             commission_charge_mode
           ) VALUES ($1, $2, 'Alpha Default', 14, 1.425, 0, 10000, 20, 'USD', 'FLOOR', 'FLOOR',
                     30, 15, 10, 0, 'CHARGED_UPFRONT')`,
          [acc2ProfileId, acc2Id],
        );
        await txClient.query("COMMIT");
      } catch (err) {
        await txClient.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        txClient.release();
      }
    }

    const mainEntryId = await seedFull({
      ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15",
      expected: 100, received: 100, accountId,
    });
    const alphaEntryId = await seedFull({
      ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16",
      expected: 100, received: 100, accountId: acc2Id,
    });

    const asc = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, sortBy: "account", sortOrder: "asc",
    });

    // Fetch the default account name so we can correctly predict ordering.
    const { rows } = await pool.query("SELECT name FROM accounts WHERE id = $1", [accountId]);
    const defaultAccountName = rows[0]!.name as string;

    const expectedOrder = "Alpha Broker" < defaultAccountName
      ? [alphaEntryId, mainEntryId]
      : [mainEntryId, alphaEntryId];
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual(expectedOrder);
  });

  it("IG-09: sortBy=expectedCashAmount DESC numerical", async () => {
    const lowId = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 50, received: 50 });
    const highId = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 1000, received: 1000 });
    const midId = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17", expected: 200, received: 200 });

    const desc = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, sortBy: "expectedCashAmount", sortOrder: "desc",
    });
    expect(desc.ledgerEntries.map((e) => e.id)).toEqual([highId, midId, lowId]);
  });

  it("IG-10: sortBy=receivedCashAmount ASC numerical, COALESCE(null,0) treated as 0", async () => {
    const noReceiptId = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15", expected: 500, received: 0 });
    const midId = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16", expected: 500, received: 200 });
    const highId = await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17", expected: 500, received: 800 });

    const asc = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, sortBy: "receivedCashAmount", sortOrder: "asc",
    });
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([noReceiptId, midId, highId]);
  });

  it("IG-11: sortBy=reconciliationStatus ASC lexicographic", async () => {
    const openId = await seedFull({
      ticker: "AAPL", currency: "USD", paymentDate: "2024-03-15",
      expected: 100, received: 100, reconciliationStatus: "open",
    });
    const matchedId = await seedFull({
      ticker: "AAPL", currency: "USD", paymentDate: "2024-03-16",
      expected: 100, received: 100, reconciliationStatus: "matched",
    });
    const explainedId = await seedFull({
      ticker: "AAPL", currency: "USD", paymentDate: "2024-03-17",
      expected: 100, received: 100, reconciliationStatus: "explained",
    });

    const asc = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, sortBy: "reconciliationStatus", sortOrder: "asc",
    });
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([explainedId, matchedId, openId]);
  });

  // ── IG-12: Stable id tiebreaker ────────────────────────────────────────────

  it("IG-12: stable dle.id tiebreaker — primary sort DESC, id tiebreaker still ASC", async () => {
    const idLow = "00000000-0000-4000-8000-aaaaaaaaaaaa";
    const idHigh = "00000000-0000-4000-8000-bbbbbbbbbbbb";
    const evt1 = await insertDividendEvent("AAPL", "USD", "2024-03-01", "2024-03-15");
    const evt2 = await insertDividendEvent("AAPL", "USD", "2024-03-01", "2024-03-15");
    await insertLedgerEntry({ eventId: evt1, expectedCashAmount: 100, customId: idLow });
    await insertLedgerEntry({ eventId: evt2, expectedCashAmount: 100, customId: idHigh });

    const asc = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, sortBy: "expectedCashAmount", sortOrder: "asc",
    });
    expect(asc.ledgerEntries.map((e) => e.id)).toEqual([idLow, idHigh]);

    const desc = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, sortBy: "expectedCashAmount", sortOrder: "desc",
    });
    // Primary sort DESC but tie → id ASC tiebreaker preserved (stable)
    expect(desc.ledgerEntries.map((e) => e.id)).toEqual([idLow, idHigh]);
  });

  // ── IG-13..IG-16: Pagination (OFFSET) ──────────────────────────────────────

  it("IG-13: ?page=2&limit=2 with 5 entries returns rows [2..3] of sorted full set", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(
        await seedFull({
          ticker: "AAPL",
          currency: "USD",
          paymentDate: `2024-03-${String(10 + i).padStart(2, "0")}`,
          expected: 100 + i,
          received: 100 + i,
        }),
      );
    }
    // Default sort is paymentDate DESC → ids in reverse insertion order
    const reversedIds = [...ids].reverse();

    const page2 = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, page: 2, limit: 2,
    });
    expect(page2.ledgerEntries.map((e) => e.id)).toEqual([reversedIds[2], reversedIds[3]]);
    expect(page2.total).toBe(5);
  });

  it("IG-14: ?page=1&limit=2 → aggregates.total reflects full count (not page size)", async () => {
    for (let i = 0; i < 5; i++) {
      await seedFull({
        ticker: "AAPL",
        currency: "USD",
        paymentDate: `2024-03-${String(10 + i).padStart(2, "0")}`,
        expected: 100,
        received: 100,
      });
    }

    const page1 = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, page: 1, limit: 2,
    });
    expect(page1.ledgerEntries).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.aggregates.totalExpectedCashAmount).toEqual({ USD: 500 });
    expect(page1.aggregates.totalReceivedCashAmount).toEqual({ USD: 500 });

    // The same call on page 2 must yield identical aggregates.
    const page2 = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, page: 2, limit: 2,
    });
    expect(page2.aggregates.totalExpectedCashAmount).toEqual({ USD: 500 });
    expect(page2.aggregates.totalReceivedCashAmount).toEqual({ USD: 500 });
  });

  it("IG-15: page past end returns empty rows but preserves total + aggregates", async () => {
    for (let i = 0; i < 3; i++) {
      await seedFull({
        ticker: "AAPL",
        currency: "USD",
        paymentDate: `2024-03-${String(10 + i).padStart(2, "0")}`,
        expected: 100,
        received: 100,
      });
    }

    const pageFar = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, page: 99, limit: 50,
    });
    expect(pageFar.ledgerEntries).toEqual([]);
    expect(pageFar.total).toBe(3);
    expect(pageFar.aggregates.totalExpectedCashAmount).toEqual({ USD: 300 });
  });

  // ── IG-17..IG-20: Aggregates (Postgres GROUP BY correctness) ──────────────

  it("IG-17: aggregates.byMonth groups by to_char(payment_date,'YYYY-MM') × currency", async () => {
    // KZO-183: TWD dividends require a TWD account. Seed a second account
    // (with its own owner fee profile per composite-FK ownership invariant).
    const twdAccountId = "user-1-acc-twd";
    const twdProfileId = "user-1-acc-twd-fp";
    {
      const txClient = await pool.connect();
      try {
        await txClient.query("BEGIN");
        await txClient.query(
          `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
           VALUES ($1, $2, 'TWD Account', $3, 'TWD', 'broker')`,
          [twdAccountId, userId, twdProfileId],
        );
        await txClient.query(
          `INSERT INTO fee_profiles (
             id, account_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent,
             commission_discount_bps, minimum_commission_amount, commission_currency,
             commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
             stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
             commission_charge_mode
           ) VALUES ($1, $2, 'TWD Default', 14, 1.425, 0, 10000, 20, 'TWD', 'FLOOR', 'FLOOR',
                     30, 15, 10, 0, 'CHARGED_UPFRONT')`,
          [twdProfileId, twdAccountId],
        );
        await txClient.query("COMMIT");
      } catch (err) {
        await txClient.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        txClient.release();
      }
    }

    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-10", expected: 100, received: 90 });
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-20", expected: 200, received: 180 });
    await seedFull({ ticker: "2330", currency: "TWD", paymentDate: "2024-03-25", expected: 300, received: 270, accountId: twdAccountId });
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-04-10", expected: 400, received: 360 });

    const result = await persistence.listDividendLedgerEntries(userId, defaultOpts);
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

  it("IG-18: aggregates.byTicker groups by ticker × currency", async () => {
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-10", expected: 100, received: 90 });
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-20", expected: 200, received: 180 });
    await seedFull({ ticker: "GOOG", currency: "USD", paymentDate: "2024-03-25", expected: 400, received: 360 });

    const result = await persistence.listDividendLedgerEntries(userId, defaultOpts);
    expect(result.aggregates.byTicker).toEqual({
      AAPL: { USD: { expected: 300, received: 270 } },
      GOOG: { USD: { expected: 400, received: 360 } },
    });
  });

  it("IG-19: openCount reflects full filtered set, not current page", async () => {
    for (let i = 0; i < 4; i++) {
      await seedFull({
        ticker: "AAPL", currency: "USD", paymentDate: `2024-03-${String(10 + i).padStart(2, "0")}`,
        expected: 100, received: 100, reconciliationStatus: "open",
      });
    }
    for (let i = 0; i < 2; i++) {
      await seedFull({
        ticker: "AAPL", currency: "USD", paymentDate: `2024-04-${String(10 + i).padStart(2, "0")}`,
        expected: 100, received: 100, reconciliationStatus: "matched",
      });
    }

    const result = await persistence.listDividendLedgerEntries(userId, {
      ...defaultOpts, page: 1, limit: 1,
    });
    expect(result.ledgerEntries).toHaveLength(1);
    expect(result.total).toBe(6);
    expect(result.aggregates.openCount).toBe(4);
  });

  it("IG-20: aggregates exclude superseded and reversed entries", async () => {
    // Active entry
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-10", expected: 100, received: 100 });

    // Superseded entry
    const supEvt = await insertDividendEvent("AAPL", "USD", "2024-03-01", "2024-03-15");
    await insertLedgerEntry({
      eventId: supEvt, expectedCashAmount: 999,
      supersededAt: new Date("2024-03-16T00:00:00Z").toISOString(),
    });

    // Reversed entry (original points to reversal)
    // NB: expected_cash_amount has a >= 0 CHECK constraint, so the reversal row
    // stores the absolute amount and is identified via reversal_of_dividend_ledger_entry_id.
    const revEvt = await insertDividendEvent("AAPL", "USD", "2024-03-02", "2024-03-20");
    const origId = await insertLedgerEntry({ eventId: revEvt, expectedCashAmount: 888 });
    await insertLedgerEntry({
      eventId: revEvt, expectedCashAmount: 888, reversalOf: origId,
    });

    const result = await persistence.listDividendLedgerEntries(userId, defaultOpts);
    expect(result.total).toBe(1);
    expect(result.aggregates.totalExpectedCashAmount).toEqual({ USD: 100 });
    expect(result.aggregates.openCount).toBe(1);
  });

  // ── IG-26: Tenant isolation (main endpoint) ────────────────────────────────

  it("IG-26: user-1 query never returns user-2 entries", async () => {
    // user-1 entries
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-10", expected: 100, received: 100 });
    await seedFull({ ticker: "AAPL", currency: "USD", paymentDate: "2024-03-11", expected: 200, received: 200 });

    // Seed user-2 via loadStore to create default user + account
    const store2 = await persistence.loadStore("user-2");
    const user2Id = store2.userId;
    const user2AccountId = store2.accounts[0]!.id;
    // KZO-183: switch user-2's auto-seeded account to USD to satisfy the dividend market guard.
    await pool.query(`UPDATE accounts SET default_currency = 'USD' WHERE id = $1`, [user2AccountId]);

    const u2Evt = await insertDividendEvent("AAPL", "USD", "2024-03-01", "2024-03-12");
    const u2EntryId = await insertLedgerEntry({
      eventId: u2Evt,
      accountId: user2AccountId,
      expectedCashAmount: 9999,
    });
    await insertReceipt(u2EntryId, 9999, "USD", user2Id, user2AccountId);

    // user-1 query: must not include user-2 rows or amounts
    const u1Result = await persistence.listDividendLedgerEntries(userId, defaultOpts);
    expect(u1Result.total).toBe(2);
    expect(u1Result.aggregates.totalExpectedCashAmount).toEqual({ USD: 300 });
    for (const row of u1Result.ledgerEntries) {
      expect(row.accountId).toBe(accountId);
    }

    // user-2 query: must see only user-2's own row
    const u2Result = await persistence.listDividendLedgerEntries(user2Id, defaultOpts);
    expect(u2Result.total).toBe(1);
    expect(u2Result.ledgerEntries[0]!.id).toBe(u2EntryId);
    expect(u2Result.aggregates.totalExpectedCashAmount).toEqual({ USD: 9999 });
  });
});

// ── Separate describePostgres block for /years endpoint ──────────────────────

describePostgres("PostgresPersistence.listDividendLedgerYears", () => {
  let persistence: PostgresPersistence;
  let pool: Pool;
  let userId: string;
  let accountId: string;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    const store = await persistence.loadStore("user-1");
    userId = store.userId;
    accountId = store.accounts[0]!.id;
    pool = new Pool({ connectionString: databaseUrl });
    // KZO-183: dividend events use USD; switch account to USD to satisfy market guard.
    await pool.query(`UPDATE accounts SET default_currency = 'USD' WHERE id = $1`, [accountId]);
  });

  afterEach(async () => {
    await persistence.close();
    await pool.end();
  });

  async function insertEvent(ticker: string, paymentDate: string | null): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO market_data.dividend_events
         (id, ticker, event_type, ex_dividend_date, payment_date,
          cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share, source)
       VALUES ($1, $2, 'CASH', $3, $4, 1, 'USD', 0, 'test_seed')`,
      [id, ticker, paymentDate ?? "2020-01-01", paymentDate],
    );
    return id;
  }

  async function insertEntry(params: {
    eventId: string;
    accountId?: string;
    supersededAt?: string | null;
    reversalOf?: string | null;
    postingStatus?: string;
    reconciliationStatus?: string;
  }): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO dividend_ledger_entries
         (id, account_id, dividend_event_id, eligible_quantity,
          expected_cash_amount, expected_stock_quantity, received_stock_quantity,
          posting_status, reconciliation_status, version,
          source_composition_status, booked_at, superseded_at,
          reversal_of_dividend_ledger_entry_id)
       VALUES ($1, $2, $3, 10,
               100, 0, 0,
               $4, $5, 1,
               'provided', NOW(), $6, $7)`,
      [
        id,
        params.accountId ?? accountId,
        params.eventId,
        params.postingStatus ?? "posted",
        params.reconciliationStatus ?? "open",
        params.supersededAt ?? null,
        params.reversalOf ?? null,
      ],
    );
    return id;
  }

  async function insertLot(params: {
    id?: string;
    accountId?: string;
    ticker?: string;
    openedAt: string;
    openQuantity?: number;
    costCurrency?: string;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO lots (
         id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence
       ) VALUES ($1, $2, $3, $4, 100, $5, $6, 1)`,
      [
        params.id ?? randomUUID(),
        params.accountId ?? accountId,
        params.ticker ?? "AAPL",
        params.openQuantity ?? 10,
        params.costCurrency ?? "USD",
        params.openedAt,
      ],
    );
  }

  it("IG-21: returns current holding years from earliest open lot through current year", async () => {
    await insertLot({ openedAt: "2024-03-15" });
    await insertLot({ openedAt: "2022-06-01", ticker: "MSFT" });

    const { years } = await persistence.listDividendLedgerYears(userId);
    const currentYear = new Date().getUTCFullYear();
    expect(years).toEqual(Array.from({ length: currentYear - 2022 + 1 }, (_, index) => 2022 + index));
  });

  it("IG-22: ignores closed lots", async () => {
    await insertLot({ openedAt: "2019-01-01", openQuantity: 0 });
    await insertLot({ openedAt: "2025-03-15" });

    const { years } = await persistence.listDividendLedgerYears(userId);
    const currentYear = new Date().getUTCFullYear();
    expect(years).toEqual(Array.from({ length: currentYear - 2025 + 1 }, (_, index) => 2025 + index));
  });

  it("IG-22b: clamps future open lot years to the current year", async () => {
    const currentYear = new Date().getUTCFullYear();
    await insertLot({ openedAt: `${currentYear + 1}-03-15` });

    const { years } = await persistence.listDividendLedgerYears(userId);
    expect(years).toEqual([currentYear]);
  });

  it("IG-23: ignores dividend ledger payment years", async () => {
    const evt = await insertEvent("AAPL", "2024-03-15");
    await insertEntry({ eventId: evt });

    const { years } = await persistence.listDividendLedgerYears(userId);
    expect(years).toEqual([]);
  });

  it("IG-24: excludes open lots on soft-deleted accounts", async () => {
    await pool.query(`UPDATE accounts SET deleted_at = NOW() WHERE id = $1`, [accountId]);
    await insertLot({ openedAt: "2024-03-15" });

    const { years } = await persistence.listDividendLedgerYears(userId);
    expect(years).toEqual([]);
  });

  it("IG-25: empty store → years: []", async () => {
    const { years } = await persistence.listDividendLedgerYears(userId);
    expect(years).toEqual([]);
  });

  it("IG-27: /years tenant isolation — user-1 never sees user-2 years", async () => {
    await insertLot({ openedAt: "2024-03-15" });

    const store2 = await persistence.loadStore("user-2");
    const user2Id = store2.userId;
    const user2AccountId = store2.accounts[0]!.id;
    await insertLot({ accountId: user2AccountId, openedAt: "2018-06-01" });

    const u1 = await persistence.listDividendLedgerYears(userId);
    const currentYear = new Date().getUTCFullYear();
    expect(u1.years).toEqual(Array.from({ length: currentYear - 2024 + 1 }, (_, index) => 2024 + index));
    expect(u1.years).not.toContain(2018);

    const u2 = await persistence.listDividendLedgerYears(user2Id);
    expect(u2.years).toEqual(Array.from({ length: currentYear - 2018 + 1 }, (_, index) => 2018 + index));
  });
});
