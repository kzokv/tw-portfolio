import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

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

const shouldRunPostgresSuite =
  runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
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

// This suite intentionally exercises the real Postgres schema so column-name
// drift between code and migrations (e.g. SELECT side vs. trade_type) cannot
// ship without being caught. Memory-backed suites skip these queries entirely.
describePostgres("PostgresPersistence.getSnapshotGenerationInputs", () => {
  let persistence: PostgresPersistence;
  let pool: Pool;
  let userId: string;
  let accountId: string;
  let feeProfileId: string;

  async function seedFeePolicySnapshot(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO trade_fee_policy_snapshots (
         id, user_id, profile_id_at_booking, profile_name_at_booking,
         board_commission_rate, commission_discount_percent,
         minimum_commission_amount, commission_currency,
         commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
         etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode
       ) VALUES ($1, $2, $3, 'Default Broker',
                 1.425, 28,
                 20, 'TWD',
                 'FLOOR', 'FLOOR',
                 30, 15,
                 10, 0,
                 'CHARGED_UPFRONT')`,
      [id, userId, feeProfileId],
    );
    return id;
  }

  async function seedTrade(overrides: {
    ticker: string;
    tradeDate: string;
    tradeType: "BUY" | "SELL";
    quantity: number;
    unitPrice: number;
    bookingSequence?: number;
    tradeTimestamp?: string;
    accountId?: string;
  }): Promise<string> {
    const snapshotId = await seedFeePolicySnapshot();
    const id = randomUUID();
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, ticker,
         instrument_type, trade_type, quantity, unit_price,
         trade_date, commission_amount, tax_amount, is_day_trade,
         source, trade_timestamp, booking_sequence,
         price_currency, fee_policy_snapshot_id, market_code
       ) VALUES ($1, $2, $3, $4,
                 'STOCK', $5, $6, $7,
                 $8::date, 0, 0, false,
                 'manual_trade', $9::timestamptz, $10,
                 'TWD', $11, 'TW')`,
      [
        id,
        userId,
        overrides.accountId ?? accountId,
        overrides.ticker,
        overrides.tradeType,
        overrides.quantity,
        overrides.unitPrice,
        overrides.tradeDate,
        overrides.tradeTimestamp ?? `${overrides.tradeDate}T09:00:00.000Z`,
        overrides.bookingSequence ?? 1,
        snapshotId,
      ],
    );
    return id;
  }

  async function seedDividendEvent(params: {
    ticker: string;
    exDividendDate: string;
    paymentDate: string | null;
    cashDividendPerShare?: number;
  }): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO market_data.dividend_events (
         id, ticker, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, cash_dividend_currency,
         stock_dividend_per_share, source
       ) VALUES ($1, $2, 'CASH', $3::date, $4::date,
                 $5, 'TWD', 0, 'test_seed')`,
      [id, params.ticker, params.exDividendDate, params.paymentDate, params.cashDividendPerShare ?? 10],
    );
    return id;
  }

  async function seedPostedDividend(params: {
    eventId: string;
    receivedCashAmount: number;
    targetAccountId?: string;
    targetUserId?: string;
    supersededAt?: string | null;
    reversalOf?: string | null;
    bookedAt?: string;
  }): Promise<string> {
    const ledgerId = randomUUID();
    await pool.query(
      `INSERT INTO dividend_ledger_entries (
         id, account_id, dividend_event_id, eligible_quantity,
         expected_cash_amount, expected_stock_quantity, received_stock_quantity,
         posting_status, reconciliation_status, version, source_composition_status,
         booked_at, superseded_at, reversal_of_dividend_ledger_entry_id
       ) VALUES ($1, $2, $3, 10,
                 $4, 0, 0,
                 'posted', 'open', 1, 'provided',
                 COALESCE($7::timestamptz, NOW()), $5, $6)`,
      [
        ledgerId,
        params.targetAccountId ?? accountId,
        params.eventId,
        params.receivedCashAmount,
        params.supersededAt ?? null,
        params.reversalOf ?? null,
        params.bookedAt ?? null,
      ],
    );
    if (params.receivedCashAmount > 0) {
      await pool.query(
        `INSERT INTO cash_ledger_entries (
           id, user_id, account_id, entry_date, entry_type, amount, currency,
           related_dividend_ledger_entry_id, source
         ) VALUES ($1, $2, $3, CURRENT_DATE, 'DIVIDEND_RECEIPT', $4, 'TWD', $5, 'test_seed')`,
        [
          randomUUID(),
          params.targetUserId ?? userId,
          params.targetAccountId ?? accountId,
          params.receivedCashAmount,
          ledgerId,
        ],
      );
    }
    return ledgerId;
  }

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    const store = await persistence.loadStore("user-1");
    userId = store.userId;
    accountId = store.accounts[0]!.id;
    feeProfileId = store.accounts[0]!.feeProfileId;
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterEach(async () => {
    await persistence.close();
    await pool.end();
  });

  it("returns trades with BUY/SELL types sourced from trade_events.trade_type", async () => {
    const buyId = await seedTrade({
      ticker: "2330",
      tradeDate: "2026-01-02",
      tradeType: "BUY",
      quantity: 10,
      unitPrice: 600,
      bookingSequence: 1,
      tradeTimestamp: "2026-01-02T09:00:00.000Z",
    });
    const sellId = await seedTrade({
      ticker: "2330",
      tradeDate: "2026-01-05",
      tradeType: "SELL",
      quantity: 4,
      unitPrice: 610,
      bookingSequence: 2,
      tradeTimestamp: "2026-01-05T09:30:00.000Z",
    });
    await pool.query(
      `INSERT INTO lot_allocations (
         id, user_id, account_id, trade_event_id, ticker, lot_id,
         lot_opened_at, lot_opened_sequence, allocated_quantity,
         allocated_cost_amount, cost_currency
       ) VALUES ($1, $2, $3, $4, '2330', $5,
                 '2026-01-02'::date, 1, 4,
                 2400, 'TWD')`,
      [randomUUID(), userId, accountId, sellId, `lot-${buyId}`],
    );

    const inputs = await persistence.getSnapshotGenerationInputs(userId);

    expect(inputs.trades).toHaveLength(2);
    expect(inputs.trades.map((trade) => trade.id)).toEqual([buyId, sellId]);
    expect(inputs.trades[0]!.tradeTimestamp).toBeDefined();
    expect(inputs.trades[0]!.tradeTimestamp?.slice(0, 10)).toBe("2026-01-02");
    const types = inputs.trades.map((t) => t.type).sort();
    expect(types).toEqual(["BUY", "SELL"]);
    for (const trade of inputs.trades) {
      expect(trade.type === "BUY" || trade.type === "SELL").toBe(true);
      expect(trade.accountId).toBe(accountId);
      expect(trade.ticker).toBe("2330");
      expect(typeof trade.quantity).toBe("number");
      expect(typeof trade.unitPrice).toBe("number");
      // KZO-185: `SnapshotTradeInput.marketCode` is now required; the Postgres
      // SELECT projects `trade_events.market_code` → `marketCode`. The seed SQL
      // inserts `'TW'` so this assertion validates end-to-end projection.
      expect(trade.marketCode).toBe("TW");
    }
    expect(inputs.lotAllocations).toEqual([
      expect.objectContaining({
        tradeEventId: sellId,
        allocatedCostAmount: 2400,
        costCurrency: "TWD",
        lotOpenedAt: "2026-01-02",
      }),
    ]);
  });

  it("scopes tenant via accounts.user_id (dividend_ledger_entries has no user_id column)", async () => {
    const mineEventId = await seedDividendEvent({ ticker: "2330", exDividendDate: "2026-02-01", paymentDate: "2026-02-20" });
    await seedPostedDividend({ eventId: mineEventId, receivedCashAmount: 100 });

    // Cross-tenant dividend under a DIFFERENT user/account must not leak into
    // this user's result — validates the accounts.user_id JOIN filter.
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
         VALUES ('user-other', 'other@example.com', 'en', 'WEIGHTED_AVERAGE', 10)`,
    );
    // KZO-183: post-042 schema requires account first (with deferred FK), then
    // fee_profile owned by it. Wrap in a transaction so the deferred FK fires at COMMIT.
    {
      const txClient = await pool.connect();
      try {
        await txClient.query("BEGIN");
        await txClient.query(
          `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
             VALUES ('acc-other', 'user-other', 'Main', 'fp-other', 'TWD', 'broker')`,
        );
        await txClient.query(
          `INSERT INTO fee_profiles (
             id, account_id, name, commission_rate_bps, board_commission_rate,
             commission_discount_percent, commission_discount_bps,
             minimum_commission_amount, commission_currency,
             commission_rounding_mode, tax_rounding_mode,
             stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
             etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps, commission_charge_mode
           ) VALUES ('fp-other', 'acc-other', 'Other Broker', 14, 1.425, 0, 10000,
                     20, 'TWD', 'FLOOR', 'FLOOR', 30, 15, 10, 0, 'CHARGED_UPFRONT')`,
        );
        await txClient.query("COMMIT");
      } catch (err) {
        await txClient.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        txClient.release();
      }
    }
    const otherEventId = await seedDividendEvent({ ticker: "2330", exDividendDate: "2026-02-01", paymentDate: "2026-02-20" });
    await seedPostedDividend({
      eventId: otherEventId,
      receivedCashAmount: 50,
      targetUserId: "user-other",
      targetAccountId: "acc-other",
    });

    const inputs = await persistence.getSnapshotGenerationInputs(userId);

    expect(inputs.postedDividends).toHaveLength(1);
    expect(inputs.postedDividends[0]!.ticker).toBe("2330");
    expect(inputs.postedDividends[0]!.amount).toBe(100);
    expect(inputs.postedDividends[0]!.currency).toBe("TWD");
  });

  it("sources postedDividends.amount from cash_ledger_entries DIVIDEND_RECEIPT (migration 010)", async () => {
    const eventId = await seedDividendEvent({ ticker: "2330", exDividendDate: "2026-02-01", paymentDate: "2026-02-20" });
    await seedPostedDividend({ eventId, receivedCashAmount: 96 });

    const inputs = await persistence.getSnapshotGenerationInputs(userId);

    expect(inputs.postedDividends).toHaveLength(1);
    const posted = inputs.postedDividends[0]!;
    expect(posted.accountId).toBe(accountId);
    expect(posted.ticker).toBe("2330");
    expect(posted.paymentDate).toBe("2026-02-20");
    expect(posted.currency).toBe("TWD");
    // The received_cash_amount column was dropped; the authoritative value is
    // the DIVIDEND_RECEIPT cash ledger sum for the ledger entry.
    expect(posted.amount).toBe(96);
  });

  it("falls back to dividend ledger booked_at when event payment_date is missing", async () => {
    const eventId = await seedDividendEvent({
      ticker: "2330",
      exDividendDate: "2026-02-01",
      paymentDate: null,
    });
    await seedPostedDividend({
      eventId,
      receivedCashAmount: 96,
      bookedAt: "2026-02-21T10:30:00.000Z",
    });

    const inputs = await persistence.getSnapshotGenerationInputs(userId);

    expect(inputs.postedDividends).toHaveLength(1);
    const posted = inputs.postedDividends[0]!;
    expect(posted.accountId).toBe(accountId);
    expect(posted.ticker).toBe("2330");
    expect(posted.paymentDate).toBe("2026-02-21");
    expect(posted.currency).toBe("TWD");
    expect(posted.amount).toBe(96);
  });

  it("joins market_data.dividend_events (schema-qualified in migration 018)", async () => {
    const ev2330 = await seedDividendEvent({ ticker: "2330", exDividendDate: "2026-02-01", paymentDate: "2026-02-20" });
    const ev0050 = await seedDividendEvent({ ticker: "0050", exDividendDate: "2026-03-01", paymentDate: "2026-03-20" });
    await seedPostedDividend({ eventId: ev2330, receivedCashAmount: 100 });
    await seedPostedDividend({ eventId: ev0050, receivedCashAmount: 150 });

    const inputs = await persistence.getSnapshotGenerationInputs(userId, {
      accountId,
      ticker: "0050",
    });

    expect(inputs.postedDividends).toHaveLength(1);
    expect(inputs.postedDividends[0]!.ticker).toBe("0050");
    expect(inputs.postedDividends[0]!.amount).toBe(150);
  });

  it("returns empty postedDividends when dividend ledger entry is superseded", async () => {
    const eventId = await seedDividendEvent({ ticker: "2330", exDividendDate: "2026-02-01", paymentDate: "2026-02-20" });
    await seedPostedDividend({
      eventId,
      receivedCashAmount: 100,
      supersededAt: new Date().toISOString(),
    });

    const inputs = await persistence.getSnapshotGenerationInputs(userId);
    expect(inputs.postedDividends).toHaveLength(0);
  });

  it("returns empty postedDividends when the posted ledger entry is reversed", async () => {
    const eventId = await seedDividendEvent({ ticker: "2330", exDividendDate: "2026-02-01", paymentDate: "2026-02-20" });
    const originalLedgerId = await seedPostedDividend({
      eventId,
      receivedCashAmount: 100,
    });
    await seedPostedDividend({
      eventId,
      receivedCashAmount: 0,
      reversalOf: originalLedgerId,
    });

    const inputs = await persistence.getSnapshotGenerationInputs(userId);
    expect(inputs.postedDividends).toHaveLength(0);
  });

  it("filters out non-posted dividend ledger entries", async () => {
    const eventId = await seedDividendEvent({ ticker: "2330", exDividendDate: "2026-02-01", paymentDate: "2026-02-20" });
    const ledgerId = randomUUID();
    // "expected" status — not yet posted. Receipts don't exist for expected entries.
    await pool.query(
      `INSERT INTO dividend_ledger_entries (
         id, account_id, dividend_event_id, eligible_quantity,
         expected_cash_amount, expected_stock_quantity, received_stock_quantity,
         posting_status, reconciliation_status, version, source_composition_status,
         booked_at
       ) VALUES ($1, $2, $3, 10,
                 100, 0, 0,
                 'expected', 'open', 1, 'provided',
                 NOW())`,
      [ledgerId, accountId, eventId],
    );

    const inputs = await persistence.getSnapshotGenerationInputs(userId);
    expect(inputs.postedDividends).toHaveLength(0);
  });
});
