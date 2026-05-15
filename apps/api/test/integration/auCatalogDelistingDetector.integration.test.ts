/**
 * KZO-195 — Postgres-direct integration tests for the AU diff-based delisting
 * detector wired through `PostgresPersistence.upsertInstrumentCatalog` with
 * the new `absenceDetection` callback (per scope-todo Phase 5 / C1-a).
 *
 * Test cases (per scope-todo Phase 9 Suite 5):
 *   [T1] real-delisting case: 3-run streak → `delisted_at` stamped + audit row
 *   [T2] mass-delisting safety: trip → upserts committed, no streak bump,
 *        no stamp, admin notification queued
 *   [T3] LIC absence: row with `last_seen_in_catalog_at IS NULL` never
 *        gets candidate-flagged
 *   [T4] reversal — undelete: clears `delisted_at`, resets streak,
 *        sets `last_seen_in_catalog_at`
 *   [T5] reversal — exclude: flips `delisting_detection_excluded` flag
 *
 * Per `.claude/rules/integration-test-persistence-direct.md`:
 *   - Uses `PostgresPersistence` directly (NOT `buildApp`).
 *   - Full pattern: scoped `Pool` + explicit `applyNumberedMigrations`.
 *   - All raw SQL is schema-qualified `market_data.instruments`.
 *
 * Per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`:
 *   - Uses synthetic prefix `AUDEL01..N` (reserved for KZO-195 test surface).
 *
 * NOTE (TDD-RED): the `absenceDetection` option on `upsertInstrumentCatalog`
 * does NOT yet exist when this file lands — Backend Implementer adds it in
 * Phase 5. The undelete/exclude assertions exercise persistence helpers also
 * pending in Phase 5+7. Tests fail with type or runtime errors until the
 * backend lands the contract.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { detectDelistingsByAbsence, type AbsentRow } from "../../src/services/market-data/detectDelistingsByAbsence.js";
import { runCatalogSync } from "../../src/services/market-data/runCatalogSync.js";
import type { InstrumentCatalogProvider, RawInstrumentInfo } from "../../src/services/market-data/types.js";
import type { CatalogInstrument, DelistingRecord } from "../../src/persistence/types.js";

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

/**
 * Build CatalogInstrument rows for AU. AUDEL01..N synthetic tickers.
 */
function makeCatalog(tickers: string[]): CatalogInstrument[] {
  return tickers.map<CatalogInstrument>((t) => ({
    ticker: t,
    name: `AU Delisting Detector Fixture ${t}`,
    instrumentType: "STOCK",
    marketCode: "AU",
    typeRaw: "stocks",
    industryCategoryRaw: "Common Stock",
    finmindDate: "2026-05-09",
  }));
}

describePostgres("KZO-195 — AU diff-based delisting detector (Postgres-direct)", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;
  let actorUserId: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyNumberedMigrations(pool);
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    // Seed an admin actor for any audit_log writes the persistence layer makes.
    const { userId } = await persistence.resolveOrCreateUser(
      "google",
      "kzo195-detector-admin-sub",
      { email: "kzo195-detector-admin@example.com", name: "Detector Admin" },
    );
    actorUserId = userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  /**
   * Helper — read AU instrument absence/delisting columns for assertions.
   */
  async function readAuInstruments(): Promise<
    Array<{
      ticker: string;
      delisted_at: Date | null;
      absence_streak: number;
      last_seen_in_catalog_at: Date | null;
      delisting_detection_excluded: boolean;
      status_reason: string | null;
    }>
  > {
    const { rows } = await pool.query(
      `SELECT ticker, delisted_at, absence_streak, last_seen_in_catalog_at,
              delisting_detection_excluded, status_reason
       FROM market_data.instruments
       WHERE market_code = 'AU'
       ORDER BY ticker ASC`,
    );
    return rows;
  }

  it(
    "[T1] real-delisting case: 3-run streak stamps delisted_at and writes audit row",
    async () => {
      const fullCatalog = makeCatalog(["AUDEL01", "AUDEL02", "AUDEL03", "AUDEL04", "AUDEL05"]);
      // Run 0 — full catalog, all present. last_seen stamped, streak=0 for everyone.
      await persistence!.upsertInstrumentCatalog(
        fullCatalog,
        [] as DelistingRecord[],
        {
          absenceDetection: {
            marketCode: "AU",
            categorize: (absent: AbsentRow[], prev: number) =>
              detectDelistingsByAbsence(absent, {
                threshold: 3,
                guardPercent: 1.0,
                guardFloor: 5,
                prevCatalogSize: prev,
              }),
          },
        } as never,
      );

      // Drop AUDEL05 from the catalog. Run it 3 times — streak should bump,
      // and on the 3rd run AUDEL05 should be stamped as delisted.
      const droppedCatalog = makeCatalog(["AUDEL01", "AUDEL02", "AUDEL03", "AUDEL04"]);
      let lastResult: { delisted: number; absent: number; guardTripped: boolean } | null = null;
      for (let i = 0; i < 3; i++) {
        // Force last_seen_in_catalog_at into the past so absence is detectable
        // (the persistence layer's "absent if last_seen_in_catalog_at < NOW()"
        // predicate requires sub-second clock advance; emulate via SQL).
        await pool.query(
          `UPDATE market_data.instruments
           SET last_seen_in_catalog_at = last_seen_in_catalog_at - INTERVAL '1 day'
           WHERE market_code = 'AU' AND ticker = 'AUDEL05'`,
        );
        const result = (await persistence!.upsertInstrumentCatalog(
          droppedCatalog,
          [] as DelistingRecord[],
          {
            absenceDetection: {
              marketCode: "AU",
              categorize: (absent: AbsentRow[], prev: number) =>
                detectDelistingsByAbsence(absent, {
                  threshold: 3,
                  guardPercent: 1.0,
                  guardFloor: 5,
                  prevCatalogSize: prev,
                }),
            },
          } as never,
        )) as unknown as { delisted: number; absent: number; guardTripped: boolean };
        lastResult = result;
      }

      const auRows = await readAuInstruments();
      const audel05 = auRows.find((r) => r.ticker === "AUDEL05");
      expect(audel05).toBeDefined();
      expect(audel05!.delisted_at).not.toBeNull();
      expect(audel05!.status_reason).toBe("absence_detected");

      // CatalogSyncResult contract per scope-todo Phase 1.
      expect(lastResult).toBeTruthy();
      expect(lastResult!.guardTripped).toBe(false);

      // Audit row written for the absence-detected stamp.
      const { rows: auditRows } = await pool.query(
        `SELECT action, metadata FROM audit_log
         WHERE action IN ('instrument_delisted_via_absence', 'instrument_absence_streak_bumped')
         ORDER BY created_at ASC`,
      );
      const stampAudit = auditRows.find(
        (r: { action: string; metadata: { ticker?: string } }) =>
          r.action === "instrument_delisted_via_absence"
          && r.metadata?.ticker === "AUDEL05",
      );
      expect(stampAudit).toBeDefined();
    },
    30_000,
  );

  it(
    "[T2] mass-delisting safety: trip → upserts committed, no streak bump, no stamp",
    async () => {
      // Seed a 10-row AU catalog so the absence guard floor (5) dominates over
      // 1.0% of 10 = 0.1.
      const baseTickers = Array.from({ length: 10 }, (_, i) =>
        `AUDEL${String(i + 1).padStart(2, "0")}`,
      );
      await persistence!.upsertInstrumentCatalog(
        makeCatalog(baseTickers),
        [],
        {
          absenceDetection: {
            marketCode: "AU",
            categorize: (absent: AbsentRow[], prev: number) =>
              detectDelistingsByAbsence(absent, {
                threshold: 3,
                guardPercent: 1.0,
                guardFloor: 5,
                prevCatalogSize: prev,
              }),
          },
        } as never,
      );

      // Drop 6 tickers (AUDEL05..AUDEL10) so 6 candidates > floor 5 → guard trips.
      const survivors = ["AUDEL01", "AUDEL02", "AUDEL03", "AUDEL04"];
      // Force timestamps into the past so absence is detectable in same-tx semantics.
      await pool.query(
        `UPDATE market_data.instruments
         SET last_seen_in_catalog_at = last_seen_in_catalog_at - INTERVAL '1 day'
         WHERE market_code = 'AU'`,
      );

      // Add a fresh row to the survivors catalog (AUDEL11) to verify upserts
      // commit even when the guard trips.
      const survivorCatalog = [...makeCatalog(survivors), ...makeCatalog(["AUDEL11"])];
      const result = (await persistence!.upsertInstrumentCatalog(
        survivorCatalog,
        [],
        {
          absenceDetection: {
            marketCode: "AU",
            categorize: (absent: AbsentRow[], prev: number) =>
              detectDelistingsByAbsence(absent, {
                threshold: 3,
                guardPercent: 1.0,
                guardFloor: 5,
                prevCatalogSize: prev,
              }),
          },
        } as never,
      )) as unknown as {
        upserted: number;
        delisted: number;
        absent: number;
        guardTripped: boolean;
        absentTickers: string[];
      };

      // Guard tripped, no stamp, no streak bump.
      expect(result.guardTripped).toBe(true);
      expect(result.delisted).toBe(0);
      expect(result.absentTickers).toEqual(
        expect.arrayContaining(["AUDEL05", "AUDEL06", "AUDEL07", "AUDEL08", "AUDEL09", "AUDEL10"]),
      );

      const auRows = await readAuInstruments();
      // None of the dropped rows received delisted_at or a streak bump.
      const droppedRows = auRows.filter((r) =>
        ["AUDEL05", "AUDEL06", "AUDEL07", "AUDEL08", "AUDEL09", "AUDEL10"].includes(r.ticker),
      );
      for (const r of droppedRows) {
        expect(r.delisted_at).toBeNull();
        expect(r.absence_streak).toBe(0);
      }
      // Upserts DID commit — AUDEL11 is present.
      expect(auRows.find((r) => r.ticker === "AUDEL11")).toBeDefined();

      // Guard-tripped audit row.
      const { rows: auditRows } = await pool.query(
        `SELECT action FROM audit_log WHERE action = 'instrument_absence_guard_tripped'`,
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );

  it(
    "[T3] LIC absence: row with last_seen_in_catalog_at IS NULL never candidate",
    async () => {
      // Seed AUDEL20 directly with last_seen_in_catalog_at = NULL (LIC pattern:
      // metadata-only row that has never appeared in the catalog).
      await pool.query(
        `INSERT INTO market_data.instruments
           (ticker, market_code, name, instrument_type, last_seen_in_catalog_at,
            absence_streak, delisting_detection_excluded)
         VALUES
           ('AUDEL20', 'AU', 'AU LIC fixture', 'STOCK', NULL, 0, FALSE)`,
      );

      // Run a sync where AUDEL20 is absent from the provider catalog.
      const presentCatalog = makeCatalog(["AUDEL01", "AUDEL02", "AUDEL03"]);
      await persistence!.upsertInstrumentCatalog(
        presentCatalog,
        [],
        {
          absenceDetection: {
            marketCode: "AU",
            categorize: (absent: AbsentRow[], prev: number) =>
              detectDelistingsByAbsence(absent, {
                threshold: 3,
                guardPercent: 1.0,
                guardFloor: 5,
                prevCatalogSize: prev,
              }),
          },
        } as never,
      );

      const auRows = await readAuInstruments();
      const audel20 = auRows.find((r) => r.ticker === "AUDEL20");
      expect(audel20).toBeDefined();
      expect(audel20!.last_seen_in_catalog_at).toBeNull();
      expect(audel20!.absence_streak).toBe(0);
      expect(audel20!.delisted_at).toBeNull();
    },
    30_000,
  );

  it(
    "[T4] reversal — undelete clears delisted_at, resets streak, sets last_seen_in_catalog_at",
    async () => {
      // Seed AUDEL30 already-delisted with streak=3 + null last_seen.
      await pool.query(
        `INSERT INTO market_data.instruments
           (ticker, market_code, name, instrument_type, delisted_at,
            status_reason, absence_streak, last_seen_in_catalog_at,
            delisting_detection_excluded)
         VALUES
           ('AUDEL30', 'AU', 'AU undelete fixture', 'STOCK',
            NOW() - INTERVAL '1 hour', 'absence_detected', 3, NULL, FALSE)`,
      );

      // Persistence helper: undelete (Phase 7 backend route writes audit_log
      // via this path — the persistence layer exposes the primitive).
      await (persistence as unknown as {
        undeleteInstrument(
          ticker: string,
          marketCode: string,
          actorUserId: string,
        ): Promise<void>;
      }).undeleteInstrument("AUDEL30", "AU", actorUserId);

      const auRows = await readAuInstruments();
      const audel30 = auRows.find((r) => r.ticker === "AUDEL30");
      expect(audel30).toBeDefined();
      expect(audel30!.delisted_at).toBeNull();
      expect(audel30!.absence_streak).toBe(0);
      expect(audel30!.last_seen_in_catalog_at).not.toBeNull();

      // Audit row for the undelete action.
      const { rows: auditRows } = await pool.query(
        `SELECT action, metadata FROM audit_log
         WHERE action = 'instrument_undelete' AND actor_user_id = $1`,
        [actorUserId],
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );

  it(
    "[T5] reversal — exclude flips delisting_detection_excluded",
    async () => {
      // Seed AUDEL31 with a normal in-catalog state.
      await pool.query(
        `INSERT INTO market_data.instruments
           (ticker, market_code, name, instrument_type, last_seen_in_catalog_at,
            absence_streak, delisting_detection_excluded)
         VALUES
           ('AUDEL31', 'AU', 'AU exclude fixture', 'STOCK',
            NOW(), 0, FALSE)`,
      );

      await (persistence as unknown as {
        setInstrumentDelistingDetectionExcluded(
          ticker: string,
          marketCode: string,
          excluded: boolean,
          actorUserId: string,
        ): Promise<void>;
      }).setInstrumentDelistingDetectionExcluded("AUDEL31", "AU", true, actorUserId);

      let auRows = await readAuInstruments();
      let audel31 = auRows.find((r) => r.ticker === "AUDEL31");
      expect(audel31).toBeDefined();
      expect(audel31!.delisting_detection_excluded).toBe(true);

      // Toggle back to false.
      await (persistence as unknown as {
        setInstrumentDelistingDetectionExcluded(
          ticker: string,
          marketCode: string,
          excluded: boolean,
          actorUserId: string,
        ): Promise<void>;
      }).setInstrumentDelistingDetectionExcluded("AUDEL31", "AU", false, actorUserId);

      auRows = await readAuInstruments();
      audel31 = auRows.find((r) => r.ticker === "AUDEL31");
      expect(audel31!.delisting_detection_excluded).toBe(false);

      const { rows: auditRows } = await pool.query(
        `SELECT action FROM audit_log
         WHERE action = 'instrument_exclusion_toggle' AND actor_user_id = $1`,
        [actorUserId],
      );
      expect(auditRows.length).toBeGreaterThanOrEqual(2);
    },
    30_000,
  );
});

/**
 * KZO-195 Iter 9 (Codex P1) — companion test for the `absenceDetectionEnabled`
 * gate inside `runCatalogSync`.
 *
 * The Codex P1 fix introduced a third branch in `runCatalogSync`:
 *   1. supportsDelistingFeed=true → provider-feed path (TW today)
 *   2. supportsDelistingFeed=false && absenceDetectionEnabled=true → AU diff
 *   3. supportsDelistingFeed=false && absenceDetectionEnabled=false → bare upsert
 *
 * Branch 3 (the new one — covers FinMind US, Yahoo AU) MUST NOT stamp
 * absence-detection columns. Without the gate, present rows would gain
 * `last_seen_in_catalog_at` and dropped rows would bump `absence_streak`,
 * even though no detector was wired in for those markets. This test exercises
 * branch 3 directly.
 *
 * Assertion shape: a mock US-market provider with both flags false runs
 * through `runCatalogSync` four times, including two runs where a ticker is
 * dropped to simulate absence. After all runs, every persisted row keeps
 * `absence_streak = 0` and `last_seen_in_catalog_at IS NULL` — proving the
 * absence-detection branch never engaged.
 *
 * Tickers `USFEED01..03` are KZO-195 reservations (zero prior collisions
 * per ticker-hygiene grep at write time).
 */
function makeBareUpsertProviderMock(
  catalogPerCall: RawInstrumentInfo[][],
): InstrumentCatalogProvider {
  let call = 0;
  return {
    providerId: "kzo195-bare-upsert-provider-mock",
    supportsDelistingFeed: false,
    absenceDetectionEnabled: false,
    supportsMetadataEnrichment: false,
    fetchInstrumentCatalog: async () => {
      const idx = Math.min(call, catalogPerCall.length - 1);
      call += 1;
      return catalogPerCall[idx]!;
    },
    fetchDelistingHistory: async () => [],
    fetchInstrumentMetadata: async () => null,
    searchInstruments: async () => [],
    reserveCapacity: () => {},
  } as InstrumentCatalogProvider;
}

describePostgres(
  "KZO-195 Iter 9 — absenceDetectionEnabled=false providers skip absence stamping",
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

    async function readUsBareInstruments(): Promise<
      Array<{
        ticker: string;
        absence_streak: number;
        last_seen_in_catalog_at: Date | null;
        delisted_at: Date | null;
      }>
    > {
      const { rows } = await pool.query(
        `SELECT ticker, absence_streak, last_seen_in_catalog_at, delisted_at
         FROM market_data.instruments
         WHERE market_code = 'US' AND ticker LIKE 'USFEED%'
         ORDER BY ticker ASC`,
      );
      return rows;
    }

    it(
      "[BARE-1] absenceDetectionEnabled=false: present rows stay absence_streak=0 + last_seen_in_catalog_at NULL across multiple syncs (incl. dropped ticker)",
      async () => {
        // US-market RawInstrumentInfo fixture. The US classifier defaults any
        // non-null `industryCategory` to STOCK, so an "Industrial" stub row
        // routes cleanly through `runCatalogSync`. Tickers `USFEED01..03` are
        // KZO-195 reservations (zero prior collisions per ticker hygiene).
        const baseRows: RawInstrumentInfo[] = [
          { ticker: "USFEED01", name: "Bare Upsert Fixture 01", typeRaw: "us", industryCategory: "Industrial", date: "2026-05-09" },
          { ticker: "USFEED02", name: "Bare Upsert Fixture 02", typeRaw: "us", industryCategory: "Industrial", date: "2026-05-09" },
          { ticker: "USFEED03", name: "Bare Upsert Fixture 03", typeRaw: "us", industryCategory: "Industrial", date: "2026-05-09" },
        ];
        // Runs 1+2: full catalog. Runs 3+4: USFEED03 dropped — simulating
        // absence that the AU-detector path would normally turn into a streak.
        // Branch 3 (this test's branch) MUST stay quiet.
        const droppedRows = baseRows.slice(0, 2);
        const provider = makeBareUpsertProviderMock([
          baseRows,
          baseRows,
          droppedRows,
          droppedRows,
        ]);

        const log = { info: () => {}, warn: () => {}, error: () => {} };
        for (let i = 0; i < 4; i++) {
          await runCatalogSync({
            catalogProvider: provider,
            marketCode: "US",
            persistence: persistence!,
            log,
          });
        }

        const rows = await readUsBareInstruments();
        // Sanity: all three rows landed via the bare-upsert (branch 3) path.
        expect(rows.map((r) => r.ticker)).toEqual(["USFEED01", "USFEED02", "USFEED03"]);
        for (const r of rows) {
          // Core invariant: branch 3 NEVER stamps absence columns, even after
          // the dropped-ticker simulation. If the `absenceDetectionEnabled`
          // gate regresses, USFEED03 would have `absence_streak >= 1` or
          // `last_seen_in_catalog_at` populated, and the assertion below would
          // fail.
          expect(r.absence_streak).toBe(0);
          expect(r.last_seen_in_catalog_at).toBeNull();
          expect(r.delisted_at).toBeNull();
        }
      },
      45_000,
    );
  },
);
