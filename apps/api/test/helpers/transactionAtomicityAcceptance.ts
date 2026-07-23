import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { buildApp } from "../../src/app.js";
import { createDividendEvent } from "../../src/services/dividends.js";
import { executeReplayRun, previewReplayPortfolioPositions } from "../../src/services/mcpPortfolioMaintenance.js";
import {
  confirmPostedTransactionMutation,
  dispatchPostedTransactionMutationRebuild,
  previewPostedTransactionUpdateBatch,
} from "../../src/services/postedTransactionMutations.js";
import { scheduleReplayWithRetry } from "../../src/services/replayPositionHistory.js";
import type { TransactionType } from "./fixtures.js";
import {
  dividendPostingPayload,
  dividendPostingUpdatePayload,
  transactionPayload,
} from "./fixtures.js";

type TestApp = Awaited<ReturnType<typeof buildApp>>;

const ticker = "8477";
const zeroCharges = { commissionAmount: 0, taxAmount: 0 };
const replayDrainTimeoutMs = 15_000;

async function postTrade(
  app: TestApp,
  accountId: string,
  idempotencyKey: string,
  overrides: Parameters<typeof transactionPayload>[0],
) {
  return app.inject({
    method: "POST",
    url: "/portfolio/transactions",
    headers: { "idempotency-key": idempotencyKey },
    payload: transactionPayload({ accountId, ticker, ...zeroCharges, ...overrides }),
  });
}

function gateNextTransactionWrite(app: TestApp): {
  entered: Promise<void>;
  release: () => void;
  restore: () => void;
} {
  const persistence = app.persistence;
  const original = persistence.withTransactionWriteLock.bind(persistence);
  let signalEntered!: () => void;
  let release!: () => void;
  let gateOpen = false;
  const entered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  persistence.withTransactionWriteLock = (async (ownerUserId, execute) => original(
    ownerUserId,
    async (writer) => {
      if (!gateOpen) {
        gateOpen = true;
        signalEntered();
        await released;
      }
      return execute(writer);
    },
  )) as typeof persistence.withTransactionWriteLock;

  return {
    entered,
    release,
    restore: () => {
      persistence.withTransactionWriteLock = original;
    },
  };
}

function interceptScheduledReplay(app: TestApp, accountId: string): {
  waitForSettled: (count: number) => Promise<void>;
  arm: (expectedReplayCount: number) => void;
  waitForArmedStart: () => Promise<void>;
  drain: () => Promise<void>;
} {
  const eventBus = app.eventBus;
  const original = eventBus.publishEvent.bind(eventBus);
  let settled = 0;
  let blocked = 0;
  let armed = false;
  let expected = 0;
  let settledAtArm = 0;
  let release!: () => void;
  const settledWaiters: Array<{ count: number; resolve: () => void }> = [];
  const startedWaiters: Array<() => void> = [];
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const isTerminal = (type: string, data: {
    accountId?: string;
    ticker?: string;
    retriesExhausted?: boolean;
  }) => type === "recompute_complete"
    || (type === "recompute_failed" && data.retriesExhausted === true);
  const unsubscribe = eventBus.subscribe("user-1", (event) => {
    const data = event.data as {
      accountId?: string;
      ticker?: string;
      retriesExhausted?: boolean;
    };
    if (!isTerminal(event.type, data) || data.accountId !== accountId || data.ticker !== ticker) return;
    settled += 1;
    for (const waiter of settledWaiters.filter((candidate) => settled >= candidate.count)) waiter.resolve();
  });

  eventBus.publishEvent = (async (userId, type, rawData) => {
    const data = rawData as {
      accountId?: string;
      ticker?: string;
      retriesExhausted?: boolean;
    };
    const isAcceptanceScope = userId === "user-1"
      && data.accountId === accountId
      && data.ticker === ticker
      && isTerminal(type, data);
    if (isAcceptanceScope && armed && blocked < expected) {
      blocked += 1;
      if (blocked >= expected) {
        for (const signalStarted of startedWaiters) signalStarted();
      }
      await released;
    }
    return original(userId, type, rawData);
  }) as typeof eventBus.publishEvent;

  return {
    waitForSettled: async (count) => {
      if (settled >= count) return;
      await new Promise<void>((resolve) => settledWaiters.push({ count, resolve }));
    },
    arm: (expectedReplayCount) => {
      expected = expectedReplayCount;
      settledAtArm = settled;
      armed = true;
    },
    waitForArmedStart: async () => {
      if (blocked >= expected) return;
      await new Promise<void>((resolve) => startedWaiters.push(resolve));
    },
    drain: async () => {
      release();
      try {
        if (armed) {
          const terminalReplay = new Promise<void>((resolve) => {
            const count = settledAtArm + expected;
            if (settled >= count) resolve();
            else settledWaiters.push({ count, resolve });
          });
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              terminalReplay,
              new Promise<never>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error(`timed out waiting for ${expected} armed replay(s) to settle`)),
                  replayDrainTimeoutMs,
                );
              }),
            ]);
          } finally {
            if (timeout) clearTimeout(timeout);
          }
        }
      } finally {
        eventBus.publishEvent = original;
        unsubscribe();
      }
    },
  };
}

function gateNextBackgroundReplayCommit(app: TestApp): {
  entered: Promise<void>;
  release: () => void;
  restore: () => void;
} {
  const persistence = app.persistence;
  const original = persistence.withTransactionWriteLock.bind(persistence);
  let signalEntered!: () => void;
  let release!: () => void;
  let gateOpen = false;
  const entered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  persistence.withTransactionWriteLock = (async (ownerUserId, execute) => original(
    ownerUserId,
    async (writer) => execute({
      ...writer,
      saveReplayedPositionScope: async (...args) => {
        const input = args[2];
        const isBackgroundReplay = !input.newTradeEventId && !input.newPositionActionId;
        if (isBackgroundReplay && !gateOpen) {
          gateOpen = true;
          signalEntered();
          await released;
        }
        return writer.saveReplayedPositionScope(...args);
      },
    }),
  )) as typeof persistence.withTransactionWriteLock;

  return {
    entered,
    release,
    restore: () => {
      persistence.withTransactionWriteLock = original;
    },
  };
}

export async function verifyIncreasingActionSellRace(app: TestApp): Promise<void> {
  const accountId = (await app.persistence.loadStore("user-1")).accounts[0]!.id;
  const replay = interceptScheduledReplay(app, accountId);
  let gate: ReturnType<typeof gateNextTransactionWrite> | undefined;
  let assertFinalState: (() => Promise<void>) | undefined;
  try {
    const buy = await postTrade(app, accountId, "rr1-increase-buy", {
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-01-01",
    });
    expect(buy.statusCode).toBe(200);
    await replay.waitForSettled(1);
    replay.arm(2);
    gate = gateNextTransactionWrite(app);

    const actionPromise = app.inject({
      method: "POST",
      url: "/corporate-actions",
      payload: {
        accountId,
        ticker,
        actionType: "SPLIT",
        numerator: 2,
        denominator: 1,
        actionDate: "2026-01-02",
      },
    });
    await gate.entered;
    const sellPromise = postTrade(app, accountId, "rr1-increase-sell", {
      quantity: 15,
      unitPrice: 120,
      tradeDate: "2026-01-03",
      type: "SELL" as TransactionType,
    });
    gate.release();

    const [action, sell] = await Promise.all([actionPromise, sellPromise]);
    expect(action.statusCode).toBe(200);
    expect(sell.statusCode).toBe(200);
    await replay.waitForArmedStart();

    const actionId = action.json().id as string;
    const sellId = sell.json().id as string;
    assertFinalState = async () => {
      const store = await app.persistence.loadStore("user-1");
      expect(store.accounting.facts.positionActions).toContainEqual(
        expect.objectContaining({ id: actionId, actionType: "SPLIT", ratioNumerator: 2 }),
      );
      expect(store.accounting.facts.tradeEvents).toContainEqual(
        expect.objectContaining({ id: sellId, type: "SELL", quantity: 15 }),
      );
      const sellTrade = store.accounting.facts.tradeEvents.find((trade) => trade.id === sellId)!;
      const sellAllocations = store.accounting.projections.lotAllocations
        .filter((allocation) => allocation.tradeEventId === sellId);
      expect(sellAllocations.reduce((sum, allocation) => sum + allocation.allocatedQuantity, 0)).toBe(15);
      expect(sellTrade.realizedPnlAmount).toBeCloseTo(
        15 * 120 - sellAllocations.reduce((sum, allocation) => sum + allocation.allocatedCostAmount, 0),
        6,
      );
      expect(store.accounting.projections.lots
        .filter((lot) => lot.accountId === accountId && lot.ticker === ticker)
        .reduce((sum, lot) => sum + lot.openQuantity, 0)).toBe(5);
    };
    for (let reload = 0; reload < 2; reload += 1) {
      await assertFinalState();
    }
  } finally {
    gate?.release();
    gate?.restore();
    await replay.drain();
  }
  await assertFinalState?.();
}

export async function verifyDecreasingActionSellRace(app: TestApp): Promise<void> {
  const accountId = (await app.persistence.loadStore("user-1")).accounts[0]!.id;
  const replay = interceptScheduledReplay(app, accountId);
  let gate: ReturnType<typeof gateNextTransactionWrite> | undefined;
  let assertFinalState: (() => Promise<void>) | undefined;
  try {
    const buy = await postTrade(app, accountId, "rr1-decrease-buy", {
      quantity: 20,
      unitPrice: 100,
      tradeDate: "2026-02-01",
    });
    expect(buy.statusCode).toBe(200);
    await replay.waitForSettled(1);
    replay.arm(1);
    gate = gateNextTransactionWrite(app);

    const actionPromise = app.inject({
      method: "POST",
      url: "/corporate-actions",
      payload: {
        accountId,
        ticker,
        actionType: "REVERSE_SPLIT",
        numerator: 1,
        denominator: 2,
        actionDate: "2026-02-02",
      },
    });
    await gate.entered;
    const sellPromise = postTrade(app, accountId, "rr1-decrease-sell", {
      quantity: 15,
      unitPrice: 120,
      tradeDate: "2026-02-03",
      type: "SELL" as TransactionType,
    });
    gate.release();

    const [action, sell] = await Promise.all([actionPromise, sellPromise]);
    expect(action.statusCode).toBe(200);
    expect(sell.statusCode).toBe(409);
    await replay.waitForArmedStart();
    expect(sell.json()).toMatchObject({
      error: "insufficient_quantity",
      metadata: { requestedQuantity: 15, availableQuantity: 10 },
    });

    const actionId = action.json().id as string;
    assertFinalState = async () => {
      const store = await app.persistence.loadStore("user-1");
      expect(store.accounting.facts.positionActions).toContainEqual(
        expect.objectContaining({ id: actionId, actionType: "REVERSE_SPLIT", ratioDenominator: 2 }),
      );
      expect(store.accounting.facts.tradeEvents.filter(
        (trade) => trade.ticker === ticker && trade.type === "SELL",
      )).toHaveLength(0);
      expect(store.accounting.projections.lotAllocations.filter(
        (allocation) => allocation.accountId === accountId && allocation.ticker === ticker,
      )).toHaveLength(0);
      expect(store.accounting.projections.lots
        .filter((lot) => lot.accountId === accountId && lot.ticker === ticker)
        .reduce((sum, lot) => sum + lot.openQuantity, 0)).toBe(10);
    };
    for (let reload = 0; reload < 2; reload += 1) {
      await assertFinalState();
    }
  } finally {
    gate?.release();
    gate?.restore();
    await replay.drain();
  }
  await assertFinalState?.();
}

export async function verifyBackdatedSellReplayCommit(app: TestApp): Promise<void> {
  const accountId = (await app.persistence.loadStore("user-1")).accounts[0]!.id;
  const replay = interceptScheduledReplay(app, accountId);
  let assertFinalState: (() => Promise<void>) | undefined;
  try {
    const firstBuy = await postTrade(app, accountId, "rr2-buy-first", {
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-03-01",
    });
    const secondBuy = await postTrade(app, accountId, "rr2-buy-second", {
      quantity: 10,
      unitPrice: 200,
      tradeDate: "2026-03-02",
    });
    const laterSell = await postTrade(app, accountId, "rr2-sell-later", {
      quantity: 8,
      unitPrice: 300,
      tradeDate: "2026-03-10",
      type: "SELL" as TransactionType,
    });
    expect([firstBuy.statusCode, secondBuy.statusCode, laterSell.statusCode]).toEqual([200, 200, 200]);
    await replay.waitForSettled(3);
    replay.arm(1);

    const backdatedSell = await postTrade(app, accountId, "rr2-sell-backdated", {
      quantity: 5,
      unitPrice: 250,
      tradeDate: "2026-03-05",
      type: "SELL" as TransactionType,
    });
    expect(backdatedSell.statusCode).toBe(200);
    await replay.waitForArmedStart();

    const firstBuyId = firstBuy.json().id as string;
    const secondBuyId = secondBuy.json().id as string;
    const laterSellId = laterSell.json().id as string;
    const backdatedSellId = backdatedSell.json().id as string;

    assertFinalState = async () => {
      const store = await app.persistence.loadStore("user-1");
      const allocations = store.accounting.projections.lotAllocations
        .filter((allocation) => [backdatedSellId, laterSellId].includes(allocation.tradeEventId))
        .sort((left, right) => left.tradeEventId.localeCompare(right.tradeEventId) || left.lotId.localeCompare(right.lotId));
      expect(allocations).toHaveLength(3);
      expect(allocations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          tradeEventId: backdatedSellId,
          lotId: `lot-${firstBuyId}`,
          allocatedQuantity: 5,
          allocatedCostAmount: 750,
        }),
        expect.objectContaining({
          tradeEventId: laterSellId,
          lotId: `lot-${firstBuyId}`,
          allocatedQuantity: 5,
          allocatedCostAmount: 750,
        }),
        expect.objectContaining({
          tradeEventId: laterSellId,
          lotId: `lot-${secondBuyId}`,
          allocatedQuantity: 3,
          allocatedCostAmount: 450,
        }),
      ]));

      expect(store.accounting.facts.tradeEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: backdatedSellId, realizedPnlAmount: 500 }),
        expect.objectContaining({ id: laterSellId, realizedPnlAmount: 1200 }),
      ]));
      expect(store.accounting.projections.lots
        .filter((lot) => lot.accountId === accountId && lot.ticker === ticker)
        .sort((left, right) => left.id.localeCompare(right.id))).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: `lot-${firstBuyId}`, openQuantity: 0, totalCostAmount: 0 }),
        expect.objectContaining({ id: `lot-${secondBuyId}`, openQuantity: 7, totalCostAmount: 1050 }),
      ]));
    };
    for (let reload = 0; reload < 2; reload += 1) {
      await assertFinalState();
    }
  } finally {
    await replay.drain();
  }
  await assertFinalState?.();
}

async function seedStockDividendEvent(app: TestApp, eventId: string) {
  const store = await app.persistence.loadStore("user-1");
  const event = createDividendEvent(store, {
    id: eventId,
    ticker,
    eventType: "STOCK",
    exDividendDate: "2026-04-02",
    paymentDate: "2026-04-03",
    cashDividendPerShare: 0,
    cashDividendCurrency: "TWD",
    stockDividendPerShare: 0.1,
    source: "test",
  });
  await app.persistence.saveStore(store);
  return event;
}

function stockPostingPayload(accountId: string, dividendEventId: string, quantity: number) {
  return dividendPostingPayload({
    accountId,
    dividendEventId,
    receivedCashAmount: 0,
    receivedStockQuantity: quantity,
    deductions: [],
    sourceLines: [],
    sourceCompositionStatus: "unknown_pending_disclosure",
  });
}

function assertStockDividendSellState(
  app: TestApp,
  accountId: string,
  ledgerEntryId: string,
  sellId: string,
  expectedStockQuantity: number,
  expectedVersion: number,
  expectedSellQuantity: number,
  expectedOpenQuantity: number,
) {
  return app.persistence.loadStore("user-1").then((store) => {
    expect(store.accounting.facts.dividendLedgerEntries).toContainEqual(expect.objectContaining({
      id: ledgerEntryId,
      receivedStockQuantity: expectedStockQuantity,
      version: expectedVersion,
    }));
    expect(store.accounting.facts.positionActions).toContainEqual(expect.objectContaining({
      relatedDividendLedgerEntryId: ledgerEntryId,
      actionType: "STOCK_DIVIDEND",
      quantity: expectedStockQuantity,
    }));
    expect(store.accounting.facts.tradeEvents).toContainEqual(expect.objectContaining({
      id: sellId,
      type: "SELL",
      quantity: expectedSellQuantity,
    }));
    const sellTrade = store.accounting.facts.tradeEvents.find((trade) => trade.id === sellId)!;
    const sellAllocations = store.accounting.projections.lotAllocations
      .filter((allocation) => allocation.tradeEventId === sellId);
    expect(sellAllocations.reduce((sum, allocation) => sum + allocation.allocatedQuantity, 0))
      .toBe(expectedSellQuantity);
    expect(sellTrade.realizedPnlAmount).toBeCloseTo(
      expectedSellQuantity * 120
        - sellAllocations.reduce((sum, allocation) => sum + allocation.allocatedCostAmount, 0),
      6,
    );
    expect(store.accounting.projections.lots
      .filter((lot) => lot.accountId === accountId && lot.ticker === ticker)
      .reduce((sum, lot) => sum + lot.openQuantity, 0)).toBe(expectedOpenQuantity);
  });
}

export async function verifyStockDividendCreationSellRace(app: TestApp): Promise<void> {
  const accountId = (await app.persistence.loadStore("user-1")).accounts[0]!.id;
  const event = await seedStockDividendEvent(app, `atomicity-stock-create-${randomUUID()}`);
  const replay = interceptScheduledReplay(app, accountId);
  let gate: ReturnType<typeof gateNextTransactionWrite> | undefined;
  let assertFinalState: (() => Promise<void>) | undefined;
  try {
    const buy = await postTrade(app, accountId, "stock-create-buy", {
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-04-01",
    });
    expect(buy.statusCode).toBe(200);
    await replay.waitForSettled(1);
    replay.arm(2);
    gate = gateNextTransactionWrite(app);

    const postingPromise = app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "stock-create-posting" },
      payload: stockPostingPayload(accountId, event.id, 5),
    });
    await gate.entered;
    const sellPromise = postTrade(app, accountId, "stock-create-sell", {
      quantity: 12,
      unitPrice: 120,
      tradeDate: "2026-04-04",
      type: "SELL" as TransactionType,
    });
    gate.release();

    const [posting, sell] = await Promise.all([postingPromise, sellPromise]);
    expect(posting.statusCode).toBe(200);
    expect(sell.statusCode).toBe(200);
    await replay.waitForArmedStart();
    const ledgerEntryId = posting.json().dividendLedgerEntry.id as string;
    const sellId = sell.json().id as string;
    assertFinalState = () => assertStockDividendSellState(app, accountId, ledgerEntryId, sellId, 5, 1, 12, 3);
    for (let reload = 0; reload < 2; reload += 1) {
      await assertFinalState();
    }
  } finally {
    gate?.release();
    gate?.restore();
    await replay.drain();
  }
  await assertFinalState?.();
}

export async function verifyStockDividendUpdateSellRace(app: TestApp): Promise<void> {
  const accountId = (await app.persistence.loadStore("user-1")).accounts[0]!.id;
  const event = await seedStockDividendEvent(app, `atomicity-stock-update-${randomUUID()}`);
  const replay = interceptScheduledReplay(app, accountId);
  let gate: ReturnType<typeof gateNextTransactionWrite> | undefined;
  let assertFinalState: (() => Promise<void>) | undefined;
  try {
    const buy = await postTrade(app, accountId, "stock-update-buy", {
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-04-01",
    });
    const initialPosting = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "stock-update-initial-posting" },
      payload: stockPostingPayload(accountId, event.id, 2),
    });
    expect([buy.statusCode, initialPosting.statusCode]).toEqual([200, 200]);
    await replay.waitForSettled(2);
    replay.arm(2);
    gate = gateNextTransactionWrite(app);

    const initial = initialPosting.json().dividendLedgerEntry as { id: string; version: number };
    const updatePromise = app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "stock-update-posting" },
      payload: dividendPostingUpdatePayload({
        ...stockPostingPayload(accountId, event.id, 10),
        dividendLedgerEntryId: initial.id,
        expectedVersion: initial.version,
      }),
    });
    await gate.entered;
    const sellPromise = postTrade(app, accountId, "stock-update-sell", {
      quantity: 15,
      unitPrice: 120,
      tradeDate: "2026-04-04",
      type: "SELL" as TransactionType,
    });
    gate.release();

    const [update, sell] = await Promise.all([updatePromise, sellPromise]);
    expect(update.statusCode).toBe(200);
    expect(sell.statusCode).toBe(200);
    await replay.waitForArmedStart();
    const ledgerEntryId = update.json().dividendLedgerEntry.id as string;
    expect(ledgerEntryId).toBe(initial.id);
    const sellId = sell.json().id as string;
    assertFinalState = () => assertStockDividendSellState(app, accountId, ledgerEntryId, sellId, 10, 2, 15, 5);
    for (let reload = 0; reload < 2; reload += 1) {
      await assertFinalState();
    }
  } finally {
    gate?.release();
    gate?.restore();
    await replay.drain();
  }
  await assertFinalState?.();
}

export async function verifyInvalidReplayWriterRollback(app: TestApp): Promise<void> {
  const accountId = (await app.persistence.loadStore("user-1")).accounts[0]!.id;
  const replay = interceptScheduledReplay(app, accountId);
  try {
    const buy = await postTrade(app, accountId, "invalid-writer-seed-buy", {
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-05-01",
    });
    expect(buy.statusCode).toBe(200);
    await replay.waitForSettled(1);
    const buyId = buy.json().id as string;
    const originalRealizedPnl = (await app.persistence.loadStore("user-1"))
      .accounting.facts.tradeEvents.find((trade) => trade.id === buyId)?.realizedPnlAmount;

    let releaseFailure!: () => void;
    let signalFailureEntered!: () => void;
    const failureEntered = new Promise<void>((resolve) => {
      signalFailureEntered = resolve;
    });
    const failureReleased = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const failingWriter = app.persistence.withTransactionWriteLock("user-1", async (writer) => {
      signalFailureEntered();
      await failureReleased;
      const candidate = structuredClone(await writer.loadStore("user-1"));
      const seededTrade = candidate.accounting.facts.tradeEvents.find((trade) => trade.id === buyId);
      expect(seededTrade).toBeDefined();
      seededTrade!.realizedPnlAmount = 9_999;
      await writer.saveReplayedPositionScope("user-1", candidate.accounting, {
        accountId,
        ticker,
        marketCode: "TW",
        newTradeEventId: "missing-linked-trade",
      });
    });
    await failureEntered;

    const queuedWriter = app.persistence.withTransactionWriteLock("user-1", async (writer) => {
      const latest = await writer.loadStore("user-1");
      expect(latest.accounting.facts.tradeEvents.find((trade) => trade.id === buyId)?.realizedPnlAmount)
        .toBe(originalRealizedPnl);
      await writer.saveReplayedPositionScope("user-1", latest.accounting, {
        accountId,
        ticker,
        marketCode: "TW",
      });
      return "writer-reused";
    });
    releaseFailure();

    await expect(failingWriter).rejects.toThrow("missing-linked-trade");
    await expect(queuedWriter).resolves.toBe("writer-reused");
    const reloaded = await app.persistence.loadStore("user-1");
    expect(reloaded.accounting.facts.tradeEvents.find((trade) => trade.id === buyId)?.realizedPnlAmount)
      .toBe(originalRealizedPnl);
    expect(reloaded.accounting.facts.tradeEvents.some((trade) => trade.id === "missing-linked-trade")).toBe(false);
    expect(reloaded.accounting.projections.lots
      .filter((lot) => lot.accountId === accountId && lot.ticker === ticker)
      .reduce((sum, lot) => sum + lot.openQuantity, 0)).toBe(10);
  } finally {
    await replay.drain();
  }
}

export async function verifyLockedReplayQueuesNewerWriter(app: TestApp): Promise<void> {
  const accountId = (await app.persistence.loadStore("user-1")).accounts[0]!.id;
  const replay = interceptScheduledReplay(app, accountId);
  let commitGate: ReturnType<typeof gateNextBackgroundReplayCommit> | undefined;
  let assertFinalState: (() => Promise<void>) | undefined;
  try {
    const buy = await postTrade(app, accountId, "locked-replay-seed-buy", {
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-06-01",
    });
    expect(buy.statusCode).toBe(200);
    await replay.waitForSettled(1);

    commitGate = gateNextBackgroundReplayCommit(app);
    replay.arm(2);
    scheduleReplayWithRetry(app.persistence, app.eventBus, "user-1", accountId, ticker, {
      marketCode: "TW",
      snapshotFromDate: "2026-06-01",
    });
    await commitGate.entered;

    let sellSettled = false;
    const sellPromise = postTrade(app, accountId, "locked-replay-newer-sell", {
      quantity: 5,
      unitPrice: 120,
      tradeDate: "2026-06-02",
      type: "SELL" as TransactionType,
    }).finally(() => {
      sellSettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(sellSettled).toBe(false);

    commitGate.release();
    const sell = await sellPromise;
    expect(sell.statusCode).toBe(200);
    await replay.waitForArmedStart();
    const sellId = sell.json().id as string;
    assertFinalState = async () => {
      const store = await app.persistence.loadStore("user-1");
      expect(store.accounting.facts.tradeEvents).toContainEqual(expect.objectContaining({
        id: sellId,
        type: "SELL",
        quantity: 5,
        realizedPnlAmount: 100,
      }));
      expect(store.accounting.projections.lotAllocations
        .filter((allocation) => allocation.tradeEventId === sellId)
        .reduce((sum, allocation) => sum + allocation.allocatedQuantity, 0)).toBe(5);
      expect(store.accounting.projections.lots
        .filter((lot) => lot.accountId === accountId && lot.ticker === ticker)
        .reduce((sum, lot) => sum + lot.openQuantity, 0)).toBe(5);
    };
    await assertFinalState();
    await assertFinalState();
  } finally {
    commitGate?.release();
    commitGate?.restore();
    await replay.drain();
  }
  await assertFinalState?.();
}

export async function verifyMcpMaintenanceReplayQueuesNewerWriter(app: TestApp): Promise<void> {
  const accountId = (await app.persistence.loadStore("user-1")).accounts[0]!.id;
  const replay = interceptScheduledReplay(app, accountId);
  let commitGate: ReturnType<typeof gateNextBackgroundReplayCommit> | undefined;
  let assertFinalState: (() => Promise<void>) | undefined;
  try {
    const buy = await postTrade(app, accountId, "mcp-maintenance-seed-buy", {
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-07-01",
    });
    expect(buy.statusCode).toBe(200);
    await replay.waitForSettled(1);

    const preview = await previewReplayPortfolioPositions({
      app,
      requestContext: {
        resolvedContext: {
          sessionUserId: "user-1",
          portfolioContextUserId: "user-1",
          shareId: null,
          shareCapabilities: [],
        },
        logger: app.log,
      },
    } as never, {
      accountIds: [accountId],
      tickerMarkets: [{ ticker, marketCode: "TW" }],
    });
    const runId = randomUUID();
    await app.persistence.createMcpReplayRun({
      id: runId,
      previewId: preview.id,
      sessionUserId: "user-1",
      portfolioContextUserId: "user-1",
      status: "queued",
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      scopes: preview.scopes.map((scope) => ({
        ...scope,
        status: "pending",
        errorMessage: null,
        replayedTradeCount: null,
        snapshotGenerationRunId: null,
        updatedAt: new Date().toISOString(),
      })),
    });

    commitGate = gateNextBackgroundReplayCommit(app);
    replay.arm(1);
    const maintenancePromise = executeReplayRun(app, "user-1", runId);
    await commitGate.entered;

    let newerWriteSettled = false;
    const newerBuyPromise = postTrade(app, accountId, "mcp-maintenance-newer-buy", {
      quantity: 5,
      unitPrice: 120,
      tradeDate: "2026-07-02",
    }).finally(() => {
      newerWriteSettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(newerWriteSettled).toBe(false);

    commitGate.release();
    const [newerBuy] = await Promise.all([newerBuyPromise, maintenancePromise.then(() => undefined)]);
    expect(newerBuy.statusCode).toBe(200);
    await replay.waitForArmedStart();
    const newerBuyId = newerBuy.json().id as string;
    assertFinalState = async () => {
      const [store, run] = await Promise.all([
        app.persistence.loadStore("user-1"),
        app.persistence.getMcpReplayRun(runId),
      ]);
      expect(run).toMatchObject({
        status: "completed",
        scopes: [expect.objectContaining({ status: "succeeded" })],
      });
      expect(store.accounting.facts.tradeEvents).toContainEqual(expect.objectContaining({
        id: newerBuyId,
        type: "BUY",
        quantity: 5,
      }));
      expect(store.accounting.facts.tradeEvents
        .filter((trade) => trade.accountId === accountId && trade.ticker === ticker)).toHaveLength(2);
      expect(store.accounting.projections.lotAllocations
        .filter((allocation) => allocation.accountId === accountId && allocation.ticker === ticker)).toHaveLength(0);
      expect(store.accounting.projections.lots
        .filter((lot) => lot.accountId === accountId && lot.ticker === ticker)
        .reduce((sum, lot) => sum + lot.openQuantity, 0)).toBe(15);
    };
    await assertFinalState();
    await assertFinalState();
  } finally {
    commitGate?.release();
    commitGate?.restore();
    await replay.drain();
  }
  await assertFinalState?.();
}

export async function verifyPostedMutationRebuildQueuesNewerWriter(app: TestApp): Promise<void> {
  const accountId = (await app.persistence.loadStore("user-1")).accounts[0]!.id;
  const replay = interceptScheduledReplay(app, accountId);
  let commitGate: ReturnType<typeof gateNextBackgroundReplayCommit> | undefined;
  let assertFinalState: (() => Promise<void>) | undefined;
  try {
    const buy = await postTrade(app, accountId, "posted-mutation-seed-buy", {
      quantity: 10,
      unitPrice: 100,
      tradeDate: "2026-08-01",
    });
    expect(buy.statusCode).toBe(200);
    await replay.waitForSettled(1);
    const tradeId = buy.json().id as string;

    const preview = await previewPostedTransactionUpdateBatch(app.persistence, {
      ownerUserId: "user-1",
      actorUserId: "user-1",
      reason: "Correct booked quantity before a newer write",
      appBaseUrl: "http://localhost",
      items: [{ transactionId: tradeId, patch: { quantity: 12 } }],
    });
    const confirmed = await confirmPostedTransactionMutation(app.persistence, {
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

    commitGate = gateNextBackgroundReplayCommit(app);
    replay.arm(1);
    const rebuildPromise = dispatchPostedTransactionMutationRebuild(app.persistence, {
      ownerUserId: "user-1",
      runId: confirmed.runId,
      eventBus: app.eventBus,
    });
    await commitGate.entered;

    let newerWriteSettled = false;
    const newerBuyPromise = postTrade(app, accountId, "posted-mutation-newer-buy", {
      quantity: 5,
      unitPrice: 120,
      tradeDate: "2026-08-02",
    }).finally(() => {
      newerWriteSettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(newerWriteSettled).toBe(false);

    commitGate.release();
    const [newerBuy] = await Promise.all([newerBuyPromise, rebuildPromise.then(() => undefined)]);
    expect(newerBuy.statusCode).toBe(200);
    await replay.waitForArmedStart();
    const newerBuyId = newerBuy.json().id as string;
    assertFinalState = async () => {
      const [store, run] = await Promise.all([
        app.persistence.loadStore("user-1"),
        app.persistence.getPostedTransactionMutationRun(confirmed.runId),
      ]);
      expect(run).toMatchObject({
        status: "completed",
        rebuildStatus: "completed",
        scopes: [expect.objectContaining({ status: "completed" })],
      });
      expect(store.accounting.facts.tradeEvents).toContainEqual(expect.objectContaining({
        id: tradeId,
        type: "BUY",
        quantity: 12,
      }));
      expect(store.accounting.facts.tradeEvents).toContainEqual(expect.objectContaining({
        id: newerBuyId,
        type: "BUY",
        quantity: 5,
      }));
      expect(store.accounting.projections.lotAllocations
        .filter((allocation) => allocation.accountId === accountId && allocation.ticker === ticker)).toHaveLength(0);
      expect(store.accounting.projections.lots
        .filter((lot) => lot.accountId === accountId && lot.ticker === ticker)
        .reduce((sum, lot) => sum + lot.openQuantity, 0)).toBe(17);
    };
    await assertFinalState();
    await assertFinalState();
  } finally {
    commitGate?.release();
    commitGate?.restore();
    await replay.drain();
  }
  await assertFinalState?.();
}
