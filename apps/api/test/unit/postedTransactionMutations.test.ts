import { describe, expect, it, vi } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  confirmPostedTransactionMutation,
  dispatchPostedTransactionMutationRebuild,
  getPostedTransactionMutationPreview,
  getPostedTransactionMutationRun,
  previewPostedTransactionDeleteBatch,
  previewPostedTransactionUpdateBatch,
  simulatePostedTransactionDeleteBatch,
} from "../../src/services/postedTransactionMutations.js";
import { createTransaction } from "../../src/services/portfolio.js";
import { createDividendEvent } from "../../src/services/dividends.js";

async function seedTrade(persistence: MemoryPersistence, userId = "user-1"): Promise<string> {
  const store = await persistence.loadStore(userId);
  createTransaction(store, userId, {
    id: "trade-1",
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2026-01-02",
    commissionAmount: 0,
    taxAmount: 0,
    feesSource: "MANUAL",
    type: "BUY",
    isDayTrade: false,
  });
  await persistence.saveStore(store);
  return "trade-1";
}

async function seedConfirmedDraftRow(persistence: MemoryPersistence, tradeId: string): Promise<void> {
  await persistence.ensureDevBypassUser();
  await persistence.saveAiTransactionDraftBatch({
    id: "batch-1",
    ownerUserId: "user-1",
    createdByUserId: "user-1",
    sourceChannel: "mcp",
    status: "open",
    version: 1,
    rowCount: 1,
    unsupportedCount: 0,
  });
  await persistence.saveAiTransactionDraftRow({
    id: "row-1",
    batchId: "batch-1",
    ownerUserId: "user-1",
    rowNumber: 1,
    state: "confirmed",
    version: 1,
    accountId: "acc-1",
    accountNameInput: "Main",
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
    feesSource: "MANUAL",
    confirmedTradeEventId: tradeId,
    confirmedAt: "2026-01-02T00:00:00.000Z",
    confirmedByUserId: "user-1",
  });
}

describe("posted transaction mutation service", () => {
  it("reports signed holding and cash effects for BUY updates and SELL deletions", async () => {
    const persistence = new MemoryPersistence();
    const buyId = await seedTrade(persistence);

    const buyUpdate = await previewPostedTransactionUpdateBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Increase booked purchase",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: buyId, patch: { quantity: 12 } }],
    });
    expect(buyUpdate.summary).toMatchObject({
      quantityDelta: 2,
      cashDelta: -200,
    });
    expect(buyUpdate.page.items[0]?.impacts).toMatchObject({
      quantityDelta: 2,
      cashDelta: -200,
    });

    const store = await persistence.loadStore("user-1");
    createTransaction(store, "user-1", {
      id: "trade-sell",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      quantity: 4,
      unitPrice: 110,
      priceCurrency: "TWD",
      tradeDate: "2026-01-03",
      commissionAmount: 0,
      taxAmount: 0,
      feesSource: "MANUAL",
      type: "SELL",
      isDayTrade: false,
    });
    await persistence.saveStore(store);

    const sellDelete = await previewPostedTransactionDeleteBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Remove booked sale",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: "trade-sell" }],
    });
    expect(sellDelete.summary).toMatchObject({
      quantityDelta: 4,
      cashDelta: -440,
    });
    expect(sellDelete.page.items[0]?.impacts).toMatchObject({
      quantityDelta: 4,
      cashDelta: -440,
    });
  });

  it("can simulate deletion impact without persisting a durable preview", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);

    const simulated = await simulatePostedTransactionDeleteBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Read-only impact simulation",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId }],
    });

    await expect(persistence.getPostedTransactionMutationPreview(simulated.previewId)).resolves.toBeNull();
  });

  it("rejects a preview when accounting changes while its store snapshot is loading", async () => {
    class RacingMemoryPersistence extends MemoryPersistence {
      private armed = false;
      private revisionReadCount = 0;

      arm(): void {
        this.armed = true;
        this.revisionReadCount = 0;
      }

      override async getAccountAccountingRevision(userId: string, accountId: string): Promise<number> {
        const revision = await super.getAccountAccountingRevision(userId, accountId);
        if (!this.armed) return revision;
        this.revisionReadCount += 1;
        if (this.revisionReadCount < 2) return revision;
        this.armed = false;
        return revision + 1;
      }
    }

    const persistence = new RacingMemoryPersistence();
    const tradeId = await seedTrade(persistence);
    persistence.arm();

    await expect(previewPostedTransactionUpdateBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Correct booked quantity",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId, patch: { quantity: 12 } }],
    })).rejects.toMatchObject({
      code: "posted_transaction_mutation_preview_stale",
    });
  });

  it("returns an unconfirmable blocked preview when deleting a BUY would create a negative position", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);
    const store = await persistence.loadStore("user-1");
    createTransaction(store, "user-1", {
      id: "trade-2",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      quantity: 8,
      unitPrice: 110,
      priceCurrency: "TWD",
      tradeDate: "2026-01-03",
      commissionAmount: 0,
      taxAmount: 0,
      feesSource: "MANUAL",
      type: "SELL",
      isDayTrade: false,
    });
    await persistence.saveStore(store);

    const preview = await previewPostedTransactionDeleteBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Remove consumed purchase",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId }],
    });

    expect(preview).toMatchObject({
      status: "failed",
      page: {
        items: [{
          transactionId: tradeId,
          status: "blocked",
        }],
      },
    });
    expect(preview.blockers.join(" ")).toMatch(/negative position/i);
    expect(preview.page.items[0]?.blockers.join(" ")).toMatch(/negative position/i);
    await expect(confirmPostedTransactionMutation(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: preview.operation,
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    })).rejects.toMatchObject({ code: "posted_transaction_mutation_inventory_conflict" });
  });

  it("returns a blocked preview when changing a lone BUY into a SELL", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);

    const preview = await previewPostedTransactionUpdateBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Correct transaction side",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId, patch: { side: "SELL" } }],
    });

    expect(preview.status).toBe("failed");
    expect(preview.page.items[0]).toMatchObject({
      transactionId: tradeId,
      status: "blocked",
    });
    expect(preview.page.items[0]?.blockers.join(" ")).toMatch(/negative position/i);
  });

  it("recalculates booked fees on an explicit recalc-only update preview", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);

    const preview = await previewPostedTransactionUpdateBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Recalculate booked fees only",
      appBaseUrl: "http://localhost",
      items: [{
        transactionId: tradeId,
        patch: {
          feeOverrideMode: "recalculate",
        },
      }],
    });

    expect(preview.page.items).toHaveLength(1);
    expect(preview.page.items[0]?.before?.feesSource).toBe("MANUAL");
    expect(preview.page.items[0]?.after?.feesSource).toBe("CALCULATED");
    expect(preview.page.items[0]?.after?.commissionAmount).toBeGreaterThan(0);
  });

  it("keeps delegated actor ownership on confirmed runs", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);
    await seedConfirmedDraftRow(persistence, tradeId);
    const publishEvent = vi.fn().mockResolvedValue(undefined);

    const preview = await previewPostedTransactionDeleteBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "delegate-user",
      reason: "Delete confirmed trade",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId }],
    });

    const confirmed = await confirmPostedTransactionMutation(persistence, {
      ownerUserId: "user-1",
      actorUserId: "delegate-user",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: "delete",
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    }, { eventBus: { publishEvent } });

    await expect(getPostedTransactionMutationRun(persistence, {
      ownerUserId: "user-1",
      actorUserId: "delegate-user",
      runId: confirmed.runId,
      appBaseUrl: "http://localhost",
    })).resolves.toMatchObject({
      runId: confirmed.runId,
      previewId: preview.previewId,
    });

    const replayRun = await persistence.getMcpReplayRun(confirmed.runId);
    expect(replayRun?.scopes[0]).toMatchObject({
      earliestReplayDate: "2026-01-02",
      deletedTradeEventIds: [tradeId],
    });
    await expect(persistence.listPostedTransactionMutationDeletedDraftLineage("user-1", [tradeId])).resolves.toMatchObject([{
      tradeEventId: tradeId,
      batchId: "batch-1",
      rowId: "row-1",
      deletedByUserId: "delegate-user",
      mutationRunId: confirmed.runId,
    }]);
    expect(publishEvent).toHaveBeenCalledWith("user-1", "portfolio_transactions_changed", expect.objectContaining({
      runId: confirmed.runId,
      previewId: preview.previewId,
      operation: "delete",
    }));
    expect(publishEvent).toHaveBeenCalledWith("user-1", "portfolio_holdings_changed", expect.any(Object));
    expect(publishEvent).toHaveBeenCalledWith("user-1", "portfolio_dividends_changed", expect.any(Object));
    expect(publishEvent).toHaveBeenCalledWith("user-1", "audit_log_changed", expect.objectContaining({
      runId: confirmed.runId,
      action: "delegated_portfolio_write",
    }));
    expect(publishEvent).toHaveBeenCalledWith("user-1", "posted_transaction_mutation_rebuild", expect.objectContaining({
      runId: confirmed.runId,
      status: "queued",
    }));
  });

  it("persists synchronous rebuild completion on the mutation run and publishes lifecycle events", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);
    const publishEvent = vi.fn().mockResolvedValue(undefined);
    const preview = await previewPostedTransactionUpdateBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Correct booked quantity",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId, patch: { quantity: 12 } }],
    });
    const confirmed = await confirmPostedTransactionMutation(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: "update",
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    });

    await dispatchPostedTransactionMutationRebuild(persistence, {
      ownerUserId: "user-1",
      runId: confirmed.runId,
      eventBus: { publishEvent },
    });

    await expect(persistence.getPostedTransactionMutationRun(confirmed.runId)).resolves.toMatchObject({
      status: "completed",
      rebuildStatus: "completed",
      startedAt: expect.any(String),
      completedAt: expect.any(String),
      scopes: [expect.objectContaining({ status: "completed" })],
    });
    expect(publishEvent).toHaveBeenCalledWith("user-1", "posted_transaction_mutation_rebuild", expect.objectContaining({
      runId: confirmed.runId,
      status: "running",
    }));
    expect(publishEvent).toHaveBeenCalledWith("user-1", "posted_transaction_mutation_rebuild", expect.objectContaining({
      runId: confirmed.runId,
      status: "completed",
    }));
  });

  it("returns the original run for identical confirmation retries and rejects conflicting reuse", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);

    const preview = await previewPostedTransactionUpdateBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Correct booked quantity",
      appBaseUrl: "http://localhost",
      items: [{
        transactionId: tradeId,
        patch: { quantity: 12 },
      }],
    });

    const confirmed = await confirmPostedTransactionMutation(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: "update",
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    });

    await expect(confirmPostedTransactionMutation(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: "update",
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    })).resolves.toMatchObject({
      runId: confirmed.runId,
      previewId: preview.previewId,
    });

    await expect(confirmPostedTransactionMutation(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: "update",
        fingerprint: `${preview.fingerprint.slice(0, -1)}0`,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    })).rejects.toMatchObject({
      statusCode: 409,
      code: "posted_transaction_mutation_confirmation_conflict",
    });
  });

  it("marks the durable run failed when queue dispatch fails after commit", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);
    const preview = await previewPostedTransactionUpdateBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Correct booked quantity",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId, patch: { quantity: 12 } }],
    });
    const confirmed = await confirmPostedTransactionMutation(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: "update",
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    });

    await dispatchPostedTransactionMutationRebuild(persistence, {
      ownerUserId: "user-1",
      runId: confirmed.runId,
      boss: { send: vi.fn().mockRejectedValue(new Error("queue unavailable")) },
    });

    await expect(getPostedTransactionMutationRun(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      runId: confirmed.runId,
      appBaseUrl: "http://localhost",
    })).resolves.toMatchObject({
      status: "failed",
      rebuildStatus: "failed",
      warnings: [expect.stringContaining("preview_replay_portfolio_positions")],
      errors: [{
        code: "posted_transaction_mutation_enqueue_failed",
        message: "queue unavailable",
      }],
    });
  });

  it("returns the committed run when post-commit event delivery fails", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);
    const preview = await previewPostedTransactionUpdateBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Correct booked quantity",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId, patch: { quantity: 12 } }],
    });

    await expect(confirmPostedTransactionMutation(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: "update",
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    }, {
      eventBus: { publishEvent: vi.fn().mockRejectedValue(new Error("event transport unavailable")) },
    })).resolves.toMatchObject({
      previewId: preview.previewId,
      status: "queued",
    });
    const committed = await persistence.loadStore("user-1");
    expect(committed.accounting.facts.tradeEvents.find((trade) => trade.id === tradeId)?.quantity).toBe(12);
  });

  it("filters warning items and purges posted dividend artifacts with explicit re-entry guidance", async () => {
    const persistence = new MemoryPersistence();
    const tradeId = await seedTrade(persistence);
    const store = await persistence.loadStore("user-1");
    createDividendEvent(store, {
      id: "dividend-1",
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2026-01-10",
      paymentDate: "2026-01-20",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      stockDistributionAmountRaw: 0,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockParValueAmount: null,
      stockParValueCurrency: null,
      source: "test",
    });
    store.accounting.facts.dividendLedgerEntries.push({
      id: "posted-ledger-1",
      accountId: "acc-1",
      dividendEventId: "dividend-1",
      eligibleQuantity: 10,
      expectedCashAmount: 10,
      expectedStockQuantity: 0,
      receivedCashAmount: 10,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "matched",
      version: 1,
      sourceCompositionStatus: "provided",
      bookedAt: "2026-01-20T00:00:00.000Z",
    });
    store.accounting.facts.cashLedgerEntries.push({
      id: "dividend-cash-1",
      userId: "user-1",
      accountId: "acc-1",
      entryDate: "2026-01-20",
      entryType: "DIVIDEND_RECEIPT",
      amount: 10,
      currency: "TWD",
      relatedDividendLedgerEntryId: "posted-ledger-1",
      source: "manual",
      sourceReference: "posted-ledger-1",
      bookedAt: "2026-01-20T00:00:00.000Z",
    });
    await persistence.saveStore(store);

    const preview = await previewPostedTransactionDeleteBatch(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Remove duplicate posted trade",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId }],
    });
    expect(preview.warnings.join(" ")).toContain("posted-ledger-1");
    expect(preview.warnings.join(" ")).toContain("entered again");
    await expect(getPostedTransactionMutationPreview(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      previewId: preview.previewId,
      appBaseUrl: "http://localhost",
      query: { status: "warning" },
    })).resolves.toMatchObject({ page: { total: 1 } });

    await confirmPostedTransactionMutation(persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      appBaseUrl: "http://localhost",
      confirmation: {
        previewId: preview.previewId,
        previewVersion: preview.previewVersion,
        operation: "delete",
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    });
    const committed = await persistence.loadStore("user-1");
    expect(committed.accounting.facts.dividendLedgerEntries.some((entry) => entry.id === "posted-ledger-1")).toBe(false);
    expect(committed.accounting.facts.cashLedgerEntries.some((entry) => entry.id === "dividend-cash-1")).toBe(false);
  });
});
