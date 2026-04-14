import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import {
  dividendEventPayload,
  dividendPostingPayload,
  transactionPayload,
} from "../helpers/fixtures.js";

// ── Postgres integration gate ─────────────────────────────────────────────────
const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

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
  let app: AppInstance;
  let pool: Pool;
  let userId: string;
  let accountId: string;
  let idempotencyCounter = 0;

  async function seedDailyBar(ticker: string, date: string, close: number): Promise<void> {
    await pool.query(
      `INSERT INTO market_data.daily_bars
         (ticker, bar_date, open, high, low, close, volume, source)
       VALUES ($1, $2::date, $3, $3, $3, $3, 1000, 'test_seed')
       ON CONFLICT (ticker, bar_date) DO NOTHING`,
      [ticker, date, close],
    );
  }

  async function createTrade(
    overrides: Parameters<typeof transactionPayload>[0] = {},
  ): Promise<{ id: string; accountId: string; ticker: string }> {
    idempotencyCounter += 1;
    const res = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": `k-snapgen-${idempotencyCounter}` },
      payload: transactionPayload({ accountId, ...overrides }),
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { id: string; accountId: string; ticker: string };
  }

  async function createDividendEvent(
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const id = randomUUID();
    const payload = dividendEventPayload(overrides);
    await pool.query(
      `INSERT INTO market_data.dividend_events (
         id, ticker, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, cash_dividend_currency,
         stock_dividend_per_share, source
       ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, 'test_seed')`,
      [
        id,
        payload.ticker,
        payload.eventType,
        payload.exDividendDate,
        payload.paymentDate,
        payload.cashDividendPerShare,
        payload.cashDividendCurrency,
        payload.stockDividendPerShare,
      ],
    );
    return id;
  }

  async function postDividend(dividendEventId: string, receivedCashAmount: number): Promise<void> {
    idempotencyCounter += 1;
    const res = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": `k-snapgen-div-${idempotencyCounter}` },
      payload: dividendPostingPayload({
        accountId,
        dividendEventId,
        receivedCashAmount,
        deductions: [],
        sourceLines: [
          {
            sourceBucket: "DIVIDEND_INCOME",
            amount: receivedCashAmount,
            currencyCode: "TWD",
            source: "test_seed",
          },
        ],
      }),
    });
    expect(res.statusCode).toBe(200);
  }

  beforeEach(async () => {
    await resetDatabase();
    app = await buildApp({ persistenceBackend: "postgres" });
    const store = await app.persistence.loadStore("user-1");
    userId = store.userId;
    accountId = store.accounts[0]!.id;
    pool = new Pool({ connectionString: databaseUrl });
    idempotencyCounter = 0;
  });

  afterEach(async () => {
    if (app) await app.close();
    if (pool) await pool.end();
  });

  it("returns trades with BUY/SELL types sourced from trade_events.trade_type", async () => {
    await seedDailyBar("2330", "2026-01-02", 600);
    await seedDailyBar("2330", "2026-01-05", 610);

    await createTrade({ ticker: "2330", tradeDate: "2026-01-02", quantity: 10, unitPrice: 600, type: "BUY", commissionAmount: 0, taxAmount: 0 });
    await createTrade({ ticker: "2330", tradeDate: "2026-01-05", quantity: 4, unitPrice: 610, type: "SELL", commissionAmount: 0, taxAmount: 0 });

    const inputs = await (app.persistence as PostgresPersistence).getSnapshotGenerationInputs(userId);

    expect(inputs.trades).toHaveLength(2);
    const types = inputs.trades.map((t) => t.type).sort();
    expect(types).toEqual(["BUY", "SELL"]);
    for (const trade of inputs.trades) {
      expect(trade.type === "BUY" || trade.type === "SELL").toBe(true);
      expect(trade.accountId).toBe(accountId);
      expect(trade.ticker).toBe("2330");
      expect(typeof trade.quantity).toBe("number");
      expect(typeof trade.unitPrice).toBe("number");
    }
  });

  it("scopes tenant via accounts.user_id (dividend_ledger_entries has no user_id column)", async () => {
    await seedDailyBar("2330", "2026-01-02", 600);
    await createTrade({ ticker: "2330", tradeDate: "2026-01-02", quantity: 10, unitPrice: 600, type: "BUY", commissionAmount: 0, taxAmount: 0 });

    const dividendEventId = await createDividendEvent({
      ticker: "2330",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 10,
    });
    await postDividend(dividendEventId, 100);

    // Cross-tenant dividend: different user posting another ticker's dividend
    // must not leak into the user-1 result.
    const otherEventId = await createDividendEvent({
      ticker: "2317",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
    });
    const otherLedgerId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, locale, cost_basis_method, quote_poll_interval_seconds)
         VALUES ('user-other', 'other@example.com', 'en', 'WEIGHTED_AVERAGE', 10)`,
    );
    await pool.query(
      `INSERT INTO fee_profiles (
         id, user_id, name, commission_rate_bps, board_commission_rate, commission_discount_percent, commission_discount_bps,
         minimum_commission_amount, commission_currency, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
         etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps, commission_charge_mode
       ) VALUES ('fp-other', 'user-other', 'Other Broker', 14, 1.425, 0, 10000,
                 20, 'TWD', 'FLOOR', 'FLOOR', 30, 15, 10, 0, 'CHARGED_UPFRONT')`,
    );
    await pool.query(
      `INSERT INTO accounts (id, user_id, name, fee_profile_id)
         VALUES ('acc-other', 'user-other', 'Main', 'fp-other')`,
    );
    await pool.query(
      `INSERT INTO dividend_ledger_entries (
         id, account_id, dividend_event_id, eligible_quantity,
         expected_cash_amount, expected_stock_quantity, received_stock_quantity,
         posting_status, reconciliation_status, version, source_composition_status,
         booked_at
       ) VALUES ($1, 'acc-other', $2, 10,
                 50, 0, 0,
                 'posted', 'open', 1, 'provided',
                 NOW())`,
      [otherLedgerId, otherEventId],
    );
    await pool.query(
      `INSERT INTO cash_ledger_entries (
         id, user_id, account_id, entry_date, entry_type, amount, currency,
         related_dividend_ledger_entry_id, source
       ) VALUES ($1, 'user-other', 'acc-other', CURRENT_DATE, 'DIVIDEND_RECEIPT', 50, 'TWD', $2, 'test_seed')`,
      [randomUUID(), otherLedgerId],
    );

    const inputs = await (app.persistence as PostgresPersistence).getSnapshotGenerationInputs(userId);

    expect(inputs.postedDividends).toHaveLength(1);
    expect(inputs.postedDividends[0]!.ticker).toBe("2330");
    expect(inputs.postedDividends[0]!.amount).toBe(100);
  });

  it("sources postedDividends.amount from cash_ledger_entries DIVIDEND_RECEIPT (migration 010)", async () => {
    await seedDailyBar("2330", "2026-01-02", 600);
    await createTrade({ ticker: "2330", tradeDate: "2026-01-02", quantity: 10, unitPrice: 600, type: "BUY", commissionAmount: 0, taxAmount: 0 });

    const dividendEventId = await createDividendEvent({
      ticker: "2330",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 10,
    });
    await postDividend(dividendEventId, 96);

    const inputs = await (app.persistence as PostgresPersistence).getSnapshotGenerationInputs(userId);

    expect(inputs.postedDividends).toHaveLength(1);
    const posted = inputs.postedDividends[0]!;
    expect(posted.accountId).toBe(accountId);
    expect(posted.ticker).toBe("2330");
    expect(posted.paymentDate).toBe("2026-02-20");
    // The received_cash_amount column was dropped; the authoritative value is
    // the DIVIDEND_RECEIPT cash ledger sum for the ledger entry.
    expect(posted.amount).toBe(96);
  });

  it("joins market_data.dividend_events (schema-qualified in migration 018)", async () => {
    await seedDailyBar("2330", "2026-01-02", 600);
    await seedDailyBar("0050", "2026-01-02", 120);
    await createTrade({ ticker: "2330", tradeDate: "2026-01-02", quantity: 10, unitPrice: 600, type: "BUY", commissionAmount: 0, taxAmount: 0 });
    await createTrade({ ticker: "0050", tradeDate: "2026-01-02", quantity: 50, unitPrice: 120, type: "BUY", commissionAmount: 0, taxAmount: 0 });

    const div2330 = await createDividendEvent({ ticker: "2330", exDividendDate: "2026-02-01", paymentDate: "2026-02-20", cashDividendPerShare: 10 });
    const div0050 = await createDividendEvent({ ticker: "0050", exDividendDate: "2026-03-01", paymentDate: "2026-03-20", cashDividendPerShare: 3 });
    await postDividend(div2330, 100);
    await postDividend(div0050, 150);

    const inputs = await (app.persistence as PostgresPersistence).getSnapshotGenerationInputs(userId, {
      accountId,
      ticker: "0050",
    });

    expect(inputs.postedDividends).toHaveLength(1);
    expect(inputs.postedDividends[0]!.ticker).toBe("0050");
    expect(inputs.postedDividends[0]!.amount).toBe(150);
    // Scoped: only trades for 0050 return
    expect(inputs.trades.every((t) => t.ticker === "0050")).toBe(true);
  });

  it("returns empty postedDividends when dividend ledger entry is superseded or reversed", async () => {
    await seedDailyBar("2330", "2026-01-02", 600);
    await createTrade({ ticker: "2330", tradeDate: "2026-01-02", quantity: 10, unitPrice: 600, type: "BUY", commissionAmount: 0, taxAmount: 0 });

    const dividendEventId = await createDividendEvent({
      ticker: "2330",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 10,
    });
    await postDividend(dividendEventId, 100);

    // Mark the just-created ledger entry as superseded.
    await pool.query(
      `UPDATE dividend_ledger_entries SET superseded_at = NOW() WHERE dividend_event_id = $1`,
      [dividendEventId],
    );

    const inputs = await (app.persistence as PostgresPersistence).getSnapshotGenerationInputs(userId);
    expect(inputs.postedDividends).toHaveLength(0);
  });
});
