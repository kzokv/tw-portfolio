import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { upsertDividendEvents } from "../../src/services/market-data/upserts.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:ci:host or npm run test:integration:ci:container so the DB/Redis stack is managed automatically.",
  );
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

describePostgres("dividend enrichment columns", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });

    // Reset DB so init() runs all migrations fresh
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");
    } finally {
      client.release();
    }

    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("upsertDividendEvents writes normalized provider metadata columns", async () => {
    const rawData = { stock_id: "2330", year: "2024", CashEarningsDistribution: 2.5, extra: true };
    const count = await upsertDividendEvents(pool, [
      {
        ticker: "2330",
        marketCode: "TW",
        exDividendDate: "2025-06-15",
        paymentDate: "2025-07-15",
        cashDividendPerShare: 2.5,
        stockDividendPerShare: 0.5,
        fiscalYearPeriod: "2024",
        announcementDate: "2025-05-01",
        totalDistributionShares: 25933632588,
        rawProviderData: rawData,
        stockDistributionAmountRaw: 0.5,
        stockProviderValue: 0.5,
        stockProviderValueUnit: "TWD_PER_SHARE",
        stockProviderSource: "finmind",
        stockProviderDataset: "TaiwanStockDividend",
        stockProviderAuthoritativeRatio: null,
      },
    ]);
    expect(count).toBe(1);

    // Verify JSONB contents via raw SQL — cast DATE to TEXT to avoid JS timezone issues
    const { rows } = await pool.query(
      `SELECT fiscal_year_period, announcement_date::text, total_distribution_shares, raw_provider_data,
              stock_distribution_amount_raw, stock_provider_value, stock_provider_value_unit,
              stock_provider_source, stock_provider_dataset, stock_provider_authoritative_ratio
       FROM market_data.dividend_events
       WHERE ticker = '2330' AND ex_dividend_date = '2025-06-15'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].fiscal_year_period).toBe("2024");
    expect(rows[0].announcement_date).toBe("2025-05-01");
    expect(Number(rows[0].total_distribution_shares)).toBe(25933632588);
    expect(rows[0].raw_provider_data).toEqual(rawData);
    expect(String(rows[0].stock_distribution_amount_raw)).toBe("0.500000");
    expect(String(rows[0].stock_provider_value)).toBe("0.500000000000");
    expect(rows[0].stock_provider_value_unit).toBe("TWD_PER_SHARE");
    expect(rows[0].stock_provider_source).toBe("finmind");
    expect(rows[0].stock_provider_dataset).toBe("TaiwanStockDividend");
    expect(rows[0].stock_provider_authoritative_ratio).toBeNull();
  });

  it("upsertDividendEvents with null enrichment columns", async () => {
    const count = await upsertDividendEvents(pool, [
      {
        ticker: "0050",
        marketCode: "TW",
        exDividendDate: "2025-06-15",
        paymentDate: "2025-07-15",
        cashDividendPerShare: 1.0,
        stockDividendPerShare: 0,
      },
    ]);
    expect(count).toBe(1);

    const { rows } = await pool.query(
      `SELECT fiscal_year_period, announcement_date, total_distribution_shares, raw_provider_data
       FROM market_data.dividend_events
       WHERE ticker = '0050'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].fiscal_year_period).toBeNull();
    expect(rows[0].announcement_date).toBeNull();
    expect(rows[0].total_distribution_shares).toBeNull();
    expect(rows[0].raw_provider_data).toBeNull();
  });

  it("upsert replaces raw_provider_data on conflict", async () => {
    await upsertDividendEvents(pool, [
      {
        ticker: "2330",
        marketCode: "TW",
        exDividendDate: "2025-06-15",
        paymentDate: "2025-07-15",
        cashDividendPerShare: 2.5,
        stockDividendPerShare: 0.5,
        rawProviderData: { version: 1 },
        stockDistributionAmountRaw: 0.5,
        stockProviderValue: 0.5,
        stockProviderValueUnit: "TWD_PER_SHARE",
        stockProviderSource: "finmind",
        stockProviderDataset: "TaiwanStockDividend",
      },
    ]);

    await upsertDividendEvents(pool, [
      {
        ticker: "2330",
        marketCode: "TW",
        exDividendDate: "2025-06-15",
        paymentDate: "2025-07-15",
        cashDividendPerShare: 2.5,
        stockDividendPerShare: 0.75,
        rawProviderData: { version: 2, newField: true },
        stockDistributionAmountRaw: 0.75,
        stockProviderValue: 0.75,
        stockProviderValueUnit: "TWD_PER_SHARE",
        stockProviderSource: "finmind",
        stockProviderDataset: "TaiwanStockDividend",
      },
    ]);

    const { rows } = await pool.query(
      `SELECT raw_provider_data, stock_provider_value FROM market_data.dividend_events WHERE ticker = '2330'`,
    );
    expect(rows[0].raw_provider_data).toEqual({ version: 2, newField: true });
    expect(String(rows[0].stock_provider_value)).toBe("0.750000000000");
  });

  it("upsertDividendEvents deduplicates batch entries with the same derived key", async () => {
    // FinMind returns multiple rows for the same ticker+exDate+eventType for ETFs
    // like 00878. Without deduplication, PostgreSQL rejects the batch with error 21000
    // ("duplicate constrained values within the same INSERT").
    const count = await upsertDividendEvents(pool, [
      {
        ticker: "00878",
        marketCode: "TW",
        exDividendDate: "2025-01-20",
        paymentDate: "2025-02-25",
        cashDividendPerShare: 0.235,
        stockDividendPerShare: 0,
        fiscalYearPeriod: "2024Q4",
        rawProviderData: { row: 1 },
      },
      {
        ticker: "00878",
        marketCode: "TW",
        exDividendDate: "2025-01-20",
        paymentDate: "2025-02-25",
        cashDividendPerShare: 0.235,
        stockDividendPerShare: 0,
        fiscalYearPeriod: "2024Q4",
        rawProviderData: { row: 2 },
      },
    ]);
    // Both map to id "finmind:00878:2025-01-20:CASH" — last-write-wins dedup
    expect(count).toBe(1);

    const { rows } = await pool.query(
      `SELECT raw_provider_data FROM market_data.dividend_events
       WHERE ticker = '00878' AND ex_dividend_date = '2025-01-20'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].raw_provider_data).toEqual({ row: 2 });
  });

  it("loadStore returns 3 new optional fields on DividendEvent", async () => {
    await upsertDividendEvents(pool, [
      {
        ticker: "2330",
        marketCode: "TW",
        exDividendDate: "2025-06-15",
        paymentDate: "2025-07-15",
        cashDividendPerShare: 2.5,
        stockDividendPerShare: 0,
        fiscalYearPeriod: "2024",
        announcementDate: "2025-05-01",
        totalDistributionShares: 25933632588,
        rawProviderData: { ignored: "by loadStore" },
      },
    ]);

    // Create a user so loadStore works
    await persistence!.resolveOrCreateUser("google", "test-sub", {
      email: "test@example.com",
      name: "Test User",
    });

    // resolveOrCreateUser returns the userId — but we need to find it
    const userResult = await pool.query<{ id: string }>("SELECT id FROM users LIMIT 1");
    const userId = userResult.rows[0].id;

    const store = await persistence!.loadStore(userId);
    const enriched = store.marketData.dividendEvents.find((e) => e.ticker === "2330");

    expect(enriched).toBeDefined();
    expect(enriched!.fiscalYearPeriod).toBe("2024");
    expect(enriched!.announcementDate).toBe("2025-05-01");
    expect(enriched!.totalDistributionShares).toBe(25933632588);
    // rawProviderData is NOT on DividendEvent (skip in loadStore)
    expect((enriched as unknown as Record<string, unknown>).rawProviderData).toBeUndefined();
  });
});
