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

  async function insertDividendEvent(paymentDate: string | null, exDividendDate: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO market_data.dividend_events
         (id, ticker, market_code, event_type, ex_dividend_date, payment_date,
          cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share, source)
       VALUES ($1, '2330', 'TW', 'CASH', $2, $3, 1, 'TWD', 0, 'test_seed')`,
      [id, exDividendDate, paymentDate],
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
});
