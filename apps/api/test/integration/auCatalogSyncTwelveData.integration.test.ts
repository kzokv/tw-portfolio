/**
 * KZO-194 — AU catalog-sync round-trip via `MockTwelveDataAuCatalogProvider`.
 *
 * Verifies that `runCatalogSync({ marketCode: "AU", catalogProvider: mockTd, persistence })`
 * correctly persists the mock fixture into `market_data.instruments` with:
 *   - The right `instrument_type` per the AU classifier branch in `classifyInstrument`:
 *       Common Stock    → STOCK   (e.g. RIO)
 *       ETF             → ETF     (e.g. STW — comes from the /etf endpoint)
 *       REIT            → STOCK   (e.g. SCG — AU branch: anything !== "ETF" → STOCK)
 *       Preferred Stock → STOCK   (e.g. NABPF)
 *       Depositary Receipt → STOCK (e.g. RYDAF)
 *   - `market_code = 'AU'` on every inserted row
 *   - Warrant entries excluded (RIOWAR filtered by `MockTwelveDataAuCatalogProvider`
 *     before returning `RawInstrumentInfo[]`, so they never reach `runCatalogSync`).
 *
 * Fixture tickers: RIO, STW, SCG, NABPF, RYDAF (5 non-Warrant rows).
 * RIOWAR is the Warrant entry that must be absent after sync.
 *
 * Per `.claude/rules/integration-test-persistence-direct.md`:
 *   - Uses `PostgresPersistence` directly. Does NOT use `buildApp()` (requires Redis).
 *   - Full pattern: scoped `Pool` + explicit `applyNumberedMigrations`.
 *   - `market_data.` schema-qualified table names in all raw SQL.
 *
 * Per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`:
 *   - All tickers used here (RIO, STW, SCG, NABPF, RYDAF, RIOWAR) are in the
 *     Postgres-only category. They are safe for this Postgres integration test
 *     and will NOT collide with memory-backed E2E or HTTP specs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { runCatalogSync } from "../../src/services/market-data/runCatalogSync.js";
import type { InstrumentCatalogProvider } from "../../src/services/market-data/types.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite =
  runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

async function resetDatabase(pool: Pool): Promise<void> {
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

async function applyNumberedMigrations(pool: Pool): Promise<void> {
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

/** Minimal yahoo stub — tests in this suite only call `fetchInstrumentCatalog`. */
function makeYahooStub(): InstrumentCatalogProvider {
  return {
    providerId: "yahoo-finance-au",
    supportsMetadataEnrichment: true,
    supportsDelistingFeed: false,
    absenceDetectionEnabled: false,
    fetchInstrumentCatalog: vi.fn().mockResolvedValue([]),
    fetchDelistingHistory: vi.fn().mockResolvedValue([]),
    fetchInstrumentMetadata: vi.fn().mockResolvedValue(null),
    searchInstruments: vi.fn().mockResolvedValue([]),
    reserveCapacity: vi.fn(),
  } as never;
}

describePostgres(
  "AU catalog-sync round-trip — MockTwelveDataAuCatalogProvider (KZO-194)",
  () => {
    let pool: Pool;
    let persistence: PostgresPersistence | null = null;

    beforeEach(async () => {
      pool = new Pool({ connectionString: databaseUrl });
      await resetDatabase(pool);
      await applyNumberedMigrations(pool);
      persistence = new PostgresPersistence({
        databaseUrl: databaseUrl!,
        redisUrl: redisUrl!,
      });
      await persistence.init();
    });

    afterEach(async () => {
      if (persistence) {
        await persistence.close();
        persistence = null;
      }
      await pool.end();
    });

    /**
     * Read all AU instruments from `market_data.instruments` after a sync.
     * Returns rows sorted by ticker for deterministic assertions.
     */
    async function readAuInstruments(): Promise<
      Array<{ ticker: string; instrument_type: string | null; market_code: string }>
    > {
      const { rows } = await pool.query<{
        ticker: string;
        instrument_type: string | null;
        market_code: string;
      }>(
        `SELECT ticker, instrument_type, market_code
         FROM market_data.instruments
         WHERE market_code = 'AU'
         ORDER BY ticker ASC`,
      );
      return rows;
    }

    it(
      "[T1]: runCatalogSync with MockTwelveDataAuCatalogProvider inserts all non-Warrant fixture rows",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const mockTd = new MockTwelveDataAuCatalogProvider({
          yahooFallback: makeYahooStub(),
        });

        // Act
        const result = await runCatalogSync({
          catalogProvider: mockTd,
          marketCode: "AU",
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });

        // Fixture has 5 non-Warrant rows: RIO, STW, SCG, NABPF, RYDAF
        expect(result.upserted).toBe(5);

        const auRows = await readAuInstruments();
        expect(auRows).toHaveLength(5);
      },
      30_000,
    );

    it(
      "[T2]: every synced AU row has market_code = 'AU'",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const mockTd = new MockTwelveDataAuCatalogProvider({
          yahooFallback: makeYahooStub(),
        });

        await runCatalogSync({
          catalogProvider: mockTd,
          marketCode: "AU",
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });

        const auRows = await readAuInstruments();
        for (const row of auRows) {
          expect(row.market_code).toBe("AU");
        }
      },
      30_000,
    );

    it(
      "[T3]: Common Stock row (RIO) classifies as STOCK",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const mockTd = new MockTwelveDataAuCatalogProvider({
          yahooFallback: makeYahooStub(),
        });

        await runCatalogSync({
          catalogProvider: mockTd,
          marketCode: "AU",
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });

        const auRows = await readAuInstruments();
        const rioRow = auRows.find((r) => r.ticker === "RIO");
        expect(rioRow).toBeDefined();
        // RIO fixture: endpoint="stocks", type="Common Stock" → industryCategory="Common Stock"
        // AU classifier: "Common Stock" !== "ETF" → STOCK
        expect(rioRow!.instrument_type).toBe("STOCK");
      },
      30_000,
    );

    it(
      "[T4]: ETF row (STW) from /etf endpoint classifies as ETF",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const mockTd = new MockTwelveDataAuCatalogProvider({
          yahooFallback: makeYahooStub(),
        });

        await runCatalogSync({
          catalogProvider: mockTd,
          marketCode: "AU",
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });

        const auRows = await readAuInstruments();
        const stwRow = auRows.find((r) => r.ticker === "STW");
        expect(stwRow).toBeDefined();
        // STW fixture: endpoint="etf" → mock stamps industryCategory="ETF"
        // AU classifier: "ETF" → ETF
        expect(stwRow!.instrument_type).toBe("ETF");
      },
      30_000,
    );

    it(
      "[T5]: REIT row (SCG) classifies as STOCK (AU v1 — REIT not a distinct type)",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const mockTd = new MockTwelveDataAuCatalogProvider({
          yahooFallback: makeYahooStub(),
        });

        await runCatalogSync({
          catalogProvider: mockTd,
          marketCode: "AU",
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });

        const auRows = await readAuInstruments();
        const scgRow = auRows.find((r) => r.ticker === "SCG");
        expect(scgRow).toBeDefined();
        // SCG fixture: endpoint="stocks", type="REIT" → industryCategory="REIT"
        // AU classifier: "REIT" !== "ETF" → STOCK
        expect(scgRow!.instrument_type).toBe("STOCK");
      },
      30_000,
    );

    it(
      "[T6]: Preferred Stock row (NABPF) classifies as STOCK",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const mockTd = new MockTwelveDataAuCatalogProvider({
          yahooFallback: makeYahooStub(),
        });

        await runCatalogSync({
          catalogProvider: mockTd,
          marketCode: "AU",
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });

        const auRows = await readAuInstruments();
        const nabpfRow = auRows.find((r) => r.ticker === "NABPF");
        expect(nabpfRow).toBeDefined();
        // NABPF fixture: endpoint="stocks", type="Preferred Stock" → industryCategory="Preferred Stock"
        // AU classifier: "Preferred Stock" !== "ETF" → STOCK
        expect(nabpfRow!.instrument_type).toBe("STOCK");
      },
      30_000,
    );

    it(
      "[T7]: Depositary Receipt row (RYDAF) classifies as STOCK",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const mockTd = new MockTwelveDataAuCatalogProvider({
          yahooFallback: makeYahooStub(),
        });

        await runCatalogSync({
          catalogProvider: mockTd,
          marketCode: "AU",
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });

        const auRows = await readAuInstruments();
        const rydafRow = auRows.find((r) => r.ticker === "RYDAF");
        expect(rydafRow).toBeDefined();
        // RYDAF fixture: endpoint="stocks", type="Depositary Receipt" → industryCategory="Depositary Receipt"
        // AU classifier: "Depositary Receipt" !== "ETF" → STOCK
        expect(rydafRow!.instrument_type).toBe("STOCK");
      },
      30_000,
    );

    it(
      "[T8]: Warrant entry (RIOWAR) is NOT present after sync",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const mockTd = new MockTwelveDataAuCatalogProvider({
          yahooFallback: makeYahooStub(),
        });

        await runCatalogSync({
          catalogProvider: mockTd,
          marketCode: "AU",
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });

        const auRows = await readAuInstruments();
        // RIOWAR is the Warrant fixture entry — must be absent after sync
        const warrantRow = auRows.find((r) => r.ticker === "RIOWAR");
        expect(warrantRow).toBeUndefined();
      },
      30_000,
    );

    it(
      "[T9]: sync is idempotent — re-running does not change the row count",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const mockTd = new MockTwelveDataAuCatalogProvider({
          yahooFallback: makeYahooStub(),
        });
        const syncDeps = {
          catalogProvider: mockTd,
          marketCode: "AU" as const,
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        };

        // First sync
        await runCatalogSync(syncDeps);
        const firstRows = await readAuInstruments();

        // Second sync (same mock, same data)
        await runCatalogSync(syncDeps);
        const secondRows = await readAuInstruments();

        expect(secondRows).toHaveLength(firstRows.length);
      },
      30_000,
    );
  },
);
