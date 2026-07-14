import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import {
  confirmTradeDividendDeletion,
  previewTradeDividendDeletion,
} from "../../src/services/dividendDestructivePreview.js";
import { createDividendEvent } from "../../src/services/dividends.js";
import { createTransaction } from "../../src/services/portfolio.js";
import { confirmRecompute, previewRecompute } from "../../src/services/recompute.js";
import { replayPositionHistory } from "../../src/services/replayPositionHistory.js";
import type { Store } from "../../src/types/store.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or "
      + "npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migration104Path = path.resolve(
  currentDir,
  "../../../../db/migrations/104_dividend_delete_recompute_history.sql",
);

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

describePostgres("recompute-history durable acceptance (postgres integration)", () => {
  let persistence: PostgresPersistence;
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    pool = new Pool({ connectionString: databaseUrl });
    userId = (await persistence.loadStore("recompute-history-acceptance-user")).userId;
  });

  afterEach(async () => {
    await persistence.close();
    await pool.end();
  });

  async function seedTwoAccountPortfolio(): Promise<Store> {
    const store = await persistence.loadStore(userId);
    const firstAccount = store.accounts[0]!;
    const firstProfile = store.feeProfiles.find((profile) => profile.id === firstAccount.feeProfileId)!;
    const secondAccountId = `${userId}-acc-2`;
    const secondProfileId = `${userId}-fp-2`;

    store.accounts.push({
      ...firstAccount,
      id: secondAccountId,
      name: "Second broker",
      feeProfileId: secondProfileId,
    });
    store.feeProfiles.push({
      ...structuredClone(firstProfile),
      id: secondProfileId,
      accountId: secondAccountId,
      name: "Second broker profile",
      taxRules: firstProfile.taxRules?.map((rule, index) => ({
        ...structuredClone(rule),
        id: `${secondProfileId}:tax-rule:${index + 1}`,
      })),
    });

    createTransaction(store, userId, {
      id: "calculated-trade",
      accountId: firstAccount.id,
      ticker: "2330",
      marketCode: "TW",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-02",
      type: "BUY",
      isDayTrade: false,
    });
    createTransaction(store, userId, {
      id: "manual-zero-trade",
      accountId: firstAccount.id,
      ticker: "2330",
      marketCode: "TW",
      quantity: 5,
      unitPrice: 101,
      priceCurrency: "TWD",
      tradeDate: "2026-01-03",
      commissionAmount: 0,
      taxAmount: 0,
      type: "BUY",
      isDayTrade: false,
    });
    const sourceProvided = createTransaction(store, userId, {
      id: "source-provided-trade",
      accountId: secondAccountId,
      ticker: "2330",
      marketCode: "TW",
      quantity: 7,
      unitPrice: 102,
      priceCurrency: "TWD",
      tradeDate: "2026-01-04",
      commissionAmount: 9,
      taxAmount: 3,
      type: "BUY",
      isDayTrade: false,
    });
    sourceProvided.feesSource = "SOURCE_PROVIDED";
    await persistence.saveStore(store);
    return persistence.loadStore(userId);
  }

  async function accountRevisions(store: Store): Promise<Record<string, number>> {
    return Object.fromEntries(await Promise.all(store.accounts.map(async (account) => [
      account.id,
      await persistence.getAccountAccountingRevision(userId, account.id),
    ] as const)));
  }

  it("[migration and audit persistence]: clean init then migration reruns → provenance and immutable profile JSON round-trip", async () => {
    const migration104 = await fs.readFile(migration104Path, "utf8");
    await pool.query(migration104);
    await pool.query(migration104);

    const seeded = await seedTwoAccountPortfolio();
    expect(seeded.accounting.facts.tradeEvents.map((trade) => ({
      id: trade.id,
      feesSource: trade.feesSource,
      commissionAmount: trade.commissionAmount,
      taxAmount: trade.taxAmount,
    })).sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      expect.objectContaining({ id: "calculated-trade", feesSource: "CALCULATED" }),
      { id: "manual-zero-trade", feesSource: "MANUAL", commissionAmount: 0, taxAmount: 0 },
      { id: "source-provided-trade", feesSource: "SOURCE_PROVIDED", commissionAmount: 9, taxAmount: 3 },
    ]);

    const preview = previewRecompute(seeded, {
      userId,
      useFallbackBindings: true,
      mode: "RECALCULATE_CALCULATED",
      accountRevisions: await accountRevisions(seeded),
      now: new Date("2026-07-14T00:00:00.000Z"),
    });
    await persistence.saveRecomputeJob(preview);

    const roundTripped = await persistence.loadStore(userId);
    const durableJob = roundTripped.recomputeJobs.find((job) => job.id === preview.id)!;
    expect(durableJob).toMatchObject({
      mode: "RECALCULATE_CALCULATED",
      status: "PREVIEWED",
      fingerprint: preview.fingerprint,
      feeConfigFingerprint: preview.feeConfigFingerprint,
      accountRevisions: preview.accountRevisions,
    });
    expect(durableJob.items.map((item) => ({
      tradeEventId: item.tradeEventId,
      feesSource: item.feesSource,
      appliedProfileId: item.appliedProfileId,
      appliedFeeProfile: item.appliedFeeProfile,
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tradeEventId: "calculated-trade",
        feesSource: "CALCULATED",
        appliedProfileId: seeded.accounts[0]!.feeProfileId,
        appliedFeeProfile: expect.objectContaining({ id: seeded.accounts[0]!.feeProfileId }),
      }),
      { tradeEventId: "manual-zero-trade", feesSource: "MANUAL", appliedProfileId: null, appliedFeeProfile: null },
      { tradeEventId: "source-provided-trade", feesSource: "SOURCE_PROVIDED", appliedProfileId: null, appliedFeeProfile: null },
    ]));

    const workingStore = structuredClone(roundTripped);
    const confirmedJob = await confirmRecompute(
      workingStore,
      userId,
      durableJob.id,
      durableJob.fingerprint,
      new Date("2026-07-14T00:01:00.000Z"),
      {
        onRunning: async (runningJob) => {
          expect(await persistence.startRecomputeJob(
            userId,
            runningJob.id,
            runningJob.startedAt!,
          )).toBe(true);
        },
        onFailed: async (failedJob) => {
          await persistence.failRecomputeJob(userId, failedJob.id, {
            completedAt: failedJob.completedAt!,
            errorCode: failedJob.errorCode!,
            errorMessage: failedJob.errorMessage!,
          });
        },
      },
    );
    expect(await persistence.commitRecomputeStore(userId, workingStore.accounting, confirmedJob)).toBe(true);

    const committed = await persistence.loadStore(userId);
    expect(committed.accounting.facts.tradeEvents.map((trade) => ({
      id: trade.id,
      feesSource: trade.feesSource,
      commissionAmount: trade.commissionAmount,
      taxAmount: trade.taxAmount,
    })).sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      expect.objectContaining({ id: "calculated-trade", feesSource: "CALCULATED" }),
      { id: "manual-zero-trade", feesSource: "MANUAL", commissionAmount: 0, taxAmount: 0 },
      { id: "source-provided-trade", feesSource: "SOURCE_PROVIDED", commissionAmount: 9, taxAmount: 3 },
    ]);
    expect(committed.recomputeJobs.find((job) => job.id === durableJob.id)).toMatchObject({
      status: "CONFIRMED",
      items: expect.arrayContaining([
        expect.objectContaining({
          tradeEventId: "calculated-trade",
          appliedFeeProfile: expect.objectContaining({ id: seeded.accounts[0]!.feeProfileId }),
        }),
        expect.objectContaining({ tradeEventId: "manual-zero-trade", feesSource: "MANUAL", appliedProfileId: null,
          appliedFeeProfile: null, previousCommissionAmount: 0, previousTaxAmount: 0,
          nextCommissionAmount: 0, nextTaxAmount: 0, currency: "TWD" }),
        expect.objectContaining({ tradeEventId: "source-provided-trade", feesSource: "SOURCE_PROVIDED", appliedProfileId: null,
          appliedFeeProfile: null, previousCommissionAmount: 9, previousTaxAmount: 3,
          nextCommissionAmount: 9, nextTaxAmount: 3, currency: "TWD" }),
      ]),
    });
  });

  it("[multi-account recompute commit]: later persistence failure then retry → rolls back every scope before committing all scopes", async () => {
    const seeded = await seedTwoAccountPortfolio();
    const preview = previewRecompute(seeded, {
      userId,
      useFallbackBindings: true,
      mode: "KEEP_RECORDED",
      accountRevisions: await accountRevisions(seeded),
    });
    await persistence.saveRecomputeJob(preview);
    expect(await persistence.startRecomputeJob(userId, preview.id, "2026-07-14T00:01:00.000Z")).toBe(true);

    const nextAccounting = structuredClone(seeded.accounting);
    const originalCommissions = Object.fromEntries(nextAccounting.facts.tradeEvents.map((trade) => [
      trade.id,
      trade.commissionAmount,
    ]));
    for (const trade of nextAccounting.facts.tradeEvents) trade.commissionAmount += 1;
    nextAccounting.facts.cashLedgerEntries.push({
      id: "late-scope-invalid-cash",
      userId,
      accountId: seeded.accounts[1]!.id,
      entryDate: "2026-01-05",
      entryType: "TRADE_SETTLEMENT_OUT",
      amount: -1,
      currency: "TWD",
      relatedTradeEventId: "missing-late-scope-trade",
      source: "recompute-atomicity-test",
    });

    await expect(persistence.commitRecomputeStore(userId, nextAccounting, preview)).rejects.toMatchObject({
      code: "23503",
    });
    const afterRollback = await pool.query<{ id: string; commission_amount: string }>(
      `SELECT id, commission_amount::text AS commission_amount
         FROM trade_events
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [Object.keys(originalCommissions)],
    );
    expect(afterRollback.rows).toEqual(Object.keys(originalCommissions).sort().map((id) => ({
      id,
      commission_amount: Number(originalCommissions[id]).toFixed(4),
    })));
    expect((await pool.query<{ status: string }>(
      "SELECT status FROM recompute_jobs WHERE id = $1",
      [preview.id],
    )).rows[0]?.status).toBe("RUNNING");

    nextAccounting.facts.cashLedgerEntries = nextAccounting.facts.cashLedgerEntries.filter(
      (entry) => entry.id !== "late-scope-invalid-cash",
    );
    expect(await persistence.commitRecomputeStore(userId, nextAccounting, {
      ...preview,
      completedAt: "2026-07-14T00:02:00.000Z",
    })).toBe(true);

    const afterCommit = await pool.query<{ id: string; commission_amount: string }>(
      `SELECT id, commission_amount::text AS commission_amount
         FROM trade_events
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [Object.keys(originalCommissions)],
    );
    expect(afterCommit.rows).toEqual(Object.keys(originalCommissions).sort().map((id) => ({
      id,
      commission_amount: (Number(originalCommissions[id]) + 1).toFixed(4),
    })));
    expect((await pool.query<{ status: string; completed_at: Date | null }>(
      "SELECT status, completed_at FROM recompute_jobs WHERE id = $1",
      [preview.id],
    )).rows[0]).toMatchObject({ status: "CONFIRMED", completed_at: expect.any(Date) });
  });

  it("[destructive preview JSONB]: preview round-trip then confirmation → fingerprint remains stable and deletion commits", async () => {
    const store = await persistence.loadStore(userId);
    const account = store.accounts[0]!;
    createTransaction(store, userId, {
      id: "dividend-trade-keep",
      accountId: account.id,
      ticker: "2330",
      marketCode: "TW",
      quantity: 1_000,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-02",
      type: "BUY",
      isDayTrade: false,
    });
    createTransaction(store, userId, {
      id: "dividend-trade-delete",
      accountId: account.id,
      ticker: "2330",
      marketCode: "TW",
      quantity: 500,
      unitPrice: 101,
      priceCurrency: "TWD",
      tradeDate: "2026-01-03",
      type: "BUY",
      isDayTrade: false,
    });
    createDividendEvent(store, {
      id: "dividend-jsonb-roundtrip",
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      stockDistributionAmountRaw: 0,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockParValueAmount: null,
      stockParValueCurrency: null,
      source: "postgres-acceptance",
    });
    await persistence.saveStore(store);
    await replayPositionHistory(persistence, userId, account.id, "2330", { marketCode: "TW" });

    const preview = await previewTradeDividendDeletion(persistence, {
      ownerUserId: userId,
      actorUserId: userId,
      tradeEventId: "dividend-trade-delete",
      reason: "Verify JSONB preview stability",
    });
    const persistedPreview = await persistence.getDividendDestructivePreview(preview.preview.previewId);
    expect(persistedPreview).toMatchObject({
      previewId: preview.preview.previewId,
      previewVersion: preview.preview.previewVersion,
      fingerprint: preview.preview.fingerprint,
      affectedCounts: preview.affectedCounts,
      affectedDividends: preview.affectedDividends,
      reviewedArtifacts: preview.preview.reviewedArtifacts,
    });

    const confirmed = await confirmTradeDividendDeletion(persistence, {
      ownerUserId: userId,
      actorUserId: userId,
      previewId: preview.preview.previewId,
      previewVersion: preview.preview.previewVersion,
      fingerprint: preview.preview.fingerprint,
      tradeEventId: "dividend-trade-delete",
    });
    expect(confirmed.preview).toMatchObject({ consumedResult: "confirmed" });
    expect((await persistence.loadStore(userId)).accounting.facts.tradeEvents.some(
      (trade) => trade.id === "dividend-trade-delete",
    )).toBe(false);
  });
});
