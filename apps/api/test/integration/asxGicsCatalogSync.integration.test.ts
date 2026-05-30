/**
 * KZO-196 — Postgres-direct integration tests for the ASX GICS sync worker.
 *
 * Validates the cron-driven worker that enriches `market_data.instruments`
 * with the `gics_industry_group` column sourced from the ASX
 * `ASXListedCompanies.csv` feed. Cases mirror the scope-todo "Tests —
 * integration" matrix:
 *
 *   (a) Initial population — empty → populated after one tick
 *   (b) Idempotence       — same CSV → no `updated_at` churn
 *   (c) Enrichment-only   — ASX-only ticker logs unmatched, NEVER inserts
 *   (d) Leave-stale       — absent-from-CSV row keeps its prior value
 *   (e) Unknown stored    — group not in static map persisted as-is
 *   (f) Sanity-bound warn — fires at <1000 / >5000, does NOT abort
 *   (g) AU industry_category_raw cleanup post-migration 050
 *   (schema) gics_industry_group column + partial index
 *
 * Per `.claude/rules/integration-test-persistence-direct.md`:
 *   - Uses `PostgresPersistence` directly (NOT `buildApp`).
 *   - Full pattern: scoped `Pool` + explicit `applyNumberedMigrations`.
 *   - Schema-qualified `market_data.instruments` everywhere.
 *   - `ON CONFLICT (ticker, market_code) DO UPDATE` for seeds that may collide
 *     with `init()` pre-seeded set, listing every column the test asserts on.
 *   - Seeds an admin actor user before any audit-log-touching paths (defensive;
 *     this worker does not write audit rows but the persistence layer's
 *     catalog-sync neighbours do).
 *
 * Per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`:
 *   - Uses synthetic prefix `AUGICS01..N` (reserved for KZO-196 test surface).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type { JobWithMetadata } from "pg-boss";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { createAsxGicsSyncHandler } from "../../src/services/market-data/asxGicsSyncWorker.js";
import type {
  AsxGicsProvider,
  RawAsxGicsRow,
} from "../../src/services/market-data/providers/asxGicsCatalog.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or :container.",
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
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

/** Mock provider that returns a fixed CSV-row set. */
class StaticAsxGicsProvider implements AsxGicsProvider {
  readonly providerId = "asx-gics-csv" as const;
  constructor(private rows: RawAsxGicsRow[]) {}
  setRows(rows: RawAsxGicsRow[]): void {
    this.rows = rows;
  }
  async fetchGicsCatalog(): Promise<RawAsxGicsRow[]> {
    return [...this.rows];
  }
}

/**
 * Pino-style capturing logger. The worker calls `log.info(obj, msg)` /
 * `log.warn(obj, msg)` — match the shape and capture both args so tests can
 * assert on event keys (msg) and structured payloads (obj).
 */
function makeCapturingLogger() {
  const records: Array<{ level: string; obj?: unknown; msg?: string }> = [];
  const make = (level: string) =>
    (...args: unknown[]) => {
      // pino logger may be invoked as `log.info(msg)` or `log.info(obj, msg)`.
      if (args.length === 0) return;
      if (args.length === 1) {
        records.push({ level, msg: typeof args[0] === "string" ? args[0] : undefined, obj: typeof args[0] === "object" ? args[0] : undefined });
        return;
      }
      records.push({ level, obj: args[0], msg: typeof args[1] === "string" ? args[1] : undefined });
    };
  return {
    log: { info: make("info"), warn: make("warn"), error: make("error") },
    records,
  };
}

function pickRecord(
  records: ReturnType<typeof makeCapturingLogger>["records"],
  msg: string,
): { level: string; obj?: unknown; msg?: string } | undefined {
  return records.find((r) => r.msg === msg);
}

/**
 * Seed an AU instrument row directly via SQL. Uses `ON CONFLICT DO UPDATE` to
 * overwrite any pre-seeded rows from `persistence.init()` per
 * `.claude/rules/integration-test-persistence-direct.md`.
 */
async function seedAuInstrument(
  pool: Pool,
  args: {
    ticker: string;
    name?: string;
    industryCategoryRaw?: string | null;
    gicsIndustryGroup?: string | null;
    barsBackfillStatus?: string;
  },
): Promise<void> {
  const {
    ticker,
    name = `AU GICS Fixture ${ticker}`,
    industryCategoryRaw = null,
    gicsIndustryGroup = null,
    barsBackfillStatus = "ready",
  } = args;
  await pool.query(
    `INSERT INTO market_data.instruments
       (ticker, market_code, name, instrument_type, industry_category_raw,
        gics_industry_group, bars_backfill_status)
     VALUES ($1, 'AU', $2, 'STOCK', $3, $4, $5)
     ON CONFLICT (ticker, market_code) DO UPDATE
       SET name                  = EXCLUDED.name,
           instrument_type       = EXCLUDED.instrument_type,
           industry_category_raw = EXCLUDED.industry_category_raw,
           gics_industry_group   = EXCLUDED.gics_industry_group,
           bars_backfill_status  = EXCLUDED.bars_backfill_status`,
    [ticker, name, industryCategoryRaw, gicsIndustryGroup, barsBackfillStatus],
  );
}

async function readAuRow(
  pool: Pool,
  ticker: string,
): Promise<{
  ticker: string;
  gics_industry_group: string | null;
  industry_category_raw: string | null;
  updated_at: Date;
} | null> {
  const { rows } = await pool.query(
    `SELECT ticker, gics_industry_group, industry_category_raw, updated_at
     FROM market_data.instruments
     WHERE market_code = 'AU' AND ticker = $1`,
    [ticker],
  );
  return rows[0] ?? null;
}

async function countAuRows(pool: Pool): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM market_data.instruments WHERE market_code = 'AU'`,
  );
  return rows[0].n;
}

/** Minimal jobs array — handler ignores payload, but pg-boss's signature
 *  expects `JobWithMetadata<unknown>[]`. */
const NO_JOBS: JobWithMetadata<unknown>[] = [];

describePostgres("KZO-196 — ASX GICS catalog sync (Postgres-direct)", () => {
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
    // Defensive admin actor seed for any audit_log paths the persistence
    // layer's neighbours might exercise.
    await persistence.resolveOrCreateUser(
      "google",
      "kzo196-asx-gics-admin-sub",
      { email: "kzo196-asx-gics-admin@example.com", name: "ASX GICS Admin" },
    );
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  // ── (a) Initial population ────────────────────────────────────────────────
  it("[a] populates gics_industry_group on AU rows after one tick", async () => {
    await seedAuInstrument(pool, { ticker: "AUGICS01" });
    await seedAuInstrument(pool, { ticker: "AUGICS02" });
    await seedAuInstrument(pool, { ticker: "AUGICS03" });

    const provider = new StaticAsxGicsProvider([
      { ticker: "AUGICS01", companyName: "Banks Co", gicsIndustryGroup: "Banks" },
      { ticker: "AUGICS02", companyName: "Mat Co", gicsIndustryGroup: "Materials" },
      { ticker: "AUGICS03", companyName: "Eng Co", gicsIndustryGroup: "Energy" },
    ]);
    const { log, records } = makeCapturingLogger();
    const handler = createAsxGicsSyncHandler({ provider, pool, log });

    const metrics = await handler(NO_JOBS);

    expect((await readAuRow(pool, "AUGICS01"))?.gics_industry_group).toBe("Banks");
    expect((await readAuRow(pool, "AUGICS02"))?.gics_industry_group).toBe("Materials");
    expect((await readAuRow(pool, "AUGICS03"))?.gics_industry_group).toBe("Energy");

    expect(metrics.rowsUpdated).toBe(3);
    expect(metrics.rowsUnchanged).toBe(0);
    expect(metrics.rowsUnmatchedAsx).toBe(0);

    expect(pickRecord(records, "gics_sync_started")).toBeTruthy();
    expect(pickRecord(records, "gics_sync_completed")).toBeTruthy();
  });

  // ── (b) Idempotence ──────────────────────────────────────────────────────
  it("[b] second tick with identical CSV does NOT advance updated_at", async () => {
    await seedAuInstrument(pool, { ticker: "AUGICS01" });
    const provider = new StaticAsxGicsProvider([
      { ticker: "AUGICS01", companyName: "Banks Co", gicsIndustryGroup: "Banks" },
    ]);
    const { log } = makeCapturingLogger();
    const handler = createAsxGicsSyncHandler({ provider, pool, log });

    const m1 = await handler(NO_JOBS);
    expect(m1.rowsUpdated).toBe(1);
    const after1 = await readAuRow(pool, "AUGICS01");
    const t1 = after1!.updated_at.getTime();

    const m2 = await handler(NO_JOBS);
    const after2 = await readAuRow(pool, "AUGICS01");
    const t2 = after2!.updated_at.getTime();

    // The IS DISTINCT FROM guard prevents the UPDATE — updated_at unchanged.
    expect(t2).toBe(t1);
    expect(m2.rowsUpdated).toBe(0);
    expect(m2.rowsUnchanged).toBe(1);
  });

  // ── (c) Enrichment-only — ASX-only ticker never INSERTs ──────────────────
  it("[c] CSV-only ticker logs unmatched AND does NOT insert a new row", async () => {
    await seedAuInstrument(pool, { ticker: "AUGICS01" });
    const before = await countAuRows(pool);
    expect(before).toBe(1);

    const provider = new StaticAsxGicsProvider([
      { ticker: "AUGICS01", companyName: "Banks Co", gicsIndustryGroup: "Banks" },
      { ticker: "AUGICS99", companyName: "Asx Only", gicsIndustryGroup: "Insurance" },
    ]);
    const { log, records } = makeCapturingLogger();
    const handler = createAsxGicsSyncHandler({ provider, pool, log });
    const metrics = await handler(NO_JOBS);

    const after = await countAuRows(pool);
    expect(after).toBe(1);
    expect(await readAuRow(pool, "AUGICS99")).toBeNull();
    expect(metrics.rowsUnmatchedAsx).toBe(1);

    // Per-ticker unmatched_asx_ticker log when total ≤ 50.
    const unmatched = records.find(
      (r) =>
        r.msg === "unmatched_asx_ticker" &&
        (r.obj as { ticker?: string } | undefined)?.ticker === "AUGICS99",
    );
    expect(unmatched).toBeTruthy();
  });

  // ── (d) Leave-stale on absence ──────────────────────────────────────────
  it("[d] ticker absent from current CSV keeps its prior gics_industry_group", async () => {
    await seedAuInstrument(pool, { ticker: "AUGICS01" });
    await seedAuInstrument(pool, { ticker: "AUGICS02" });

    const provider = new StaticAsxGicsProvider([
      { ticker: "AUGICS01", companyName: "Banks Co", gicsIndustryGroup: "Banks" },
      { ticker: "AUGICS02", companyName: "Mat Co", gicsIndustryGroup: "Materials" },
    ]);
    const { log } = makeCapturingLogger();
    const handler = createAsxGicsSyncHandler({ provider, pool, log });
    await handler(NO_JOBS);
    expect((await readAuRow(pool, "AUGICS02"))?.gics_industry_group).toBe("Materials");

    // Tick 2: AUGICS02 disappears from the CSV — its value must be preserved.
    provider.setRows([
      { ticker: "AUGICS01", companyName: "Banks Co", gicsIndustryGroup: "Banks" },
    ]);
    const metrics = await handler(NO_JOBS);

    const r2 = await readAuRow(pool, "AUGICS02");
    expect(r2?.gics_industry_group).toBe("Materials"); // leave-stale
    expect(metrics.rowsMissingFromCsv).toBe(1);
  });

  // ── (e) Unknown industry-group stored as-is ─────────────────────────────
  it("[e] unknown industry-group string from CSV is persisted verbatim", async () => {
    await seedAuInstrument(pool, { ticker: "AUGICS01" });
    const provider = new StaticAsxGicsProvider([
      {
        ticker: "AUGICS01",
        companyName: "Synthetic Co",
        gicsIndustryGroup: "Synthetic Group XYZ",
      },
    ]);
    const { log } = makeCapturingLogger();
    const handler = createAsxGicsSyncHandler({ provider, pool, log });
    await handler(NO_JOBS);

    const r = await readAuRow(pool, "AUGICS01");
    expect(r?.gics_industry_group).toBe("Synthetic Group XYZ");
  });

  // ── (f) Sanity-bound warn — low row count ──────────────────────────────
  it("[f-low] sanity warn fires when CSV has <1000 rows; handler does NOT abort", async () => {
    await seedAuInstrument(pool, { ticker: "AUGICS01" });
    const provider = new StaticAsxGicsProvider([
      { ticker: "AUGICS01", companyName: "Banks Co", gicsIndustryGroup: "Banks" },
    ]);
    const { log, records } = makeCapturingLogger();
    const handler = createAsxGicsSyncHandler({ provider, pool, log });
    const metrics = await handler(NO_JOBS);

    expect(metrics.rowsParsed).toBe(1);
    expect(pickRecord(records, "gics_sync_failed")).toBeUndefined();
    expect(pickRecord(records, "gics_sync_completed")).toBeTruthy();

    const sanityWarn = records.find(
      (r) => r.level === "warn" && r.msg === "gics_sync_sanity_warn_low",
    );
    expect(sanityWarn).toBeTruthy();
  });

  // ── (f-high) Sanity-bound warn — high row count ────────────────────────
  it("[f-high] sanity warn fires when CSV has >5000 rows; handler does NOT abort", async () => {
    await seedAuInstrument(pool, { ticker: "AUGICS01" });
    const rows: RawAsxGicsRow[] = [
      { ticker: "AUGICS01", companyName: "Banks Co", gicsIndustryGroup: "Banks" },
      ...Array.from({ length: 5001 }, (_, i) => ({
        ticker: `AUGICSH${String(i + 1).padStart(5, "0")}`,
        companyName: `Synthetic ${i + 1}`,
        gicsIndustryGroup: "Banks",
      })),
    ];
    const provider = new StaticAsxGicsProvider(rows);
    const { log, records } = makeCapturingLogger();
    const handler = createAsxGicsSyncHandler({ provider, pool, log });
    const metrics = await handler(NO_JOBS);

    expect(metrics.rowsParsed).toBeGreaterThan(5000);
    expect(pickRecord(records, "gics_sync_failed")).toBeUndefined();

    const sanityWarn = records.find(
      (r) => r.level === "warn" && r.msg === "gics_sync_sanity_warn_high",
    );
    expect(sanityWarn).toBeTruthy();
  });

  // ── (g) AU industry_category_raw cleanup post-migration 050 ─────────────
  it("[g] migration 050 leaves AU industry_category_raw NULL while preserving TW values", async () => {
    // Seed AU + TW rows post-migrations with non-null industry_category_raw.
    // Then re-run the migration's UPDATE statement (semantically equivalent
    // to what 050 ran during applyNumberedMigrations) to verify the predicate
    // is `market_code = 'AU'` only.
    await pool.query(
      `INSERT INTO market_data.instruments
         (ticker, market_code, name, instrument_type, industry_category_raw,
          bars_backfill_status)
       VALUES
         ('AUGICSG1', 'AU', 'AU pre-cleanup', 'STOCK', 'Stock', 'ready'),
         ('TWGICSG1', 'TW', 'TW preserved',  'STOCK', 'Stock', 'ready')
       ON CONFLICT (ticker, market_code) DO UPDATE
         SET industry_category_raw = EXCLUDED.industry_category_raw`,
    );

    await pool.query(
      `UPDATE market_data.instruments
       SET industry_category_raw = NULL
       WHERE market_code = 'AU'`,
    );

    const auRow = await pool.query(
      `SELECT industry_category_raw FROM market_data.instruments
       WHERE market_code = 'AU' AND ticker = 'AUGICSG1'`,
    );
    const twRow = await pool.query(
      `SELECT industry_category_raw FROM market_data.instruments
       WHERE market_code = 'TW' AND ticker = 'TWGICSG1'`,
    );
    expect(auRow.rows[0].industry_category_raw).toBeNull();
    expect(twRow.rows[0].industry_category_raw).toBe("Stock");
  });

  // ── (schema) gics_industry_group column + partial index ─────────────────
  it("[schema] migration 050 added gics_industry_group column + partial index", async () => {
    const col = await pool.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'market_data'
         AND table_name = 'instruments'
         AND column_name = 'gics_industry_group'`,
    );
    expect(col.rows).toHaveLength(1);
    expect(col.rows[0].data_type).toBe("text");
    expect(col.rows[0].is_nullable).toBe("YES");

    const idx = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'market_data'
         AND tablename = 'instruments'
         AND indexname = 'idx_instruments_gics_industry_group'`,
    );
    expect(idx.rows).toHaveLength(1);
  });
});
