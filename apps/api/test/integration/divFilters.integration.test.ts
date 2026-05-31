import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
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

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

/**
 * Tests (a)–(e): Exercise the new SQL WHERE clauses in PostgresPersistence.
 *
 * We use PostgresPersistence directly (not buildApp) because:
 * 1. buildApp reads REDIS_URL from Env, which is not set by the CI managed
 *    stack — only POSTGRES_TEST_REDIS_URL is set.
 * 2. buildApp's default accountId ("acc-1") doesn't match the postgres
 *    backend's convention ("user-1-acc-1"), so fixture-driven HTTP seeding
 *    would fail with 404.
 *
 * Directly calling listDividendLedgerEntries covers the same
 * SQL clauses that the route handler exercises.
 */
describePostgres("listDividendLedgerEntries — reconciliationStatus + postingStatus SQL filters", () => {
  let persistence: PostgresPersistence;
  let pool: Pool;
  let userId: string;
  let accountId: string;

  beforeEach(async () => {
    await resetDatabase();

    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init(); // runs migrations (incl. 027)

    // loadStore triggers ensureDefaultPortfolioData which creates:
    //   users.id = "user-1"
    //   accounts.id = "user-1-acc-1" (user_id = "user-1")
    const store = await persistence.loadStore("user-1");
    userId = store.userId;
    accountId = store.accounts[0]!.id; // "user-1-acc-1"

    pool = new Pool({ connectionString: databaseUrl });
  });

  afterEach(async () => {
    await persistence.close();
    await pool.end();
  });

  /**
   * Inserts a row into market_data.dividend_events and returns the generated id.
   */
  async function insertDividendEvent(exDivDate: string, payDate: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO market_data.dividend_events
         (id, ticker, event_type, ex_dividend_date, payment_date,
          cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share,
          source)
       VALUES ($1, '2330', 'CASH', $2, $3, 12, 'TWD', 0, 'test_seed')`,
      [id, exDivDate, payDate],
    );
    return id;
  }

  /**
   * Inserts a dividend_ledger_entry row directly — bypasses the service layer so
   * we can control the exact posting_status × reconciliation_status combination.
   * Migration 027's CHECK constraint still validates the pair at the DB level.
   */
  async function insertLedgerEntry(
    eventId: string,
    postingStatus: string,
    reconciliationStatus: string,
  ): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO dividend_ledger_entries
         (id, account_id, dividend_event_id, eligible_quantity,
          expected_cash_amount, expected_stock_quantity, received_stock_quantity,
          posting_status, reconciliation_status, version,
          source_composition_status, booked_at)
       VALUES ($1, $2, $3, 10,
               120, 0, 0,
               $4, $5, 1,
               'unknown_pending_disclosure', NOW())`,
      [id, accountId, eventId, postingStatus, reconciliationStatus],
    );
    return id;
  }

  /**
   * Seeds all four posting×reconciliation buckets.
   *
   * Bucket 1: expected + open  (coupling invariant: expected MUST be open)
   * Bucket 2: posted  + open
   * Bucket 3: posted  + matched
   * Bucket 4: posted  + explained
   *
   * Four distinct dividend events are required so each ledger entry has a unique
   * (account_id, dividend_event_id) key — enforced by ux_dividend_ledger_entries_active_account_event.
   */
  async function seedAllBuckets(): Promise<void> {
    const ev1 = await insertDividendEvent("2026-02-01", "2026-02-28");
    const ev2 = await insertDividendEvent("2026-03-01", "2026-03-28");
    const ev3 = await insertDividendEvent("2026-04-01", "2026-04-28");
    const ev4 = await insertDividendEvent("2026-05-01", "2026-05-28");

    await insertLedgerEntry(ev1, "expected", "open");
    await insertLedgerEntry(ev2, "posted", "open");
    await insertLedgerEntry(ev3, "posted", "matched");
    await insertLedgerEntry(ev4, "posted", "explained");
  }

  const baseListOpts = {
    page: 1 as const,
    limit: 500 as const,
    sortBy: "paymentDate" as const,
    sortOrder: "desc" as const,
  };

  it("(a): reconciliationStatus=open → returns expected+open and posted+open; excludes matched and explained", async () => {
    await seedAllBuckets();

    const result = await persistence.listDividendLedgerEntries(userId, {
      ...baseListOpts,
      reconciliationStatus: "open",
    });
    const entries = result.ledgerEntries;

    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.reconciliationStatus).toBe("open");
    }
    const postingStatuses = entries.map((e) => e.postingStatus);
    expect(postingStatuses).toContain("expected");
    expect(postingStatuses).toContain("posted");
  });

  it("(b): reconciliationStatus=matched → returns only the matched entry", async () => {
    await seedAllBuckets();

    const result = await persistence.listDividendLedgerEntries(userId, {
      ...baseListOpts,
      reconciliationStatus: "matched",
    });
    const entries = result.ledgerEntries;

    expect(entries).toHaveLength(1);
    expect(entries[0]!.reconciliationStatus).toBe("matched");
    expect(entries[0]!.postingStatus).toBe("posted");
  });

  it("(c): postingStatus=posted → returns three posted entries; excludes expected+open", async () => {
    await seedAllBuckets();

    const result = await persistence.listDividendLedgerEntries(userId, {
      ...baseListOpts,
      postingStatus: "posted",
    });
    const entries = result.ledgerEntries;

    expect(entries).toHaveLength(3);
    for (const e of entries) {
      expect(e.postingStatus).toBe("posted");
    }
    const reconStatuses = entries.map((e) => e.reconciliationStatus);
    expect(reconStatuses).toContain("open");
    expect(reconStatuses).toContain("matched");
    expect(reconStatuses).toContain("explained");
  });

  it("(d): reconciliationStatus=open + postingStatus=posted → intersection is posted+open only; expected+open excluded", async () => {
    await seedAllBuckets();

    const result = await persistence.listDividendLedgerEntries(userId, {
      ...baseListOpts,
      reconciliationStatus: "open",
      postingStatus: "posted",
    });
    const entries = result.ledgerEntries;

    expect(entries).toHaveLength(1);
    expect(entries[0]!.reconciliationStatus).toBe("open");
    expect(entries[0]!.postingStatus).toBe("posted");
  });

  it("(e): filter returning no matches → empty array", async () => {
    // Seed only posted+open; 'resolved' matches nothing
    const ev = await insertDividendEvent("2026-02-01", "2026-02-28");
    await insertLedgerEntry(ev, "posted", "open");

    const result = await persistence.listDividendLedgerEntries(userId, {
      ...baseListOpts,
      reconciliationStatus: "resolved",
    });
    const entries = result.ledgerEntries;

    expect(entries).toHaveLength(0);
  });

  it("(g): ck_dividend_ledger_entries_reconciliation_coupling rejects expected+matched with pg error 23514", async () => {
    const ev = await insertDividendEvent("2026-06-01", "2026-06-28");
    const id = randomUUID();

    // expected posting_status MUST pair with open reconciliation_status only.
    // Attempting expected+matched violates the CHECK constraint.
    await expect(
      pool.query(
        `INSERT INTO dividend_ledger_entries
           (id, account_id, dividend_event_id, eligible_quantity,
            expected_cash_amount, expected_stock_quantity, received_stock_quantity,
            posting_status, reconciliation_status, version,
            source_composition_status, booked_at)
         VALUES ($1, $2, $3, 10,
                 120, 0, 0,
                 'expected', 'matched', 1,
                 'unknown_pending_disclosure', NOW())`,
        [id, accountId, ev],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

/**
 * Test (f): Verify the route rejects unknown enum values with 400.
 *
 * Schema validation is backend-agnostic (Zod rejects the value before the
 * persistence layer is called), so memory backend is fine here.
 */
describe("GET /portfolio/dividends/ledger — schema validation", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("(f): invalid reconciliationStatus enum value → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?reconciliationStatus=invalid",
    });
    expect(res.statusCode).toBe(400);
  });

  // ── KZO-135 schema validation (pagination, sort) ──────────────────────────

  it("KZO-135: limit greater than 500 → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?limit=501",
    });
    expect(res.statusCode).toBe(400);
  });

  it("KZO-135: limit equal to 500 is accepted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?limit=500",
    });
    expect(res.statusCode).toBe(200);
  });

  it("KZO-135: sortBy not in allowlist → 400 (SQL injection payload blocked)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?sortBy=DROP_TABLE",
    });
    expect(res.statusCode).toBe(400);
  });

  it("KZO-135: sortBy=unknownColumn → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?sortBy=unknownColumn",
    });
    expect(res.statusCode).toBe(400);
  });

  it("KZO-135: sortOrder not in enum → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?sortOrder=random",
    });
    expect(res.statusCode).toBe(400);
  });

  it("KZO-135: negative page → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?page=-1",
    });
    expect(res.statusCode).toBe(400);
  });

  it("KZO-135: page=0 → 400 (page is 1-indexed)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?page=0",
    });
    expect(res.statusCode).toBe(400);
  });

  it("KZO-135: limit=0 → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?limit=0",
    });
    expect(res.statusCode).toBe(400);
  });

  it("KZO-135: negative limit → 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?limit=-5",
    });
    expect(res.statusCode).toBe(400);
  });
});

// KZO-135 behavioral coverage lives in:
//   - apps/api/test/unit/dividendLedgerPagination.test.ts (memory-backed)
//   - apps/api/test/integration/dividendLedgerPagination.integration.test.ts (postgres-backed)
