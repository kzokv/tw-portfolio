import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

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

describePostgres("PostgresPersistence.listDividendCalendarSnapshot", () => {
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
  });

  afterEach(async () => {
    await persistence.close();
    await pool.end();
  });

  async function insertDividendEvent(
    paymentDate: string | null,
    exDividendDate: string,
    overrides: {
      ticker?: string;
      marketCode?: string;
      cashDividendCurrency?: string;
    } = {},
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO market_data.dividend_events
         (id, ticker, market_code, event_type, ex_dividend_date, payment_date,
          cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share, source)
       VALUES ($1, $2, $3, 'CASH', $4, $5, 1, $6, 0, 'test_seed')`,
      [
        id,
        overrides.ticker ?? "2330",
        overrides.marketCode ?? "TW",
        exDividendDate,
        paymentDate,
        overrides.cashDividendCurrency ?? "TWD",
      ],
    );
    return id;
  }

  async function insertLedgerEntry(eventId: string, expectedCashAmount: number): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO dividend_ledger_entries
         (id, account_id, dividend_event_id, eligible_quantity,
          expected_cash_amount, expected_stock_quantity, received_stock_quantity,
          posting_status, reconciliation_status, version,
          source_composition_status, booked_at)
       VALUES ($1, $2, $3, 10,
               $4, 0, 0,
               'posted', 'open', 1,
               'provided', NOW())`,
      [id, accountId, eventId, expectedCashAmount],
    );
    return id;
  }

  async function insertTrade(params: {
    tradeDate: string;
    ticker?: string;
    marketCode?: string;
    priceCurrency?: string;
    quantity?: number;
    reversalOf?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    const bookedAt = `${params.tradeDate}T00:00:00.000Z`;
    const feePolicySnapshotId = `calendar-snapshot-fee:${id}`;
    await pool.query(
      `INSERT INTO trade_fee_policy_snapshots (
         id, user_id, profile_id_at_booking, profile_name_at_booking, board_commission_rate,
         commission_discount_percent, minimum_commission_amount, commission_currency,
         commission_rounding_mode, tax_rounding_mode, stock_sell_tax_rate_bps,
         stock_day_trade_tax_rate_bps, etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
         commission_charge_mode, booked_at
       ) VALUES (
         $1, $2, 'fp-default', 'Default Broker', 1.425,
         0, 20, $3,
         'FLOOR', 'FLOOR', 30,
         15, 10, 0,
         'CHARGED_UPFRONT', $4
       )`,
      [feePolicySnapshotId, userId, params.priceCurrency ?? "TWD", bookedAt],
    );
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, ticker, market_code, instrument_type, trade_type,
         quantity, unit_price, price_currency, trade_date, trade_timestamp, booking_sequence,
         commission_amount, tax_amount, is_day_trade, fee_policy_snapshot_id,
         source, source_reference, booked_at, reversal_of_trade_event_id
       ) VALUES (
         $1, $2, $3, $4, $5, 'STOCK', 'BUY',
         $6, 100, $7, $8, $9, 1,
         0, 0, false, $10,
         'test_seed', $1, $9, $11
       )`,
      [
        id,
        userId,
        accountId,
        params.ticker ?? "2330",
        params.marketCode ?? "TW",
        params.quantity ?? 10,
        params.priceCurrency ?? "TWD",
        params.tradeDate,
        bookedAt,
        feePolicySnapshotId,
        params.reversalOf ?? null,
      ],
    );
    return id;
  }

  async function seedSnapshotFixture(): Promise<{
    januaryEventId: string;
    januaryLedgerId: string;
    aprilEventId: string;
    aprilLedgerId: string;
  }> {
    const januaryEventId = await insertDividendEvent("2026-01-20", "2026-01-10");
    const aprilEventId = await insertDividendEvent("2026-04-20", "2026-04-10");
    const tbdEventId = await insertDividendEvent(null, "2026-03-10");
    const mayEventId = await insertDividendEvent("2026-05-20", "2026-05-10");

    const januaryLedgerId = await insertLedgerEntry(januaryEventId, 100);
    const aprilLedgerId = await insertLedgerEntry(aprilEventId, 110);
    await insertLedgerEntry(tbdEventId, 90);
    await insertLedgerEntry(mayEventId, 120);

    return { januaryEventId, januaryLedgerId, aprilEventId, aprilLedgerId };
  }

  it("returns only paid January 2026 rows and excludes unrelated TBD entries", async () => {
    const fixture = await seedSnapshotFixture();

    const snapshot = await persistence.listDividendCalendarSnapshot(userId, {
      fromPaymentDate: "2026-01-01",
      toPaymentDate: "2026-01-31",
      limit: 20,
    });

    expect(snapshot.dividendEvents.map((event) => event.id)).toEqual([fixture.januaryEventId]);
    expect(snapshot.dividendEvents.map((event) => event.paymentDate)).toEqual(["2026-01-20"]);
    expect(snapshot.ledgerEntries.map((entry) => entry.id)).toEqual([fixture.januaryLedgerId]);
    expect(snapshot.ledgerEntries.every((entry) => entry.dividendEventId === fixture.januaryEventId)).toBe(true);
  });

  it("returns only paid April 2026 rows and excludes unrelated TBD entries", async () => {
    const fixture = await seedSnapshotFixture();

    const snapshot = await persistence.listDividendCalendarSnapshot(userId, {
      fromPaymentDate: "2026-04-01",
      toPaymentDate: "2026-04-30",
      limit: 20,
    });

    expect(snapshot.dividendEvents.map((event) => event.id)).toEqual([fixture.aprilEventId]);
    expect(snapshot.dividendEvents.map((event) => event.paymentDate)).toEqual(["2026-04-20"]);
    expect(snapshot.ledgerEntries.map((entry) => entry.id)).toEqual([fixture.aprilLedgerId]);
    expect(snapshot.ledgerEntries.every((entry) => entry.dividendEventId === fixture.aprilEventId)).toBe(true);
  });

  it("excludes reversed trade pairs from the snapshot trade context", async () => {
    const eventId = await insertDividendEvent("2026-01-20", "2026-01-10");
    const originalTradeId = await insertTrade({ tradeDate: "2026-01-05" });
    await insertTrade({ tradeDate: "2026-01-05", reversalOf: originalTradeId });

    const snapshot = await persistence.listDividendCalendarSnapshot(userId, {
      fromPaymentDate: "2026-01-01",
      toPaymentDate: "2026-01-31",
      limit: 20,
    });

    expect(snapshot.dividendEvents.map((event) => event.id)).toEqual([eventId]);
    expect(snapshot.tradeEvents).toEqual([]);
  });

  it("applies account eligibility before limiting snapshot events", async () => {
    await insertDividendEvent("2026-01-05", "2026-01-02", { ticker: "1111" });
    await insertDividendEvent("2026-01-06", "2026-01-03", { ticker: "2222" });
    const heldEventId = await insertDividendEvent("2026-01-07", "2026-01-04", { ticker: "2330" });
    await insertTrade({ tradeDate: "2026-01-01", ticker: "2330" });

    const snapshot = await persistence.listDividendCalendarSnapshot(userId, {
      accountId,
      fromPaymentDate: "2026-01-01",
      toPaymentDate: "2026-01-31",
      limit: 2,
    });

    expect(snapshot.dividendEvents.map((event) => event.id)).toEqual([heldEventId]);
    expect(snapshot.tradeEvents.map((event) => event.ticker)).toEqual(["2330"]);
  });

  it("applies all-account eligibility before limiting snapshot events", async () => {
    await insertDividendEvent("2026-02-05", "2026-02-02", { ticker: "1111" });
    await insertDividendEvent("2026-02-06", "2026-02-03", { ticker: "2222" });
    const heldEventId = await insertDividendEvent("2026-02-07", "2026-02-04", { ticker: "2330" });
    await insertTrade({ tradeDate: "2026-02-01", ticker: "2330" });

    const snapshot = await persistence.listDividendCalendarSnapshot(userId, {
      fromPaymentDate: "2026-02-01",
      toPaymentDate: "2026-02-28",
      limit: 2,
    });

    expect(snapshot.dividendEvents.map((event) => event.id)).toEqual([heldEventId]);
    expect(snapshot.tradeEvents.map((event) => event.ticker)).toEqual(["2330"]);
  });
});
