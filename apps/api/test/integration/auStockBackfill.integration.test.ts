/**
 * KZO-172 — AU backfill round-trip (bars + dividends + metadata enrichment) via
 * `createBackfillHandler` against real Postgres.
 *
 * Mirrors `apps/api/test/integration/usStockBackfill.integration.test.ts` (KZO-170
 * precedent) with three AU-specific additions:
 *
 *   1. **`<60s` wall-clock assertion** (AC #3) — explicit `Date.now()` start/end
 *      check around the handler invocation.
 *   2. **`>= 4` BHP dividend rows** (AC #2) — the AU mock provider seeds 6
 *      twice-yearly entries spanning 2022-09 → 2025-03 specifically to clear
 *      the "≥4 dividends" floor that real BHP cadence (twice yearly = 2/year)
 *      misses on a 1-year window.
 *   3. **`fetchInstrumentMetadata` enrichment persistence** — after backfill,
 *      the instrument row's `name` and `instrument_type` reflect Yahoo's quote
 *      response (mock-deterministic).
 *
 * Plus three regression-net cases:
 *   4. Pre-1988 trade-date truncation (AU history starts at 1988-01-28).
 *   5. Cross-market market-scoped UPDATE — a synthetic AU delisting fixture
 *      must NOT touch a same-ticker TW row.
 *   6. Catalog-sync round-trip safety — the 7-row reserved set survives
 *      `dedupe → build → upsert` without `is_provisional` flipping (Architect
 *      open item).
 *
 * Per `.claude/rules/integration-test-persistence-direct.md` — uses
 * `PostgresPersistence` directly with the "Full pattern" (scoped pool +
 * explicit `applyNumberedMigrations`). Does NOT use `buildApp(...)` — that
 * would require Redis, which isn't provisioned by the integration stack.
 *
 * **Reserved AU tickers** (per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`):
 *   - GMG, IMD — Postgres-only (this test). MemoryPersistence shares its
 *     daily-bars array process-globally; using GMG/IMD here keeps memory-backed
 *     E2E and HTTP specs free to use any non-conflicting AU ticker.
 *   - BHP is the load-bearing ticker for the round-trip + dividend assertions
 *     (used in both this test AND the `au-backfill-aaa.spec.ts` E2E + the
 *     `market-data-{price,search}-aaa.http.spec.ts` HTTP tests). Per the rule,
 *     BHP is the canonical AU primary; this Postgres test does NOT collide
 *     with the memory-backed specs because each integration `beforeEach`
 *     resets the entire `market_data` schema.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import type { JobWithMetadata } from "pg-boss";
import type { MarketCode } from "@vakwen/domain";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import {
  BACKFILL_QUEUE,
  createBackfillHandler,
  type BackfillJobData,
} from "../../src/services/market-data/backfillWorker.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

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

describePostgres("AU backfill round-trip — bars + dividends + metadata enrichment (KZO-172)", () => {
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
   * Seed an AU instrument with `bars_backfill_status = 'pending'` so the
   * worker has a row to flip to `'ready'`. Uses `ON CONFLICT DO UPDATE`
   * (NOT `DO NOTHING`) per `.claude/rules/integration-test-persistence-direct.md`
   * "Seeding rows pre-populated by `persistence.init()`" — `init()` may seed
   * AU rows via the catalog-sync pre-population, and we need the test to
   * deterministically control `bars_backfill_status` regardless.
   *
   * SQL is fully `market_data.`-schema-qualified per the rule's mandatory
   * audit (the schema is not on the default search_path).
   */
  async function seedAuInstrument(ticker: string): Promise<void> {
    await pool.query(
      `INSERT INTO market_data.instruments
         (ticker, market_code, name, instrument_type, bars_backfill_status)
       VALUES ($1, 'AU', $2, 'STOCK', 'pending')
       ON CONFLICT (ticker, market_code) DO UPDATE
         SET bars_backfill_status = EXCLUDED.bars_backfill_status,
             name                 = EXCLUDED.name,
             instrument_type      = EXCLUDED.instrument_type`,
      [ticker, `${ticker} placeholder`],
    );
  }

  function makeHandlerDeps(
    provider: import("../../src/services/market-data/types.js").MarketDataProvider &
      import("../../src/services/market-data/types.js").InstrumentCatalogProvider,
  ) {
    const marketDataRegistry = new Map<MarketCode, typeof provider>();
    marketDataRegistry.set("AU", provider);
    const catalogRegistry = new Map<MarketCode, typeof provider>();
    catalogRegistry.set("AU", provider);
    return {
      pool,
      marketDataRegistry,
      catalogRegistry,
      // KZO-172 (Phase 4 F4): real `PostgresPersistence` so the worker's metadata
      // enrichment branch (`fetchInstrumentMetadata` → `persistence.upsertInstrumentCatalog`)
      // actually writes through to `market_data.instruments`. Without this the
      // worker's `persistence` lookup is undefined and a TypeError gets eaten by
      // the outer warn-and-continue catch — silently passing T1 for the wrong
      // reason (no enrichment happened, but no error either).
      persistence: persistence!,
      eventBus: { publishEvent: vi.fn().mockResolvedValue(undefined) },
      boss: { send: vi.fn().mockResolvedValue(undefined) },
      // KZO-189: implementation-coupled stub. Tests in this suite use
      // trigger="user_selection" → shouldEnrich=true under "conditional",
      // matching pre-KZO-189 behavior (enrichment runs).
      getEffectiveMetadataEnrichmentMode: vi.fn().mockResolvedValue("conditional"),
      updateBackfillStatus: async (
        ticker: string,
        marketCode: import("@vakwen/domain").MarketCode,
        status: string,
      ) => {
        await persistence!.updateBackfillStatus(
          ticker,
          marketCode,
          status as "ready" | "backfilling" | "failed" | "pending",
        );
      },
      getUsersMonitoringTicker: vi.fn().mockResolvedValue([]),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
  }

  function makeJob(data: BackfillJobData): JobWithMetadata<BackfillJobData> {
    return {
      id: randomUUID(),
      name: BACKFILL_QUEUE,
      data,
      retryCount: 0,
      retryLimit: 3,
      priority: 10,
    } as unknown as JobWithMetadata<BackfillJobData>;
  }

  // ───────────────────────────────────────────────────────────────────────
  // T1 (AC #1, #2, #3) — BHP/AU round-trip with explicit <60s + ≥4 dividends
  //                       + metadata enrichment persistence
  // ───────────────────────────────────────────────────────────────────────

  it("backfills BHP/AU: daily_bars stamped 'yahoo-finance-au' + 'AU', ≥4 dividend rows in AUD, metadata enriches the instrument row, wall-clock <60s", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockYahooFinanceAuMarketDataProvider();

    await seedAuInstrument("BHP");

    const handlerDeps = makeHandlerDeps(provider);
    const handler = createBackfillHandler(handlerDeps as never);

    const job = makeJob({
      ticker: "BHP",
      marketCode: "AU",
      trigger: "user_selection",
      userId: "user-1",
      startDate: "2022-01-01",
    });

    const t0 = Date.now();
    await handler([job as never]);
    const elapsedMs = Date.now() - t0;

    // ── Wall-clock assertion (AC #3) ─────────────────────────────────────
    expect(elapsedMs).toBeLessThan(60_000);

    // ── daily_bars: every row stamped market_code='AU' + source='yahoo-finance-au' ──
    const barsRows = await pool.query<{
      ticker: string;
      market_code: string;
      source: string;
    }>(
      `SELECT ticker, market_code, source
         FROM market_data.daily_bars
         WHERE ticker = 'BHP' AND market_code = 'AU'`,
    );
    expect(barsRows.rows.length).toBeGreaterThan(0);
    for (const row of barsRows.rows) {
      expect(row.market_code).toBe("AU");
      expect(row.source).toBe("yahoo-finance-au");
    }

    // ── dividend_events: ≥4 BHP rows in AUD (AC #2) ──────────────────────
    const divRows = await pool.query<{
      ticker: string;
      market_code: string;
      cash_dividend_currency: string;
      source: string;
      ex_dividend_date: string;
    }>(
      `SELECT ticker, market_code, cash_dividend_currency, source, ex_dividend_date::text AS ex_dividend_date
         FROM market_data.dividend_events
         WHERE ticker = 'BHP' AND market_code = 'AU'
         ORDER BY ex_dividend_date ASC`,
    );
    expect(divRows.rows.length).toBeGreaterThanOrEqual(4);
    for (const row of divRows.rows) {
      expect(row.market_code).toBe("AU");
      expect(row.cash_dividend_currency).toBe("AUD");
      expect(row.source).toBe("yahoo-finance-au");
    }
    // Span: across ≥3 distinct calendar years.
    const years = new Set(
      divRows.rows.map((r) => r.ex_dividend_date.slice(0, 4)),
    );
    expect(years.size).toBeGreaterThanOrEqual(3);

    // ── instrument status flipped to 'ready' ─────────────────────────────
    const statusRow = await pool.query<{ bars_backfill_status: string }>(
      `SELECT bars_backfill_status
         FROM market_data.instruments
         WHERE ticker = 'BHP' AND market_code = 'AU'`,
    );
    expect(statusRow.rows[0]!.bars_backfill_status).toBe("ready");

    // ── instrument enrichment via fetchInstrumentMetadata ────────────────
    // The mock returns name='BHP Group Limited', industryCategory='EQUITY';
    // the AU classifier maps EQUITY → STOCK.
    const enrichedRow = await pool.query<{
      name: string | null;
      instrument_type: string | null;
      is_provisional: boolean;
    }>(
      `SELECT name, instrument_type, is_provisional
         FROM market_data.instruments
         WHERE ticker = 'BHP' AND market_code = 'AU'`,
    );
    expect(enrichedRow.rows[0]!.name).toBe("BHP Group Limited");
    expect(enrichedRow.rows[0]!.instrument_type).toBe("STOCK");
    expect(enrichedRow.rows[0]!.is_provisional).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // T2 — Pre-1988 trade-date truncation
  // ───────────────────────────────────────────────────────────────────────

  it("truncates pre-1988 startDate to historyStartFor('AU') = 1988-01-28", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockYahooFinanceAuMarketDataProvider();
    await seedAuInstrument("GMG");

    const handlerDeps = makeHandlerDeps(provider);
    const handler = createBackfillHandler(handlerDeps as never);

    await handler([
      makeJob({
        ticker: "GMG",
        marketCode: "AU",
        trigger: "user_selection",
        userId: "user-1",
        startDate: "1985-01-01", // pre-1988-01-28
      }) as never,
    ]);

    // Inspect the mock's `calls` field — the worker passes `effectiveStartDate`
    // to `fetchBars`, which must be ≥ "1988-01-28" (the AU provider boundary).
    const fetchBarsCall = provider.calls.find(
      (c) => c.method === "fetchBars" && c.ticker === "GMG",
    );
    expect(fetchBarsCall).toBeDefined();
    expect(typeof fetchBarsCall!.startDate).toBe("string");
    expect(fetchBarsCall!.startDate! >= "1988-01-28").toBe(true);
    expect(fetchBarsCall!.startDate).not.toBe("1985-01-01");
  });

  // ───────────────────────────────────────────────────────────────────────
  // T3 — Cross-market market-scoped UPDATE regression
  //
  // A synthetic AU delisting fixture must NOT touch the same-ticker TW row.
  // The fixture is injected via a wrapper provider that overrides
  // `fetchDelistingHistory`; the rest of the AU mock provider's behavior is
  // untouched. Asserts on the per-(ticker, market) row identity only.
  // ───────────────────────────────────────────────────────────────────────

  it("AU delisting fixture flushes (BHP, AU) but does NOT touch (BHP, TW) or unrelated TW rows", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const baseAuProvider = new MockYahooFinanceAuMarketDataProvider();

    // Wrap the base provider with a delisting-history override. Same instance
    // pattern as the real AU provider (one class implements both interfaces).
    const provider = new Proxy(baseAuProvider, {
      get(target, prop, receiver) {
        if (prop === "fetchDelistingHistory") {
          return async () => [
            {
              ticker: "BHP",
              name: "BHP Group Limited",
              date: "2024-09-15",
            },
          ];
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    // Seed three rows: (BHP, AU), (BHP, TW), (2330, TW) — the goal is to
    // verify the AU delisting flush hits only the first row.
    await pool.query(
      `INSERT INTO market_data.instruments
         (ticker, market_code, name, instrument_type, bars_backfill_status)
       VALUES
         ('BHP',  'AU', 'BHP Group Limited',     'STOCK', 'ready'),
         ('BHP',  'TW', 'BHP TW Listing',         'STOCK', 'ready'),
         ('2330', 'TW', 'TSMC',                   'STOCK', 'ready')
       ON CONFLICT (ticker, market_code) DO UPDATE
         SET bars_backfill_status = EXCLUDED.bars_backfill_status,
             name                 = EXCLUDED.name,
             instrument_type      = EXCLUDED.instrument_type`,
    );

    // Run the catalog-sync flow for AU. The AU catalog provider returns the
    // 7-row reserved set; the delisting flush triggers from the wrapper's
    // synthetic fixture.
    const { runCatalogSync } = await import(
      "../../src/services/market-data/runCatalogSync.js"
    );
    await runCatalogSync({
      catalogProvider: provider as unknown as import("../../src/services/market-data/types.js").InstrumentCatalogProvider,
      marketCode: "AU" as MarketCode,
      persistence: persistence!,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    });

    // (BHP, AU): delisted_at set.
    const bhpAu = await pool.query<{ delisted_at: string | null }>(
      `SELECT delisted_at::text AS delisted_at
         FROM market_data.instruments
         WHERE ticker = 'BHP' AND market_code = 'AU'`,
    );
    expect(bhpAu.rows[0]!.delisted_at).not.toBeNull();

    // (BHP, TW): delisted_at MUST remain NULL — same ticker, different market,
    // must not be collateral damage.
    const bhpTw = await pool.query<{ delisted_at: string | null }>(
      `SELECT delisted_at::text AS delisted_at
         FROM market_data.instruments
         WHERE ticker = 'BHP' AND market_code = 'TW'`,
    );
    expect(bhpTw.rows[0]!.delisted_at).toBeNull();

    // (2330, TW): unchanged.
    const tsmc = await pool.query<{ delisted_at: string | null }>(
      `SELECT delisted_at::text AS delisted_at
         FROM market_data.instruments
         WHERE ticker = '2330' AND market_code = 'TW'`,
    );
    expect(tsmc.rows[0]!.delisted_at).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────
  // T4 — Catalog-sync round-trip safety (Architect open item)
  //
  // The 7-row reserved set must survive `dedupe → build → upsert` without
  // `is_provisional` flipping to TRUE on consecutive runs. Per
  // `.claude/rules/integration-test-persistence-direct.md`'s
  // "Seeding rows pre-populated by `persistence.init()`" pattern, no manual
  // seed is required — `runCatalogSync` is the seed. Both runs are run
  // back-to-back; the assertion is on `is_provisional === false` and idempotent
  // tickers across the two passes.
  // ───────────────────────────────────────────────────────────────────────

  it("catalog-sync round-trip: TD-AU mock fixture (5 non-warrant rows) survives dedupe → build → upsert without is_provisional flipping", async () => {
    // KZO-194: AU catalog is now sourced from `TwelveDataAuCatalogProvider`. The mock
    // fixture covers Common Stock / ETF / REIT / Preferred Stock / Depositary Receipt
    // + 1 Warrant (must be filtered out) — 5 rows survive the warrant filter.
    const {
      MockYahooFinanceAuMarketDataProvider,
      MockTwelveDataAuCatalogProvider,
      MOCK_TD_AU_CATALOG_TICKERS,
    } = await import("../../src/services/market-data/providers/index.js");
    const yahooMock = new MockYahooFinanceAuMarketDataProvider();
    const provider = new MockTwelveDataAuCatalogProvider({ yahooFallback: yahooMock });

    const { runCatalogSync } = await import(
      "../../src/services/market-data/runCatalogSync.js"
    );

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

    // First run.
    await runCatalogSync({
      catalogProvider: provider as unknown as import("../../src/services/market-data/types.js").InstrumentCatalogProvider,
      marketCode: "AU" as MarketCode,
      persistence: persistence!,
      log,
    });
    // Second run — exact same payload; idempotent semantics required.
    await runCatalogSync({
      catalogProvider: provider as unknown as import("../../src/services/market-data/types.js").InstrumentCatalogProvider,
      marketCode: "AU" as MarketCode,
      persistence: persistence!,
      log,
    });

    const expectedTickers = [...MOCK_TD_AU_CATALOG_TICKERS].sort();

    const rows = await pool.query<{ ticker: string; is_provisional: boolean; instrument_type: string | null }>(
      `SELECT ticker, is_provisional, instrument_type
         FROM market_data.instruments
         WHERE market_code = 'AU' AND ticker = ANY($1)
         ORDER BY ticker ASC`,
      [expectedTickers],
    );

    expect(rows.rows.map((r) => r.ticker)).toEqual(expectedTickers);

    // is_provisional is FALSE on every catalog row (full ingestion, not provisional).
    for (const row of rows.rows) {
      expect(row.is_provisional).toBe(false);
    }

    // STW is the lone ETF in the fixture; the rest (Common Stock / REIT / Preferred /
    // Depositary Receipt) classify as STOCK per the AU classifier branch.
    const etfRow = rows.rows.find((r) => r.ticker === "STW")!;
    expect(etfRow.instrument_type).toBe("ETF");
    for (const row of rows.rows) {
      if (row.ticker !== "STW") {
        expect(row.instrument_type).toBe("STOCK");
      }
    }

    // Warrant entry from the fixture (RIOWAR) MUST NOT have been ingested.
    const warrantRow = await pool.query(
      `SELECT 1 FROM market_data.instruments WHERE market_code = 'AU' AND ticker = 'RIOWAR'`,
    );
    expect(warrantRow.rowCount).toBe(0);
  });
});
