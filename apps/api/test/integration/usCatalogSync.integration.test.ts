/**
 * KZO-170 (D5 + D2 delisting fix) — US catalog sync persistence.
 *
 * Two assertions:
 *   1. `upsertInstrumentCatalog(catalog, [], "US")` stamps `market_code='US'`
 *      on every row (replacing the legacy hardcoded `'TW'` at postgres.ts:6025).
 *   2. The delisting `UPDATE` is market-scoped — given the same ticker on TW
 *      AND US, delisting `{ ticker, marketCode: "US" }` must touch ONLY the
 *      US row's `delisted_at`. (Pre-KZO-170 the WHERE clause was
 *      `WHERE ticker = $1 AND delisted_at IS NULL`, which would corrupt
 *      cross-market data once the catalog gained US entries.)
 *
 * Per `.claude/rules/integration-test-persistence-direct.md`:
 *   - PostgresPersistence directly (no buildApp).
 *   - applyNumberedMigrations + scoped pool.
 *   - Schema-qualify market_data.* in raw SQL.
 *   - `ON CONFLICT DO UPDATE` for rows pre-seeded by init().
 *   - Seed real users for any path that writes audit_log (this test does not
 *     touch audit_log, but the persistence init expects a seedable users table).
 *
 * Reserved US tickers per scope-todo D8: AAPL / VOO / MSFT / BND.
 *
 * Pattern mirror: apps/api/test/integration/catalogSync.integration.test.ts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import type { CatalogInstrument, DelistingRecord } from "../../src/persistence/types.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("US catalog sync — upsertInstrumentCatalog with marketCode='US' (KZO-170 D5)", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

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
        const migrationSql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(migrationSql);
      }
    } finally {
      client.release();
    }
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
  });

  afterEach(async () => {
    if (persistence) await persistence.close();
    await pool.end();
  });

  // KZO-170: Reserved US tickers per D8. The architect locked the per-row
  // `CatalogInstrument.marketCode` shape (NOT a 3rd-arg `marketCode` parameter
  // on `upsertInstrumentCatalog`). Each row carries its market explicitly.
  const usCatalog: CatalogInstrument[] = [
    { ticker: "AAPL", name: "Apple Inc.", typeRaw: "twse-ish-or-us", industryCategoryRaw: "Technology", finmindDate: "2026-04-30", instrumentType: "STOCK", marketCode: "US" },
    { ticker: "VOO", name: "Vanguard S&P 500 ETF", typeRaw: "us-etf", industryCategoryRaw: "ETF", finmindDate: "2026-04-30", instrumentType: "ETF", marketCode: "US" },
    { ticker: "MSFT", name: "Microsoft Corporation", typeRaw: "us", industryCategoryRaw: "Software", finmindDate: "2026-04-30", instrumentType: "STOCK", marketCode: "US" },
    { ticker: "BND", name: "Vanguard Total Bond Market ETF", typeRaw: "us-etf", industryCategoryRaw: "Bond ETF", finmindDate: "2026-04-30", instrumentType: "BOND_ETF", marketCode: "US" },
  ];

  it("stamps market_code='US' on every row when each CatalogInstrument carries marketCode='US'", async () => {
    // Act — KZO-170 threads `marketCode` per-row on `CatalogInstrument`. The
    // persistence layer reads each row's `marketCode` and INSERTs into
    // `market_data.instruments.market_code`.
    const result = await persistence!.upsertInstrumentCatalog(usCatalog, []);
    expect(result.upserted).toBeGreaterThanOrEqual(4);

    // Assert — every reserved US ticker stored with market_code='US'.
    const rows = await pool.query<{ ticker: string; market_code: string; instrument_type: string }>(
      `SELECT ticker, market_code, instrument_type
         FROM market_data.instruments
         WHERE ticker = ANY($1::text[]) AND market_code = 'US'
         ORDER BY ticker`,
      [["AAPL", "VOO", "MSFT", "BND"]],
    );
    expect(rows.rows.map((r) => r.ticker).sort()).toEqual(["AAPL", "BND", "MSFT", "VOO"]);
    for (const row of rows.rows) {
      expect(row.market_code).toBe("US");
    }
  });

  it("does NOT stamp TW on US-market instruments (regression guard for the legacy hardcode)", async () => {
    await persistence!.upsertInstrumentCatalog(usCatalog, []);

    // The legacy code at postgres.ts:6025 was
    //   array_fill('TW'::text, ARRAY[$7::int])
    // which would write TW on every row regardless of provider. Confirm no
    // TW row exists for our reserved US tickers.
    const twRows = await pool.query<{ ticker: string }>(
      `SELECT ticker FROM market_data.instruments
         WHERE ticker = ANY($1::text[]) AND market_code = 'TW'`,
      [["AAPL", "VOO", "MSFT", "BND"]],
    );
    expect(twRows.rows).toHaveLength(0);
  });

  it("AAPL on TW and AAPL on US are independent rows after both upserts (composite PK)", async () => {
    // Seed AAPL under TW first (mock cross-listing scenario).
    const twAapl: CatalogInstrument[] = [
      { ticker: "AAPL", name: "AAPL/TW", typeRaw: "twse", industryCategoryRaw: "stub", finmindDate: "2026-04-30", instrumentType: "STOCK", marketCode: "TW" },
    ];
    await persistence!.upsertInstrumentCatalog(twAapl, []);

    // Now seed AAPL under US.
    await persistence!.upsertInstrumentCatalog(
      [{ ticker: "AAPL", name: "Apple Inc.", typeRaw: "us", industryCategoryRaw: "Technology", finmindDate: "2026-04-30", instrumentType: "STOCK", marketCode: "US" }],
      [],
    );

    // Both rows must exist independently.
    const result = await pool.query<{ market_code: string; name: string }>(
      `SELECT market_code, name FROM market_data.instruments
         WHERE ticker = 'AAPL'
         ORDER BY market_code`,
    );
    expect(result.rows.map((r) => r.market_code)).toEqual(["TW", "US"]);
    expect(result.rows.find((r) => r.market_code === "TW")!.name).toBe("AAPL/TW");
    expect(result.rows.find((r) => r.market_code === "US")!.name).toBe("Apple Inc.");
  });

  it("delisting UPDATE is market-scoped — only the US row gets delisted_at, TW row preserved", async () => {
    // Seed AAPL under both TW and US.
    await persistence!.upsertInstrumentCatalog(
      [{ ticker: "AAPL", name: "AAPL/TW", typeRaw: "twse", industryCategoryRaw: "stub", finmindDate: "2026-04-30", instrumentType: "STOCK", marketCode: "TW" }],
      [],
    );
    await persistence!.upsertInstrumentCatalog(
      [{ ticker: "AAPL", name: "Apple Inc.", typeRaw: "us", industryCategoryRaw: "Technology", finmindDate: "2026-04-30", instrumentType: "STOCK", marketCode: "US" }],
      [],
    );

    // Apply a US-side delisting for AAPL. KZO-170: per-row `marketCode` on
    // `DelistingRecord` scopes the UPDATE to a single market — without it, the
    // pre-KZO-170 fallback path would touch every row for the ticker (TW + US).
    const usDelistings: DelistingRecord[] = [
      { ticker: "AAPL", name: "Apple Inc.", date: "2026-04-25", marketCode: "US" },
    ];
    const result = await persistence!.upsertInstrumentCatalog([], usDelistings);
    expect(result.delisted).toBe(1);

    // Only the US row's delisted_at must be set; the TW row stays NULL.
    const rows = await pool.query<{ market_code: string; delisted_at: Date | null }>(
      `SELECT market_code, delisted_at
         FROM market_data.instruments
         WHERE ticker = 'AAPL'
         ORDER BY market_code`,
    );
    const twRow = rows.rows.find((r) => r.market_code === "TW")!;
    const usRow = rows.rows.find((r) => r.market_code === "US")!;
    expect(twRow.delisted_at).toBeNull();
    expect(usRow.delisted_at).not.toBeNull();
  });
});
