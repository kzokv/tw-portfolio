import { describe, expect, it } from "vitest";
import {
  confirmRecompute,
  previewRecompute,
  RECOMPUTE_PREVIEW_TTL_MS,
} from "../../src/services/recompute.js";
import { createDefaultFeeProfile, createStore } from "../../src/services/store.js";
import type { BookedTradeEvent, Store } from "../../src/types/store.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { routeError } from "../../src/lib/routeError.js";

function addTrade(
  store: Store,
  id: string,
  feesSource: BookedTradeEvent["feesSource"],
  commissionAmount: number,
  taxAmount = 0,
): BookedTradeEvent {
  const trade: BookedTradeEvent = {
    id,
    userId: store.userId,
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2026-01-01",
    commissionAmount,
    taxAmount,
    isDayTrade: false,
    feeSnapshot: structuredClone(store.feeProfiles[0]!),
    feesSource,
  };
  store.accounting.facts.tradeEvents.push(trade);
  return trade;
}

describe("recompute preview", () => {
  it("defaults to keeping recorded commission and tax", () => {
    const store = createStore();
    addTrade(store, "calculated", "CALCULATED", 7, 3);

    const job = previewRecompute(store, { userId: store.userId, useFallbackBindings: true });

    expect(job).toMatchObject({
      status: "PREVIEWED",
      mode: "KEEP_RECORDED",
      counts: { total: 1, calculated: 1, preserved: 1, changed: 0 },
      impactsByCurrency: [{ currency: "TWD", commissionDelta: 0, taxDelta: 0 }],
    });
    expect(job.items[0]).toMatchObject({
      previousCommissionAmount: 7,
      nextCommissionAmount: 7,
      previousTaxAmount: 3,
      nextTaxAmount: 3,
      feesSource: "CALCULATED",
      appliedFeeProfile: null,
    });
    expect(job.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("recalculates only CALCULATED trades and groups native-currency impacts", () => {
    const store = createStore();
    addTrade(store, "calculated", "CALCULATED", 7);
    addTrade(store, "manual", "MANUAL", 8);
    addTrade(store, "provided", "SOURCE_PROVIDED", 9);

    const job = previewRecompute(store, {
      userId: store.userId,
      useFallbackBindings: true,
      mode: "RECALCULATE_CALCULATED",
    });

    expect(job.counts).toEqual({ total: 3, calculated: 1, preserved: 2, changed: 1 });
    expect(job.impactsByCurrency).toEqual([{ currency: "TWD", commissionDelta: 13, taxDelta: 0 }]);
    expect(job.items.find((item) => item.tradeEventId === "calculated")).toMatchObject({
      nextCommissionAmount: 20,
      feesSource: "CALCULATED",
      appliedProfileId: store.feeProfiles[0]!.id,
      appliedFeeProfile: store.feeProfiles[0],
    });
    expect(job.items.find((item) => item.tradeEventId === "manual")).toMatchObject({
      nextCommissionAmount: 8,
      feesSource: "MANUAL",
      appliedProfileId: null,
      appliedFeeProfile: null,
    });
    expect(job.items.find((item) => item.tradeEventId === "provided")).toMatchObject({
      nextCommissionAmount: 9,
      feesSource: "SOURCE_PROVIDED",
      appliedProfileId: null,
      appliedFeeProfile: null,
    });
  });

  it("rejects a stale fingerprint and genuine trade drift", async () => {
    const store = createStore();
    const trade = addTrade(store, "calculated", "CALCULATED", 7);
    const job = previewRecompute(store, {
      userId: store.userId,
      useFallbackBindings: true,
      mode: "RECALCULATE_CALCULATED",
    });

    await expect(confirmRecompute(store, store.userId, job.id, "0".repeat(64))).rejects.toMatchObject({
      code: "recompute_preview_fingerprint_mismatch",
      statusCode: 409,
    });

    trade.quantity = 11;
    await expect(confirmRecompute(store, store.userId, job.id, job.fingerprint)).rejects.toMatchObject({
      code: "recompute_preview_drift",
      statusCode: 409,
    });
  });

  it("rejects confirmation at the preview expiry boundary", async () => {
    const store = createStore();
    addTrade(store, "calculated", "CALCULATED", 7);
    const createdAt = new Date("2026-07-14T00:00:00.000Z");
    const job = previewRecompute(store, {
      userId: store.userId,
      useFallbackBindings: true,
      now: createdAt,
    });

    await expect(confirmRecompute(
      store,
      store.userId,
      job.id,
      job.fingerprint,
      new Date(createdAt.getTime() + RECOMPUTE_PREVIEW_TTL_MS),
    )).rejects.toMatchObject({
      code: "recompute_preview_expired",
      statusCode: 409,
    });
    expect(job.status).toBe("PREVIEWED");
  });

  it("rejects a fee-profile edit racing after validation and preserves accounting", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();
    const store = createStore();
    addTrade(store, "calculated", "CALCULATED", 7);
    await persistence.saveStore(store);
    const revision = await persistence.getAccountAccountingRevision(store.userId, "acc-1");
    const job = previewRecompute(store, {
      userId: store.userId,
      useFallbackBindings: true,
      mode: "RECALCULATE_CALCULATED",
      accountRevisions: { "acc-1": revision },
    });
    await persistence.saveRecomputeJob(job);
    const working = structuredClone(store);

    const simulatedJob = await confirmRecompute(working, store.userId, job.id, job.fingerprint, new Date(), {
      onRunning: async (runningJob) => {
        expect(await persistence.startRecomputeJob(
          store.userId,
          runningJob.id,
          runningJob.startedAt!,
        )).toBe(true);
        const durable = await persistence.loadStore(store.userId);
        durable.feeProfiles[0]!.minimumCommissionAmount += 1;
      },
    });

    await expect(persistence.commitRecomputeStore(store.userId, working.accounting, simulatedJob)).rejects.toMatchObject({
      code: "recompute_preview_drift",
    });
    const durable = await persistence.loadStore(store.userId);
    expect(durable.accounting.facts.tradeEvents[0]?.commissionAmount).toBe(7);
    expect(durable.recomputeJobs.find((candidate) => candidate.id === job.id)?.status).toBe("RUNNING");
  });

  it("preserves durable recompute jobs when stale full-store snapshots are saved", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();
    const store = createStore();
    addTrade(store, "calculated", "CALCULATED", 7);
    await persistence.saveStore(store);
    const staleBeforePreview = structuredClone(store);
    const job = previewRecompute(structuredClone(store), {
      userId: store.userId,
      useFallbackBindings: true,
      accountRevisions: {
        "acc-1": await persistence.getAccountAccountingRevision(store.userId, "acc-1"),
      },
    });
    await persistence.saveRecomputeJob(job);

    await persistence.saveStore(staleBeforePreview);
    expect((await persistence.loadStore(store.userId)).recomputeJobs.find(
      (candidate) => candidate.id === job.id,
    )?.status).toBe("PREVIEWED");

    const stalePreview = structuredClone(await persistence.loadStore(store.userId));
    expect(await persistence.startRecomputeJob(store.userId, job.id, "2026-07-14T00:01:00.000Z")).toBe(true);
    await persistence.saveStore(stalePreview);

    expect((await persistence.loadStore(store.userId)).recomputeJobs.find(
      (candidate) => candidate.id === job.id,
    )).toMatchObject({
      status: "RUNNING",
      startedAt: "2026-07-14T00:01:00.000Z",
    });
  });

  it("rejects an explicit cross-account profile edit racing after validation", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();
    const store = createStore();
    const explicitProfile = createDefaultFeeProfile("acc-2", "TWD", "profile-acc-2");
    store.accounts.push({
      id: "acc-2",
      userId: store.userId,
      name: "Profile owner",
      feeProfileId: explicitProfile.id,
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    store.feeProfiles.push(explicitProfile);
    addTrade(store, "calculated", "CALCULATED", 7);
    await persistence.saveStore(store);
    const revision = await persistence.getAccountAccountingRevision(store.userId, "acc-1");
    const job = previewRecompute(store, {
      userId: store.userId,
      accountId: "acc-1",
      profileId: explicitProfile.id,
      useFallbackBindings: false,
      mode: "RECALCULATE_CALCULATED",
      accountRevisions: { "acc-1": revision },
    });
    await persistence.saveRecomputeJob(job);
    const working = structuredClone(store);

    const simulatedJob = await confirmRecompute(working, store.userId, job.id, job.fingerprint, new Date(), {
      onRunning: async (runningJob) => {
        expect(await persistence.startRecomputeJob(
          store.userId,
          runningJob.id,
          runningJob.startedAt!,
        )).toBe(true);
        const durable = await persistence.loadStore(store.userId);
        durable.feeProfiles.find((profile) => profile.id === explicitProfile.id)!.minimumCommissionAmount += 1;
      },
    });

    await expect(persistence.commitRecomputeStore(store.userId, working.accounting, simulatedJob)).rejects.toMatchObject({
      code: "recompute_preview_drift",
    });
    const durable = await persistence.loadStore(store.userId);
    expect(durable.accounting.facts.tradeEvents.find((trade) => trade.id === "calculated")?.commissionAmount).toBe(7);
    expect(durable.recomputeJobs.find((candidate) => candidate.id === job.id)?.status).toBe("RUNNING");
  });

  it("does not let a losing concurrent confirmation fail the winner's running job", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();
    const store = createStore();
    addTrade(store, "calculated", "CALCULATED", 7);
    await persistence.saveStore(store);
    const revision = await persistence.getAccountAccountingRevision(store.userId, "acc-1");
    const job = previewRecompute(store, {
      userId: store.userId,
      useFallbackBindings: true,
      mode: "RECALCULATE_CALCULATED",
      accountRevisions: { "acc-1": revision },
    });
    await persistence.saveRecomputeJob(job);
    const winnerStore = structuredClone(store);
    const loserStore = structuredClone(store);

    let releaseWinner!: () => void;
    const winnerBarrier = new Promise<void>((resolve) => {
      releaseWinner = resolve;
    });
    let signalWinnerStarted!: () => void;
    const winnerStarted = new Promise<void>((resolve) => {
      signalWinnerStarted = resolve;
    });
    let loserFailedCallbacks = 0;
    const winnerPromise = confirmRecompute(winnerStore, store.userId, job.id, job.fingerprint, new Date(), {
      onRunning: async (runningJob) => {
        const started = await persistence.startRecomputeJob(store.userId, runningJob.id, runningJob.startedAt!);
        expect(started).toBe(true);
        signalWinnerStarted();
        await winnerBarrier;
      },
      onFailed: async (failedJob) => {
        await persistence.failRecomputeJob(store.userId, failedJob.id, {
          completedAt: failedJob.completedAt!,
          errorCode: failedJob.errorCode!,
          errorMessage: failedJob.errorMessage!,
        });
      },
    });
    await winnerStarted;

    const loserError = await confirmRecompute(loserStore, store.userId, job.id, job.fingerprint, new Date(), {
      onRunning: async (runningJob) => {
        const started = await persistence.startRecomputeJob(store.userId, runningJob.id, runningJob.startedAt!);
        if (!started) throw routeError(409, "recompute_preview_consumed", "Recompute preview is no longer confirmable");
      },
      onFailed: async (failedJob) => {
        loserFailedCallbacks += 1;
        await persistence.failRecomputeJob(store.userId, failedJob.id, {
          completedAt: failedJob.completedAt!,
          errorCode: failedJob.errorCode!,
          errorMessage: failedJob.errorMessage!,
        });
      },
    }).then(() => undefined, (error: unknown) => error);
    const durableWhileWinnerHeld = await persistence.loadStore(store.userId);
    const statusWhileWinnerHeld = durableWhileWinnerHeld.recomputeJobs.find((candidate) => candidate.id === job.id)?.status;

    releaseWinner();
    const confirmedJob = await winnerPromise;
    expect(await persistence.commitRecomputeStore(store.userId, winnerStore.accounting, confirmedJob)).toBe(true);

    expect(loserError).toMatchObject({ code: "recompute_preview_consumed", statusCode: 409 });
    expect(loserFailedCallbacks).toBe(0);
    expect(statusWhileWinnerHeld).toBe("RUNNING");
    const durable = await persistence.loadStore(store.userId);
    expect(durable.recomputeJobs.find((candidate) => candidate.id === job.id)?.status).toBe("CONFIRMED");
  });
});
