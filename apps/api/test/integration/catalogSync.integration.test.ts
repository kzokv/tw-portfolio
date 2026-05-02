import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import type { CatalogInstrument, DelistingRecord } from "../../src/persistence/types.js";
import type { InstrumentDef } from "../../src/types/store.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { buildApp } from "../../src/app.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.TWP_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:ci:host or npm run test:integration:ci:container so the DB/Redis stack is managed automatically.",
  );
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);

const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

describePostgres("catalog sync persistence", () => {
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

  // KZO-170: per-row `marketCode` is required on `CatalogInstrument` (was hardcoded
  // 'TW' at the SQL layer pre-KZO-170). Stamping `marketCode: "TW"` here preserves
  // the pre-KZO-170 semantics for these tests.
  const sampleCatalog: CatalogInstrument[] = [
    { ticker: "2330", name: "台積電", typeRaw: "twse", industryCategoryRaw: "半導體業", finmindDate: "2026-03-31", instrumentType: "STOCK", marketCode: "TW" },
    { ticker: "0050", name: "元大台灣50", typeRaw: "twse", industryCategoryRaw: "ETF", finmindDate: "2026-03-31", instrumentType: "ETF", marketCode: "TW" },
    { ticker: "00679B", name: "元大美債20年", typeRaw: "twse", industryCategoryRaw: "ETF", finmindDate: "2026-03-31", instrumentType: "BOND_ETF", marketCode: "TW" },
    { ticker: "020000", name: "富邦ETN", typeRaw: "twse", industryCategoryRaw: "指數投資證券(ETN)", finmindDate: "2026-03-31", instrumentType: null, marketCode: "TW" },
  ];

  it("upserts catalog instruments with correct columns", async () => {
    const result = await persistence!.upsertInstrumentCatalog(sampleCatalog, []);
    expect(result.upserted).toBe(4);

    const tsmc = await persistence!.getInstrument("2330");
    expect(tsmc).not.toBeNull();
    expect(tsmc!.instrumentType).toBe("STOCK");
    expect(tsmc!.typeRaw).toBe("twse");
    expect(tsmc!.industryCategoryRaw).toBe("半導體業");
    expect(tsmc!.finmindDate).toBe("2026-03-31");
    expect(tsmc!.isProvisional).toBe(false);

    const etn = await persistence!.getInstrument("020000");
    expect(etn).not.toBeNull();
    expect(etn!.instrumentType).toBeNull();
  });

  it("marks delisted instruments", async () => {
    await persistence!.upsertInstrumentCatalog(sampleCatalog, []);

    const delistings: DelistingRecord[] = [
      { ticker: "2330", name: "台積電", date: "2026-01-01" },
      { ticker: "NONEXISTENT", name: "Ghost Co", date: "2025-12-01" },
    ];
    const result = await persistence!.upsertInstrumentCatalog([], delistings);
    expect(result.delisted).toBe(1);

    const tsmc = await persistence!.getInstrument("2330");
    expect(tsmc!.delistedAt).toBeTruthy();
  });

  it("excludes delisted instruments from listInstrumentsCatalog", async () => {
    await persistence!.upsertInstrumentCatalog(sampleCatalog, [
      { ticker: "2330", name: "台積電", date: "2026-01-01" },
    ]);

    const instruments = await persistence!.listInstrumentsCatalog();
    const tickers = instruments.map((instrument) => instrument.ticker);
    expect(tickers).not.toContain("2330");
    // sampleCatalog non-delisted + default seed instruments (0056, 00919)
    expect(tickers).toEqual(["0050", "0056", "00679B", "00919", "020000"]);
  });

  it("keeps search behavior intact after delisted filtering", async () => {
    await persistence!.upsertInstrumentCatalog(sampleCatalog, [
      { ticker: "2330", name: "台積電", date: "2026-01-01" },
    ]);

    const searchResult = await persistence!.listInstrumentsCatalog("元大");
    expect(searchResult.map((instrument) => instrument.ticker)).toEqual(["0050", "00679B"]);

    const delistedSearch = await persistence!.listInstrumentsCatalog("台積");
    expect(delistedSearch).toEqual([]);
  });

  it("upsert is idempotent — no duplicates on repeated sync", async () => {
    await persistence!.upsertInstrumentCatalog(sampleCatalog, []);
    const result2 = await persistence!.upsertInstrumentCatalog(sampleCatalog, []);
    expect(result2.upserted).toBe(4); // All rows affected by ON CONFLICT DO UPDATE

    const instruments = await persistence!.listInstrumentsCatalog();
    const catalogTickers = instruments.filter((i) =>
      sampleCatalog.some((c) => c.ticker === i.ticker),
    );
    expect(catalogTickers).toHaveLength(4);
  });

  it("overwrites provisional instruments with catalog data", async () => {
    // Seed 2330 as provisional first (via the seed defaults)
    const tsmcBefore = await persistence!.getInstrument("2330");
    expect(tsmcBefore).not.toBeNull();
    expect(tsmcBefore!.isProvisional).toBe(false); // seed default is non-provisional

    // Upsert with catalog data
    await persistence!.upsertInstrumentCatalog(sampleCatalog, []);

    const tsmcAfter = await persistence!.getInstrument("2330");
    expect(tsmcAfter!.isProvisional).toBe(false);
    expect(tsmcAfter!.typeRaw).toBe("twse");
    expect(tsmcAfter!.industryCategoryRaw).toBe("半導體業");
  });

  it("allows null instrument_type in instruments table", async () => {
    const nullTypeCatalog: CatalogInstrument[] = [
      { ticker: "TESTX", name: "Test Null Type", typeRaw: "twse", industryCategoryRaw: "存託憑證", finmindDate: "2026-03-31", instrumentType: null, marketCode: "TW" },
    ];
    const result = await persistence!.upsertInstrumentCatalog(nullTypeCatalog, []);
    expect(result.upserted).toBe(1);

    const row = await persistence!.getInstrument("TESTX");
    expect(row).not.toBeNull();
    expect(row!.instrumentType).toBeNull();
  });

  // ── QA coverage gaps ────────────────────────────────────────────────────

  it("preserves bars_backfill_status across catalog re-sync", async () => {
    // First sync — inserts with default bars_backfill_status = 'pending'
    await persistence!.upsertInstrumentCatalog(sampleCatalog, []);

    // Advance backfill status to 'ready'
    await persistence!.updateBackfillStatus("2330", "ready");
    const before = await persistence!.getInstrument("2330");
    expect(before!.barsBackfillStatus).toBe("ready");

    // Re-sync: ON CONFLICT must NOT overwrite bars_backfill_status
    await persistence!.upsertInstrumentCatalog(sampleCatalog, []);

    const after = await persistence!.getInstrument("2330");
    expect(after!.barsBackfillStatus).toBe("ready");
  });

  it("clears is_provisional flag on a truly provisional instrument during catalog sync", async () => {
    // Seed a provisional instrument (e.g. created by ensureInstrumentDefinition on first trade)
    const provisional: InstrumentDef = {
      ticker: "PROVTEST",
      type: "STOCK",
      marketCode: "TW",
      isProvisional: true,
      lastSyncedAt: null,
      typeRaw: null,
      industryCategoryRaw: null,
      finmindDate: null,
    };
    await persistence!.upsertInstruments("user-1", [provisional]);

    const before = await persistence!.getInstrument("PROVTEST");
    expect(before).not.toBeNull();
    expect(before!.isProvisional).toBe(true);
    expect(before!.typeRaw).toBeUndefined();

    // Catalog sync reclassifies it as ETF with full metadata
    await persistence!.upsertInstrumentCatalog([
      { ticker: "PROVTEST", name: "Provisional Test ETF", typeRaw: "tpex", industryCategoryRaw: "上櫃ETF", finmindDate: "2026-03-31", instrumentType: "ETF", marketCode: "TW" },
    ], []);

    const after = await persistence!.getInstrument("PROVTEST");
    expect(after!.isProvisional).toBe(false);
    expect(after!.instrumentType).toBe("ETF");
    expect(after!.typeRaw).toBe("tpex");
    expect(after!.industryCategoryRaw).toBe("上櫃ETF");
  });

  it("rejects trade creation for unclassified instrument (null instrument_type)", async () => {
    // This test uses memory backend: upsertInstruments() puts the null-type InstrumentDef
    // directly into user-1's store. loadStore() returns that store, so ensureInstrumentDefinition
    // finds the existing entry with type=null and the trade guard fires.
    // (Postgres backend is not used here to avoid cross-test Redis URL concerns.)
    const app = await buildApp({ persistenceBackend: "memory" });
    try {
      await app.persistence.upsertInstruments("user-1", [
        { ticker: "020000", type: null, marketCode: "TW", isProvisional: false, lastSyncedAt: null },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/portfolio/transactions",
        headers: { "idempotency-key": "qa-guard-020000" },
        payload: {
          accountId: "acc-1",
          ticker: "020000",
          // KZO-169 (G4): existing TW fixture must stamp marketCode.
          marketCode: "TW",
          quantity: 10,
          unitPrice: 50,
          priceCurrency: "TWD",
          tradeDate: "2026-01-01",
          type: "BUY",
          isDayTrade: false,
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("unclassified_instrument");
    } finally {
      await app.close();
    }
  });
});
