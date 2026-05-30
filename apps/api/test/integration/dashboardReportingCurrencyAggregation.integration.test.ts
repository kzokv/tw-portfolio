/**
 * KZO-180 — Integration tests for the FX-aware dashboard aggregator.
 *
 * Per `.claude/rules/integration-test-persistence-direct.md` we use
 * `PostgresPersistence` directly (NOT `buildApp`) and the FULL pattern with
 * an explicit migration manifest. Real users are seeded via
 * `persistence.resolveOrCreateUser(...)` — no hardcoded actor strings.
 *
 * The CRITICAL case is INT-1: it is the regression guard for D8 (the SQL
 * self-pair guard). Without that guard, every TWD-only user (today: every
 * production user) would see NULL aggregates because the LEFT JOIN LATERAL
 * against `market_data.fx_rates` returns zero rows for `s.currency = $4` and
 * `value * NULL = NULL` propagates into `SUM`.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

const shouldRunPostgresSuite =
  runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

interface SnapshotSeed {
  accountId: string;
  ticker: string;
  date: string; // YYYY-MM-DD
  currency: "TWD" | "USD" | "AUD";
  quantity: number;
  costBasisNative: number;
  valueNative: number;
  unrealizedPnlNative: number;
  cumulativeRealizedPnl: number;
  cumulativeDividends: number;
  closePrice?: number;
  isProvisional?: boolean;
}

describePostgres("dashboard reporting currency aggregation (KZO-180)", () => {
  let pool: Pool;
  let persistence: InstanceType<typeof PostgresPersistence> | null = null;
  let userId: string;

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
        const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(sql);
      }
    } finally {
      client.release();
    }
  }

  async function ensureAccount(accountId: string, currency: "TWD" | "USD" | "AUD" = "TWD") {
    // The post-KZO-183 schema has bidirectional FKs: accounts.fee_profile_id →
    // fee_profiles.id (NOT NULL) AND fee_profiles.account_id → accounts.id (NOT
    // NULL). Both rows must be inserted in a single transaction so the deferred
    // composite-ownership FK fires at COMMIT. Pattern mirrors
    // `kzo183-fee-profile-account-scope.integration.test.ts`.
    const feeProfileId = `${accountId}-fp`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Insert the account first (it references fee_profiles.id, but the FK is
      // deferred to COMMIT and the fee_profile row appears in the next statement).
      await client.query(
        `INSERT INTO accounts (id, user_id, name, fee_profile_id, default_currency, account_type)
         VALUES ($1, $2, $3, $4, $5, 'broker')
         ON CONFLICT (id) DO NOTHING`,
        [accountId, userId, accountId, feeProfileId, currency],
      );
      // Insert the matching fee_profile row.
      await client.query(
        `INSERT INTO fee_profiles (
            id, account_id, name,
            commission_rate_bps, board_commission_rate, commission_discount_percent,
            commission_discount_bps, minimum_commission_amount, commission_currency,
            commission_rounding_mode, tax_rounding_mode,
            stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
            etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps,
            commission_charge_mode
         ) VALUES (
            $1, $2, $3,
            0, 1.425, 0,
            0, 0, $4,
            'FLOOR', 'FLOOR',
            0, 0,
            0, 0,
            'CHARGED_UPFRONT'
         )
         ON CONFLICT (id) DO NOTHING`,
        [feeProfileId, accountId, `${accountId}-fp`, currency],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function seedSnapshots(seeds: ReadonlyArray<SnapshotSeed>): Promise<void> {
    if (seeds.length === 0) return;
    const client = await pool.connect();
    try {
      for (const s of seeds) {
        await client.query(
          `INSERT INTO daily_holding_snapshots (
             id, user_id, account_id, ticker, snapshot_date, quantity,
             close_price, market_value, cost_basis, unrealized_pnl,
             cumulative_realized_pnl, cumulative_dividends,
             is_provisional, currency, generated_at, generation_run_id,
             value_native, cost_basis_native, unrealized_pnl_native, provider_source
           ) VALUES (
             $1, $2, $3, $4, $5::date, $6,
             $7, $8, $9, $10,
             $11, $12,
             $13, $14, NOW(), $15,
             $16, $17, $18, $19
           )
           ON CONFLICT (user_id, account_id, ticker, snapshot_date) DO UPDATE SET
             quantity = EXCLUDED.quantity,
             close_price = EXCLUDED.close_price,
             market_value = EXCLUDED.market_value,
             cost_basis = EXCLUDED.cost_basis,
             unrealized_pnl = EXCLUDED.unrealized_pnl,
             cumulative_realized_pnl = EXCLUDED.cumulative_realized_pnl,
             cumulative_dividends = EXCLUDED.cumulative_dividends,
             is_provisional = EXCLUDED.is_provisional,
             currency = EXCLUDED.currency,
             value_native = EXCLUDED.value_native,
             cost_basis_native = EXCLUDED.cost_basis_native,
             unrealized_pnl_native = EXCLUDED.unrealized_pnl_native,
             provider_source = EXCLUDED.provider_source`,
          [
            randomUUID(),
            userId,
            s.accountId,
            s.ticker,
            s.date,
            s.quantity,
            s.closePrice ?? null,
            // Mirror the snapshot generator's TWD-only legacy convention: the
            // legacy columns track TWD and the native columns track per-currency.
            // For non-TWD seeds we leave the legacy columns equal to the native
            // for shape compatibility — the FX-aware aggregator reads the
            // *_native columns (D8 SQL).
            s.valueNative,
            s.costBasisNative,
            s.unrealizedPnlNative,
            s.cumulativeRealizedPnl,
            s.cumulativeDividends,
            s.isProvisional ?? false,
            s.currency,
            "kzo180-int-run",
            s.valueNative,
            s.costBasisNative,
            s.unrealizedPnlNative,
            "kzo180-int",
          ],
        );
      }
    } finally {
      client.release();
    }
  }

  async function seedFxRate(
    base: "TWD" | "USD" | "AUD",
    quote: "TWD" | "USD" | "AUD",
    date: string,
    rate: number,
  ): Promise<void> {
    await persistence!.upsertFxRates([
      {
        baseCurrency: base,
        quoteCurrency: quote,
        date,
        rate,
        source: "kzo180-int",
      },
    ]);
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({
      databaseUrl: databaseUrl!,
      redisUrl: redisUrl!,
    });
    await persistence.init();
    const owner = await persistence.resolveOrCreateUser(
      "google",
      `kzo180-int-${randomUUID()}-sub`,
      { email: `kzo180-int-${randomUUID()}@example.com`, name: "KZO-180 Integration" },
    );
    userId = owner.userId;
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  // ── INT-1 — D8 SELF-PAIR REGRESSION GUARD (the load-bearing test) ──────────
  it("INT-1 [D8 GUARD]: TWD-only positions, reporting=TWD → SUMs equal native values, fxAvailable=true per row (no FX rates seeded)", async () => {
    // Seed 5 TWD-native daily snapshots with varying values. Crucially we do
    // NOT seed any FX rates. Without the D8 self-pair guard the aggregator's
    // `LEFT JOIN LATERAL` would set every row's `fx.rate IS NULL`, the
    // multiplication `value_native * NULL` would evaluate to NULL, and Postgres
    // `SUM(NULL) = NULL`. This case fails LOUDLY if the guard is removed —
    // every aggregate becomes null and `fxAvailable=false`.
    await ensureAccount("acc-twd", "TWD");
    const seeds: SnapshotSeed[] = [
      { accountId: "acc-twd", ticker: "2330", date: "2026-04-01", currency: "TWD",
        quantity: 100, costBasisNative: 100_000, valueNative: 110_000,
        unrealizedPnlNative: 10_000, cumulativeRealizedPnl: 0, cumulativeDividends: 0 },
      { accountId: "acc-twd", ticker: "2330", date: "2026-04-02", currency: "TWD",
        quantity: 100, costBasisNative: 100_000, valueNative: 112_000,
        unrealizedPnlNative: 12_000, cumulativeRealizedPnl: 0, cumulativeDividends: 0 },
      { accountId: "acc-twd", ticker: "2330", date: "2026-04-03", currency: "TWD",
        quantity: 100, costBasisNative: 100_000, valueNative: 108_000,
        unrealizedPnlNative: 8_000, cumulativeRealizedPnl: 0, cumulativeDividends: 0 },
      { accountId: "acc-twd", ticker: "2330", date: "2026-04-04", currency: "TWD",
        quantity: 100, costBasisNative: 100_000, valueNative: 115_000,
        unrealizedPnlNative: 15_000, cumulativeRealizedPnl: 500, cumulativeDividends: 0 },
      { accountId: "acc-twd", ticker: "2330", date: "2026-04-05", currency: "TWD",
        quantity: 100, costBasisNative: 100_000, valueNative: 120_000,
        unrealizedPnlNative: 20_000, cumulativeRealizedPnl: 500, cumulativeDividends: 1_000 },
    ];
    await seedSnapshots(seeds);

    const points = await persistence!.getAggregatedSnapshotsInReportingCurrency(
      userId,
      "2026-04-01",
      "2026-04-05",
      "TWD",
    );

    expect(points).toHaveLength(5);
    for (let i = 0; i < seeds.length; i += 1) {
      const seed = seeds[i];
      const point = points[i];
      expect(point.date).toBe(seed.date);
      expect(point.fxAvailable).toBe(true);
      expect(point.totalCostBasis).toBeCloseTo(seed.costBasisNative, 2);
      expect(point.totalMarketValue).toBeCloseTo(seed.valueNative, 2);
      expect(point.totalUnrealizedPnl).toBeCloseTo(seed.unrealizedPnlNative, 2);
      expect(point.cumulativeRealizedPnl).toBeCloseTo(seed.cumulativeRealizedPnl, 2);
      expect(point.cumulativeDividends).toBeCloseTo(seed.cumulativeDividends, 2);
    }
  });

  // ── INT-2 — Cross-currency translate-then-sum ──────────────────────────────
  it("INT-2: USD positions, reporting=TWD, USD→TWD FX seeded → aggregator translates correctly per snapshot", async () => {
    await ensureAccount("acc-usd", "USD");
    // 3 USD-native snapshots with USD→TWD FX rate of 30.0 on each date.
    const fxRate = 30.0;
    const seeds: SnapshotSeed[] = [
      { accountId: "acc-usd", ticker: "AAPL", date: "2026-04-01", currency: "USD",
        quantity: 10, costBasisNative: 1_000, valueNative: 1_500,
        unrealizedPnlNative: 500, cumulativeRealizedPnl: 0, cumulativeDividends: 0 },
      { accountId: "acc-usd", ticker: "AAPL", date: "2026-04-02", currency: "USD",
        quantity: 10, costBasisNative: 1_000, valueNative: 1_600,
        unrealizedPnlNative: 600, cumulativeRealizedPnl: 0, cumulativeDividends: 50 },
      { accountId: "acc-usd", ticker: "AAPL", date: "2026-04-03", currency: "USD",
        quantity: 10, costBasisNative: 1_000, valueNative: 1_700,
        unrealizedPnlNative: 700, cumulativeRealizedPnl: 100, cumulativeDividends: 50 },
    ];
    await seedSnapshots(seeds);
    for (const s of seeds) {
      await seedFxRate("USD", "TWD", s.date, fxRate);
    }

    const points = await persistence!.getAggregatedSnapshotsInReportingCurrency(
      userId,
      "2026-04-01",
      "2026-04-03",
      "TWD",
    );

    expect(points).toHaveLength(3);
    for (let i = 0; i < seeds.length; i += 1) {
      const seed = seeds[i];
      const point = points[i];
      expect(point.fxAvailable).toBe(true);
      expect(point.totalCostBasis).toBeCloseTo(seed.costBasisNative * fxRate, 2);
      expect(point.totalMarketValue).toBeCloseTo(seed.valueNative * fxRate, 2);
      expect(point.totalUnrealizedPnl).toBeCloseTo(seed.unrealizedPnlNative * fxRate, 2);
      expect(point.cumulativeRealizedPnl).toBeCloseTo(seed.cumulativeRealizedPnl * fxRate, 2);
      expect(point.cumulativeDividends).toBeCloseTo(seed.cumulativeDividends * fxRate, 2);
    }
  });

  // ── INT-3 — Missing FX → null SUMs + fxAvailable=false ─────────────────────
  it("INT-3: USD position, reporting=TWD, NO FX rate seeded → fxAvailable=false and translated SUMs degrade to null", async () => {
    await ensureAccount("acc-usd", "USD");
    await seedSnapshots([
      { accountId: "acc-usd", ticker: "AAPL", date: "2026-04-10", currency: "USD",
        quantity: 5, costBasisNative: 500, valueNative: 600,
        unrealizedPnlNative: 100, cumulativeRealizedPnl: 0, cumulativeDividends: 0 },
    ]);
    // NO FX rate seeded — `getFxRate(USD, TWD, 2026-04-10)` returns null.

    const points = await persistence!.getAggregatedSnapshotsInReportingCurrency(
      userId,
      "2026-04-10",
      "2026-04-10",
      "TWD",
    );

    expect(points).toHaveLength(1);
    const [point] = points;
    expect(point.fxAvailable).toBe(false);
    // Per the aggregator's null-coalescing contract: `totalMarketValue` and
    // `totalUnrealizedPnl` are `number | null` and degrade to null.
    // `totalCostBasis`, `cumulativeRealizedPnl`, `cumulativeDividends` are
    // `number` (non-null in the persistence DTO) and coerce to 0 for type
    // compat — the route layer maps them back to null on the wire DTO when
    // `fxAvailable === false`. We assert both contracts here.
    expect(point.totalMarketValue).toBeNull();
    expect(point.totalUnrealizedPnl).toBeNull();
    expect(point.totalReturnAmount).toBeNull();
    expect(point.totalReturnPercent).toBeNull();
    expect(point.totalCostBasis).toBe(0);
    expect(point.cumulativeRealizedPnl).toBe(0);
    expect(point.cumulativeDividends).toBe(0);
  });

  // ── INT-4 — Forward-fill from older FX row ─────────────────────────────────
  it("INT-4: USD position on day N, USD→TWD FX seeded only on day N-5 → forward-filled rate is used", async () => {
    await ensureAccount("acc-usd", "USD");
    // Snapshot on 2026-04-15. FX seeded only on 2026-04-10. forward-fill
    // semantics in `getFxRate` (and the LATERAL JOIN's `date <= s.snapshot_date
    // ORDER BY date DESC LIMIT 1`) should return the older rate.
    await seedSnapshots([
      { accountId: "acc-usd", ticker: "AAPL", date: "2026-04-15", currency: "USD",
        quantity: 10, costBasisNative: 1_000, valueNative: 1_200,
        unrealizedPnlNative: 200, cumulativeRealizedPnl: 0, cumulativeDividends: 0 },
    ]);
    const oldRate = 31.5;
    await seedFxRate("USD", "TWD", "2026-04-10", oldRate);

    const points = await persistence!.getAggregatedSnapshotsInReportingCurrency(
      userId,
      "2026-04-15",
      "2026-04-15",
      "TWD",
    );

    expect(points).toHaveLength(1);
    const [point] = points;
    expect(point.fxAvailable).toBe(true);
    expect(point.totalCostBasis).toBeCloseTo(1_000 * oldRate, 2);
    expect(point.totalMarketValue).toBeCloseTo(1_200 * oldRate, 2);
    expect(point.totalUnrealizedPnl).toBeCloseTo(200 * oldRate, 2);
  });

  // ── INT-5 — Mixed-currency aggregation on the same day ─────────────────────
  it("INT-5: TWD + USD positions same day, reporting=TWD, USD→TWD FX seeded → aggregator sums TWD_native + USD_native * fx", async () => {
    await ensureAccount("acc-twd", "TWD");
    await ensureAccount("acc-usd", "USD");
    const fxRate = 30.0;
    const date = "2026-04-20";
    const twd: SnapshotSeed = {
      accountId: "acc-twd", ticker: "2330", date, currency: "TWD",
      quantity: 50, costBasisNative: 50_000, valueNative: 55_000,
      unrealizedPnlNative: 5_000, cumulativeRealizedPnl: 0, cumulativeDividends: 0,
    };
    const usd: SnapshotSeed = {
      accountId: "acc-usd", ticker: "AAPL", date, currency: "USD",
      quantity: 10, costBasisNative: 1_000, valueNative: 1_500,
      unrealizedPnlNative: 500, cumulativeRealizedPnl: 0, cumulativeDividends: 0,
    };
    await seedSnapshots([twd, usd]);
    await seedFxRate("USD", "TWD", date, fxRate);

    const points = await persistence!.getAggregatedSnapshotsInReportingCurrency(
      userId,
      date,
      date,
      "TWD",
    );

    expect(points).toHaveLength(1);
    const [point] = points;
    expect(point.fxAvailable).toBe(true);
    expect(point.totalCostBasis).toBeCloseTo(twd.costBasisNative + usd.costBasisNative * fxRate, 2);
    expect(point.totalMarketValue).toBeCloseTo(twd.valueNative + usd.valueNative * fxRate, 2);
    expect(point.totalUnrealizedPnl).toBeCloseTo(twd.unrealizedPnlNative + usd.unrealizedPnlNative * fxRate, 2);
  });

  // ── INT-6 — Mixed-currency partial FX → fxAvailable=false ──────────────────
  it("INT-6: TWD + AUD positions same day, reporting=TWD, AUD→TWD FX missing → fxAvailable=false (bool_and semantics)", async () => {
    await ensureAccount("acc-twd", "TWD");
    await ensureAccount("acc-aud", "AUD");
    const date = "2026-04-22";
    await seedSnapshots([
      { accountId: "acc-twd", ticker: "2330", date, currency: "TWD",
        quantity: 50, costBasisNative: 50_000, valueNative: 55_000,
        unrealizedPnlNative: 5_000, cumulativeRealizedPnl: 0, cumulativeDividends: 0 },
      { accountId: "acc-aud", ticker: "BHP.AX", date, currency: "AUD",
        quantity: 100, costBasisNative: 4_000, valueNative: 4_500,
        unrealizedPnlNative: 500, cumulativeRealizedPnl: 0, cumulativeDividends: 0 },
    ]);
    // NO AUD→TWD FX seeded; TWD→TWD self-pair handled by D8 guard.

    const points = await persistence!.getAggregatedSnapshotsInReportingCurrency(
      userId,
      date,
      date,
      "TWD",
    );

    expect(points).toHaveLength(1);
    const [point] = points;
    // Per Postgres `bool_and(s.currency = $4 OR fx.rate IS NOT NULL)`: a
    // single contributor with no rate flips the row-level flag to false even
    // when sibling contributors are self-pair. The flag is the load-bearing
    // signal here — consumers MUST gate rendering on fxAvailable.
    expect(point.fxAvailable).toBe(false);

    // KZO-180 review M1: persistence mapper coerces ALL aggregates when
    // fxAvailable=false. Postgres `SUM(...)` ignores NULL multiplications and
    // would otherwise leak a partial self-pair sum (e.g. only the TWD half).
    // The persistence DTO mapper now mirrors the memory backend by zeroing
    // the non-null fields and nulling the nullable fields — the wire layer
    // (`dashboardReportingCurrency.ts`) further nulls everything on the wire,
    // but persistence-DTO consumers (KZO-176, internal reports) see a
    // backend-consistent shape.
    expect(point.totalMarketValue).toBeNull();
    expect(point.totalUnrealizedPnl).toBeNull();
    expect(point.totalReturnAmount).toBeNull();
    expect(point.totalReturnPercent).toBeNull();
    // Non-null persistence-DTO fields coerced to 0 (no partial-sum leak).
    expect(point.totalCostBasis).toBe(0);
    expect(point.cumulativeRealizedPnl).toBe(0);
    expect(point.cumulativeDividends).toBe(0);
  });
});
