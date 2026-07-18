import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import {
  confirmPostedTransactionMutation,
  getPostedTransactionMutationRun,
  previewPostedTransactionDeleteBatch,
} from "../../src/services/postedTransactionMutations.js";
import { createTransaction } from "../../src/services/portfolio.js";

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

describePostgres("posted transaction mutation replay persistence (postgres integration)", () => {
  let persistence: PostgresPersistence;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("confirms deletion mutations through the durable replay preview/run schema", async () => {
    const ownerUserId = (await persistence.loadStore("posted-mutation-owner")).userId;
    await persistence.loadStore("posted-mutation-delegate");
    const store = await persistence.loadStore(ownerUserId);

    createTransaction(store, ownerUserId, {
      id: "pg-trade-1",
      accountId: store.accounts[0]!.id,
      ticker: "2330",
      marketCode: "TW",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-02",
      type: "BUY",
      isDayTrade: false,
    });
    createTransaction(store, ownerUserId, {
      id: "pg-trade-2",
      accountId: store.accounts[0]!.id,
      ticker: "2330",
      marketCode: "TW",
      quantity: 5,
      unitPrice: 200,
      priceCurrency: "TWD",
      tradeDate: "2026-01-03",
      type: "BUY",
      isDayTrade: false,
    });
    await persistence.saveStore(store);
    await persistence.saveAiTransactionDraftBatch({
      id: "pg-batch-1",
      ownerUserId,
      createdByUserId: ownerUserId,
      sourceChannel: "mcp",
      status: "open",
      version: 1,
      rowCount: 2,
      unsupportedCount: 0,
    });
    await persistence.saveAiTransactionDraftRow({
      id: "pg-row-1",
      batchId: "pg-batch-1",
      ownerUserId,
      rowNumber: 1,
      state: "confirmed",
      version: 1,
      accountId: store.accounts[0]!.id,
      accountNameInput: store.accounts[0]!.name,
      tradeType: "BUY",
      ticker: "2330",
      marketCode: "TW",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-02",
      tradeTimestamp: "2026-01-02T00:00:00.000Z",
      bookingSequence: 1,
      isDayTrade: false,
      commissionAmount: 0,
      taxAmount: 0,
      feesSource: "CALCULATED",
      confirmedTradeEventId: "pg-trade-1",
      confirmedAt: "2026-01-02T00:00:00.000Z",
      confirmedByUserId: ownerUserId,
    });
    await persistence.saveAiTransactionDraftRow({
      id: "pg-row-2",
      batchId: "pg-batch-1",
      ownerUserId,
      rowNumber: 2,
      state: "confirmed",
      version: 1,
      accountId: store.accounts[0]!.id,
      accountNameInput: store.accounts[0]!.name,
      tradeType: "BUY",
      ticker: "2330",
      marketCode: "TW",
      quantity: 5,
      unitPrice: 200,
      priceCurrency: "TWD",
      tradeDate: "2026-01-03",
      tradeTimestamp: "2026-01-03T00:00:00.000Z",
      bookingSequence: 1,
      isDayTrade: false,
      commissionAmount: 0,
      taxAmount: 0,
      feesSource: "CALCULATED",
      confirmedTradeEventId: "pg-trade-2",
      confirmedAt: "2026-01-03T00:00:00.000Z",
      confirmedByUserId: ownerUserId,
    });

    const preview = await previewPostedTransactionDeleteBatch(persistence, {
      ownerUserId,
      actorUserId: "posted-mutation-delegate",
      reason: "Durable delete replay",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: "pg-trade-1" }],
    });

    const confirmationInput = {
      ownerUserId,
      actorUserId: "posted-mutation-delegate",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: "delete",
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    } as const;
    const [run, identicalRetry] = await Promise.all([
      confirmPostedTransactionMutation(persistence, confirmationInput),
      confirmPostedTransactionMutation(persistence, confirmationInput),
    ]);
    expect(identicalRetry.runId).toBe(run.runId);

    await expect(getPostedTransactionMutationRun(persistence, {
      ownerUserId,
      actorUserId: "posted-mutation-delegate",
      runId: run.runId,
      appBaseUrl: "http://localhost",
    })).resolves.toMatchObject({
      runId: run.runId,
      previewId: preview.previewId,
    });

    const replayPreview = await persistence.getMcpReplayPreview(preview.previewId);
    expect(replayPreview).toMatchObject({
      id: preview.previewId,
      sessionUserId: "posted-mutation-delegate",
      portfolioContextUserId: ownerUserId,
    });

    const replayRun = await persistence.getMcpReplayRun(run.runId);
    expect(replayRun?.previewId).toBe(preview.previewId);
    expect(replayRun?.scopes[0]).toMatchObject({
      accountId: store.accounts[0]!.id,
      ticker: "2330",
      marketCode: "TW",
      earliestReplayDate: "2026-01-02",
      deletedTradeEventIds: ["pg-trade-1"],
    });
    await expect(persistence.listPostedTransactionMutationDeletedDraftLineage(ownerUserId, ["pg-trade-1"])).resolves.toMatchObject([{
      tradeEventId: "pg-trade-1",
      batchId: "pg-batch-1",
      rowId: "pg-row-1",
      mutationRunId: run.runId,
    }]);
    await expect(persistence.listPostedTransactionMutationDeletedDraftLineage(
      ownerUserId,
      [],
      ["pg-row-1"],
    )).resolves.toMatchObject([{
      tradeEventId: "pg-trade-1",
      rowId: "pg-row-1",
      mutationRunId: run.runId,
    }]);

    const updatedDraftBatch = await persistence.getAiTransactionDraftBatch("pg-batch-1");
    expect(updatedDraftBatch?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pg-row-1", confirmedTradeEventId: null }),
      expect.objectContaining({ id: "pg-row-2", confirmedTradeEventId: "pg-trade-2" }),
    ]));
  });
});
