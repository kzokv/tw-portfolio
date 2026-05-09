/**
 * KZO-194 — AU LIC metadata delegation via `MockTwelveDataAuCatalogProvider`.
 *
 * Verifies that `TwelveDataAuCatalogProvider` (and its mock) unconditionally
 * delegates `fetchInstrumentMetadata` and `searchInstruments` to the injected
 * `yahooFallback` provider — including for tickers (like AFI, a Listed Investment
 * Company) that do NOT appear in the Twelve Data bulk catalog.
 *
 * Why this is classified as an integration test even though no Postgres write
 * is strictly required for the delegation assertion:
 *   - The test verifies the delegation chain in the context of a catalog sync
 *     (Postgres-backed) to confirm that:
 *       1. AFI does NOT end up in `market_data.instruments` after the TD sync
 *          (the mock catalog only has BHP, VAS, GMG, CBAPD, BHPDR).
 *       2. `fetchInstrumentMetadata('AFI')` still succeeds by delegating to Yahoo.
 *   - This combination (persistence absence + delegation) is the regression-safe
 *     contract for the LIC "long tail" pattern.
 *
 * TDD-RED: `MockTwelveDataAuCatalogProvider` is not yet exported from
 * `providers/index.ts` — this test will remain red until the Implementer adds
 * that export (Slice 1d in scope-todo-202605071412-locked.md).
 *
 * Per `.claude/rules/integration-test-persistence-direct.md`:
 *   - Uses `PostgresPersistence` directly. Does NOT use `buildApp()`.
 *   - Full pattern: scoped Pool + explicit `applyNumberedMigrations`.
 *   - `market_data.` schema-qualified table names in all raw SQL.
 *
 * Per `.claude/rules/typed-transient-error-catch-audit.md`:
 *   - `RateLimitedError` from `fetchInstrumentMetadata` must NOT be swallowed.
 *     The re-throw test ([T4]) verifies this invariant survives the delegation path.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { runCatalogSync } from "../../src/services/market-data/runCatalogSync.js";
import { RateLimitedError } from "../../src/services/market-data/types.js";
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

/** Stub yahoo fallback provider — records calls for assertion. */
function makeMockYahooFallback() {
  const fetchMetadataFn = vi.fn().mockResolvedValue({
    name: "Australian Foundation Investment Co Ltd",
    typeRaw: "LIC",
    industryCategory: "LIC",
    date: "2026-05-07",
  });
  const searchFn = vi.fn().mockResolvedValue([
    {
      ticker: "AFI",
      name: "Australian Foundation Investment Co Ltd",
      typeRaw: "LIC",
      industryCategory: "LIC",
      date: "2026-05-07",
    },
  ]);

  const yahooFallback = {
    providerId: "yahoo-finance-au",
    supportsMetadataEnrichment: true,
    supportsDelistingFeed: false,
    absenceDetectionEnabled: false,
    fetchInstrumentCatalog: vi.fn().mockResolvedValue([]),
    fetchDelistingHistory: vi.fn().mockResolvedValue([]),
    fetchInstrumentMetadata: fetchMetadataFn,
    searchInstruments: searchFn,
    reserveCapacity: vi.fn(),
  } satisfies Partial<InstrumentCatalogProvider> as unknown as InstrumentCatalogProvider;

  return { yahooFallback, fetchMetadataFn, searchFn };
}

describePostgres(
  "AU LIC metadata delegation — TwelveDataAuCatalogProvider delegates to Yahoo (KZO-194)",
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

    it(
      "[T1]: AFI does NOT appear in market_data.instruments after TD catalog sync",
      async () => {
        // TDD-RED: MockTwelveDataAuCatalogProvider not yet exported from providers/index.ts
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const { yahooFallback } = makeMockYahooFallback();
        const mockTd = new MockTwelveDataAuCatalogProvider({ yahooFallback });

        await runCatalogSync({
          catalogProvider: mockTd,
          marketCode: "AU",
          persistence: persistence!,
          log: { info: () => {}, warn: () => {}, error: () => {} },
        });

        // AFI is a LIC (Listed Investment Company) — not included in the TD fixture
        const { rows } = await pool.query(
          `SELECT ticker FROM market_data.instruments WHERE ticker = 'AFI' AND market_code = 'AU'`,
        );
        expect(rows).toHaveLength(0);
      },
      30_000,
    );

    it(
      "[T2]: fetchInstrumentMetadata('AFI') delegates to yahooFallback and returns its result",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const { yahooFallback, fetchMetadataFn } = makeMockYahooFallback();
        const mockTd = new MockTwelveDataAuCatalogProvider({ yahooFallback });

        // AFI not in the TD catalog — delegation must fire
        const result = await mockTd.fetchInstrumentMetadata("AFI");

        expect(fetchMetadataFn).toHaveBeenCalledOnce();
        expect(fetchMetadataFn).toHaveBeenCalledWith("AFI");
        expect(result?.name).toContain("Australian Foundation");
      },
      10_000,
    );

    it(
      "[T3]: searchInstruments('Australian Foundation') delegates to yahooFallback",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const { yahooFallback, searchFn } = makeMockYahooFallback();
        const mockTd = new MockTwelveDataAuCatalogProvider({ yahooFallback });

        const results = await mockTd.searchInstruments("Australian Foundation");

        expect(searchFn).toHaveBeenCalledOnce();
        expect(searchFn).toHaveBeenCalledWith("Australian Foundation");
        expect(results).toHaveLength(1);
        expect(results[0]!.ticker).toBe("AFI");
      },
      10_000,
    );

    it(
      "[T4]: RateLimitedError from yahooFallback.fetchInstrumentMetadata propagates — not swallowed",
      async () => {
        // Per `.claude/rules/typed-transient-error-catch-audit.md`: typed transient errors
        // must not be eaten by intermediate catch handlers. The delegation path must
        // re-throw `RateLimitedError` so the outer caller (backfillWorker) can reschedule.
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const rateLimitErr = new RateLimitedError({ msUntilAvailable: 30_000 });
        const yahooFallback = {
          providerId: "yahoo-finance-au",
          supportsMetadataEnrichment: true,
          supportsDelistingFeed: false,
    absenceDetectionEnabled: false,
          fetchInstrumentCatalog: vi.fn().mockResolvedValue([]),
          fetchDelistingHistory: vi.fn().mockResolvedValue([]),
          fetchInstrumentMetadata: vi.fn().mockRejectedValue(rateLimitErr),
          searchInstruments: vi.fn().mockResolvedValue([]),
          reserveCapacity: vi.fn(),
        } as unknown as InstrumentCatalogProvider;

        const mockTd = new MockTwelveDataAuCatalogProvider({ yahooFallback });

        await expect(mockTd.fetchInstrumentMetadata("AFI")).rejects.toBeInstanceOf(
          RateLimitedError,
        );
      },
      10_000,
    );

    it(
      "[T5]: fetchDelistingHistory returns empty array (TD free tier has no delisting data)",
      async () => {
        const { MockTwelveDataAuCatalogProvider } = await import(
          "../../src/services/market-data/providers/index.js"
        );
        const { yahooFallback } = makeMockYahooFallback();
        const mockTd = new MockTwelveDataAuCatalogProvider({ yahooFallback });

        const delistings = await mockTd.fetchDelistingHistory();
        expect(delistings).toEqual([]);
      },
      10_000,
    );
  },
);
