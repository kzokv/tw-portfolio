import { createHash, randomUUID } from "node:crypto";
import { MemoryPersistence } from "../persistence/memory.js";
import type {
  DividendDestructiveAffectedCounts,
  DividendDestructiveDividendImpactRecord,
  DividendDestructiveOperationKind,
  DividendDestructivePreviewRecord,
  DividendDestructivePreviewState,
  DividendDestructiveReviewedArtifacts,
  Persistence,
} from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";
import { replayPositionHistory } from "./replayPositionHistory.js";
import { resolveDividendEventMarketCode, resolveDividendPostingDate } from "./dividends.js";
import type {
  AccountingStore,
  BookedTradeEvent,
  DividendLedgerEntry,
  PositionAction,
  Store,
} from "../types/store.js";

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const USER_WIDE_DESTRUCTIVE_LOCK = "__all_accounts__";

type TouchedScope = {
  accountId: string;
  ticker: string;
  marketCode: string;
};

type TradeDeleteOperation = {
  kind: "trade_delete";
  tradeEventId: string;
  reason: string;
};

type AccountCutoffOperation = {
  kind: "account_cutoff_purge";
  accountId: string;
  cutoffDate: string;
  reason: string;
};

type DestructiveOperation = TradeDeleteOperation | AccountCutoffOperation;

type OperationState = {
  ownerUserId: string;
  accountId: string;
  operationKind: DividendDestructiveOperationKind;
  operationKey: string;
  targetTradeEventId: string | null;
  cutoffDate: string | null;
  snapshotFromDate: string;
  reason: string;
  deletedTradeEventIds: string[];
  deletedPositionActionIds: string[];
  deletedPositionActions: PositionAction[];
  touchedScopes: TouchedScope[];
};

type SimulationResult = {
  operation: OperationState;
  fingerprint: string;
  affectedCounts: DividendDestructiveAffectedCounts;
  affectedDividends: DividendDestructiveDividendImpactRecord[];
  manualReceiptReentryLedgerEntryIds: string[];
  reviewedArtifacts: DividendDestructiveReviewedArtifacts;
  finalAccounting: AccountingStore;
};

type PreviewResponse = {
  preview: DividendDestructivePreviewState;
  operation: {
    kind: DividendDestructiveOperationKind;
    accountId: string;
    targetTradeEventId: string | null;
    cutoffDate: string | null;
    reason: string;
    replayScopes: Array<TouchedScope & { fromDate: string }>;
  };
  affectedGroups: {
    source: {
      tradeEventIds: string[];
      positionActionIds: string[];
    };
    derived: {
      dividendEventIds: string[];
      dividendLedgerEntryIds: string[];
      cashLedgerEntryIds: string[];
      dividendDeductionEntryIds: string[];
      dividendSourceLineIds: string[];
      stockDividendPositionActionIds: string[];
      holdingSnapshotIds: string[];
      lotAllocationTradeEventIds: string[];
    };
  };
  affectedCounts: DividendDestructiveAffectedCounts;
  affectedDividends: DividendDestructiveDividendImpactRecord[];
  manualReceiptReentryLedgerEntryIds: string[];
};

function sortIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function activeDividendEntries(store: Store, accountId: string, ticker: string, marketCode: string): DividendLedgerEntry[] {
  const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
  return store.accounting.facts.dividendLedgerEntries.filter((entry) => {
    if (entry.accountId !== accountId) return false;
    if (entry.reversalOfDividendLedgerEntryId || entry.supersededAt) return false;
    const event = eventById.get(entry.dividendEventId);
    return Boolean(event && event.ticker === ticker && (event.marketCode ?? null) === marketCode);
  });
}

function findTrade(store: Store, ownerUserId: string, tradeEventId: string): BookedTradeEvent {
  const trade = store.accounting.facts.tradeEvents.find((entry) => entry.id === tradeEventId && entry.userId === ownerUserId);
  if (!trade) {
    throw routeError(404, "trade_event_not_found", "Trade event not found");
  }
  return trade;
}

function buildOperationState(store: Store, ownerUserId: string, operation: DestructiveOperation): OperationState {
  if (operation.kind === "trade_delete") {
    const trade = findTrade(store, ownerUserId, operation.tradeEventId);
    return {
      ownerUserId,
      accountId: trade.accountId,
      operationKind: "trade_delete",
      operationKey: `trade_delete:${trade.accountId}:${trade.id}`,
      targetTradeEventId: trade.id,
      cutoffDate: null,
      snapshotFromDate: trade.tradeDate,
      reason: operation.reason,
      deletedTradeEventIds: [trade.id],
      deletedPositionActionIds: [],
      deletedPositionActions: [],
      touchedScopes: [{
        accountId: trade.accountId,
        ticker: trade.ticker,
        marketCode: trade.marketCode,
      }],
    };
  }

  const account = store.accounts.find((entry) => entry.id === operation.accountId && entry.userId === ownerUserId);
  if (!account) {
    throw routeError(404, "account_not_found", "Account not found");
  }

  const deletedTrades = store.accounting.facts.tradeEvents.filter((entry) =>
    entry.userId === ownerUserId
    && entry.accountId === operation.accountId
    && entry.tradeDate >= operation.cutoffDate);
  const deletedPositionActions = store.accounting.facts.positionActions.filter((entry) =>
    entry.accountId === operation.accountId
    && entry.actionDate >= operation.cutoffDate);
  const scopeMap = new Map<string, TouchedScope>();
  for (const trade of deletedTrades) {
    scopeMap.set(`${trade.accountId}:${trade.ticker}:${trade.marketCode}`, {
      accountId: trade.accountId,
      ticker: trade.ticker,
      marketCode: trade.marketCode,
    });
  }
  for (const action of deletedPositionActions) {
    scopeMap.set(`${action.accountId}:${action.ticker}:${action.marketCode}`, {
      accountId: action.accountId,
      ticker: action.ticker,
      marketCode: action.marketCode,
    });
  }
  const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
  for (const entry of store.accounting.facts.dividendLedgerEntries) {
    if (entry.accountId !== operation.accountId || entry.reversalOfDividendLedgerEntryId || entry.supersededAt) continue;
    const event = eventById.get(entry.dividendEventId);
    if (!event || resolveDividendPostingDate(event.paymentDate, entry.bookedAt) < operation.cutoffDate) continue;
    const marketCode = resolveDividendEventMarketCode(event);
    scopeMap.set(`${entry.accountId}:${event.ticker}:${marketCode}`, {
      accountId: entry.accountId,
      ticker: event.ticker,
      marketCode,
    });
  }

  return {
    ownerUserId,
    accountId: operation.accountId,
    operationKind: "account_cutoff_purge",
    operationKey: `account_cutoff_purge:${operation.accountId}:${operation.cutoffDate}`,
    targetTradeEventId: null,
    cutoffDate: operation.cutoffDate,
    snapshotFromDate: operation.cutoffDate,
    reason: operation.reason,
    deletedTradeEventIds: deletedTrades.map((entry) => entry.id),
    deletedPositionActionIds: deletedPositionActions.map((entry) => entry.id),
    deletedPositionActions,
    touchedScopes: [...scopeMap.values()].sort((left, right) =>
      left.ticker.localeCompare(right.ticker) || left.marketCode.localeCompare(right.marketCode)),
  };
}

function applySourceDeletions(store: Store, state: OperationState): void {
  if (state.deletedTradeEventIds.length > 0) {
    const deletedTradeIds = new Set(state.deletedTradeEventIds);
    store.accounting.facts.tradeEvents = store.accounting.facts.tradeEvents.filter((entry) => !deletedTradeIds.has(entry.id));
  }
  if (state.deletedPositionActionIds.length > 0) {
    const deletedActionIds = new Set(state.deletedPositionActionIds);
    const deletedStockDividendLotIds = new Set(
      state.deletedPositionActions
        .filter((entry) => entry.actionType === "STOCK_DIVIDEND")
        .map((entry) => `lot-pa-${entry.id}`),
    );
    if (deletedStockDividendLotIds.size > 0) {
      store.accounting.projections.lotAllocations = store.accounting.projections.lotAllocations.filter(
        (entry) => !deletedStockDividendLotIds.has(entry.lotId),
      );
      store.accounting.projections.lots = store.accounting.projections.lots.filter(
        (entry) => !deletedStockDividendLotIds.has(entry.id),
      );
    }
    store.accounting.facts.positionActions = store.accounting.facts.positionActions.filter((entry) => !deletedActionIds.has(entry.id));
  }
}

function buildFingerprint(store: Store, state: OperationState): string {
  const scopeKeys = new Set(state.touchedScopes.map((scope) => `${scope.accountId}:${scope.ticker}:${scope.marketCode}`));
  const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
  const payload = {
    operationKind: state.operationKind,
    accountId: state.accountId,
    targetTradeEventId: state.targetTradeEventId,
    cutoffDate: state.cutoffDate,
    deletedTradeEventIds: state.deletedTradeEventIds,
    deletedPositionActionIds: state.deletedPositionActionIds,
    trades: store.accounting.facts.tradeEvents
      .filter((entry) => scopeKeys.has(`${entry.accountId}:${entry.ticker}:${entry.marketCode}`))
      .map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        ticker: entry.ticker,
        marketCode: entry.marketCode,
        type: entry.type,
        quantity: entry.quantity,
        unitPrice: entry.unitPrice,
        tradeDate: entry.tradeDate,
        commissionAmount: entry.commissionAmount,
        taxAmount: entry.taxAmount,
      })),
    positionActions: store.accounting.facts.positionActions
      .filter((entry) => scopeKeys.has(`${entry.accountId}:${entry.ticker}:${entry.marketCode}`))
      .map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        ticker: entry.ticker,
        marketCode: entry.marketCode,
        actionType: entry.actionType,
        actionDate: entry.actionDate,
        quantity: entry.quantity,
        relatedDividendLedgerEntryId: entry.relatedDividendLedgerEntryId ?? null,
        supersededAt: entry.supersededAt ?? null,
        reversalOfPositionActionId: entry.reversalOfPositionActionId ?? null,
      })),
    dividendLedgerEntries: store.accounting.facts.dividendLedgerEntries
      .filter((entry) => {
        if (entry.reversalOfDividendLedgerEntryId || entry.supersededAt) return false;
        const event = eventById.get(entry.dividendEventId);
        return Boolean(event && scopeKeys.has(`${entry.accountId}:${event.ticker}:${event.marketCode ?? ""}`));
      })
      .map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        dividendEventId: entry.dividendEventId,
        eligibleQuantity: entry.eligibleQuantity,
        expectedCashAmount: entry.expectedCashAmount,
        expectedStockQuantity: entry.expectedStockQuantity,
        receivedCashAmount: entry.receivedCashAmount,
        receivedStockQuantity: entry.receivedStockQuantity,
        postingStatus: entry.postingStatus,
        reconciliationStatus: entry.reconciliationStatus,
        version: entry.version,
      })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function simulateReplayChanges(store: Store, state: OperationState): Promise<{
  workingStore: Store;
  changedDividendIds: Set<string>;
  affectedDividends: DividendDestructiveDividendImpactRecord[];
}> {
  const memory = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
  await memory.init();
  const workingStore = structuredClone(store);
  applySourceDeletions(workingStore, state);
  await memory.saveStore(workingStore);

  const allChanges = new Map<string, DividendDestructiveDividendImpactRecord>();
  if (state.operationKind === "account_cutoff_purge" && state.cutoffDate) {
    const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
    for (const current of store.accounting.facts.dividendLedgerEntries) {
      if (current.accountId !== state.accountId || current.reversalOfDividendLedgerEntryId || current.supersededAt) continue;
      const event = eventById.get(current.dividendEventId);
      if (!event || resolveDividendPostingDate(event.paymentDate, current.bookedAt) < state.cutoffDate) continue;
      allChanges.set(`${current.accountId}:${current.dividendEventId}`, {
        accountId: current.accountId,
        dividendEventId: current.dividendEventId,
        dividendLedgerEntryId: current.id,
        postingStatus: current.postingStatus,
        beforeEligibleQuantity: current.eligibleQuantity,
        afterEligibleQuantity: current.eligibleQuantity,
        beforeExpectedCashAmount: current.expectedCashAmount,
        afterExpectedCashAmount: current.expectedCashAmount,
        beforeExpectedStockQuantity: current.expectedStockQuantity,
        afterExpectedStockQuantity: current.expectedStockQuantity,
        cashLedgerEntryIds: sortIds(store.accounting.facts.cashLedgerEntries
          .filter((entry) => entry.relatedDividendLedgerEntryId === current.id).map((entry) => entry.id)),
        dividendDeductionEntryIds: sortIds(store.accounting.facts.dividendDeductionEntries
          .filter((entry) => entry.dividendLedgerEntryId === current.id).map((entry) => entry.id)),
        dividendSourceLineIds: sortIds(store.accounting.facts.dividendSourceLines
          .filter((entry) => entry.dividendLedgerEntryId === current.id).map((entry) => entry.id)),
        stockDividendPositionActionIds: sortIds(store.accounting.facts.positionActions
          .filter((entry) => entry.relatedDividendLedgerEntryId === current.id).map((entry) => entry.id)),
        requiresManualReceiptReentry: current.postingStatus !== "expected",
      });
    }
  }
  for (const scope of state.touchedScopes) {
    const currentEntries = activeDividendEntries(store, scope.accountId, scope.ticker, scope.marketCode);
    const currentByEventId = new Map(currentEntries.map((entry) => [entry.dividendEventId, entry]));
    const summary = await replayPositionHistory(memory, state.ownerUserId, scope.accountId, scope.ticker, {
      marketCode: scope.marketCode,
      deletedTradeEventIds: state.deletedTradeEventIds,
    });
    for (const change of summary.dividendLedgerChanges) {
      const current = currentByEventId.get(change.dividendEventId);
      const cashLedgerEntryIds = sortIds(
        store.accounting.facts.cashLedgerEntries
          .filter((entry) => entry.relatedDividendLedgerEntryId === current?.id)
          .map((entry) => entry.id),
      );
      const dividendDeductionEntryIds = sortIds(
        store.accounting.facts.dividendDeductionEntries
          .filter((entry) => entry.dividendLedgerEntryId === current?.id)
          .map((entry) => entry.id),
      );
      const dividendSourceLineIds = sortIds(
        store.accounting.facts.dividendSourceLines
          .filter((entry) => entry.dividendLedgerEntryId === current?.id)
          .map((entry) => entry.id),
      );
      const stockDividendPositionActionIds = sortIds(
        store.accounting.facts.positionActions
          .filter((entry) => entry.relatedDividendLedgerEntryId === current?.id)
          .map((entry) => entry.id),
      );
      allChanges.set(`${change.accountId}:${change.dividendEventId}`, {
        accountId: change.accountId,
        dividendEventId: change.dividendEventId,
        dividendLedgerEntryId: current?.id ?? (change.changeKind === "created" ? null : change.ledgerEntryId),
        postingStatus: current?.postingStatus ?? null,
        beforeEligibleQuantity: change.previousEligibleQuantity,
        afterEligibleQuantity: change.nextEligibleQuantity,
        beforeExpectedCashAmount: change.previousExpectedCashAmount,
        afterExpectedCashAmount: change.nextExpectedCashAmount,
        beforeExpectedStockQuantity: change.previousExpectedStockQuantity,
        afterExpectedStockQuantity: change.nextExpectedStockQuantity,
        cashLedgerEntryIds,
        dividendDeductionEntryIds,
        dividendSourceLineIds,
        stockDividendPositionActionIds,
        requiresManualReceiptReentry: Boolean(current && current.postingStatus !== "expected"),
      });
    }
  }

  for (const action of state.deletedPositionActions) {
    if (!action.relatedDividendLedgerEntryId) continue;
    const current = store.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.id === action.relatedDividendLedgerEntryId && !entry.reversalOfDividendLedgerEntryId && !entry.supersededAt,
    );
    if (!current) continue;
    const event = store.marketData.dividendEvents.find((entry) => entry.id === current.dividendEventId);
    if (!event) continue;
    const key = `${current.accountId}:${current.dividendEventId}`;
    if (allChanges.has(key)) continue;
    allChanges.set(key, {
      accountId: current.accountId,
      dividendEventId: current.dividendEventId,
      dividendLedgerEntryId: current.id,
      postingStatus: current.postingStatus,
      beforeEligibleQuantity: current.eligibleQuantity,
      afterEligibleQuantity: current.eligibleQuantity,
      beforeExpectedCashAmount: current.expectedCashAmount,
      afterExpectedCashAmount: current.expectedCashAmount,
      beforeExpectedStockQuantity: current.expectedStockQuantity,
      afterExpectedStockQuantity: current.expectedStockQuantity,
      cashLedgerEntryIds: sortIds(store.accounting.facts.cashLedgerEntries
        .filter((entry) => entry.relatedDividendLedgerEntryId === current.id).map((entry) => entry.id)),
      dividendDeductionEntryIds: sortIds(store.accounting.facts.dividendDeductionEntries
        .filter((entry) => entry.dividendLedgerEntryId === current.id).map((entry) => entry.id)),
      dividendSourceLineIds: sortIds(store.accounting.facts.dividendSourceLines
        .filter((entry) => entry.dividendLedgerEntryId === current.id).map((entry) => entry.id)),
      stockDividendPositionActionIds: sortIds(store.accounting.facts.positionActions
        .filter((entry) => entry.relatedDividendLedgerEntryId === current.id).map((entry) => entry.id)),
      requiresManualReceiptReentry: current.postingStatus !== "expected",
    });
  }

  return {
    workingStore: await memory.loadStore(state.ownerUserId),
    changedDividendIds: new Set(
      [...allChanges.values()]
        .map((entry) => entry.dividendLedgerEntryId)
        .filter((value): value is string => Boolean(value)),
    ),
    affectedDividends: [...allChanges.values()].sort((left, right) =>
      left.accountId.localeCompare(right.accountId) || left.dividendEventId.localeCompare(right.dividendEventId)),
  };
}

function buildReviewedArtifacts(
  store: Store,
  state: OperationState,
  affectedDividends: DividendDestructiveDividendImpactRecord[],
): DividendDestructiveReviewedArtifacts {
  const deletedTradeIds = new Set(state.deletedTradeEventIds);
  return {
    source: {
      tradeEventIds: sortIds(state.deletedTradeEventIds),
      positionActionIds: sortIds(state.deletedPositionActionIds),
      lotAllocationIds: sortIds(
        store.accounting.projections.lotAllocations
          .filter((entry) => deletedTradeIds.has(entry.tradeEventId))
          .map((entry) => entry.id),
      ),
      lotAllocationTradeEventIds: sortIds(
        store.accounting.projections.lotAllocations
          .filter((entry) => deletedTradeIds.has(entry.tradeEventId))
          .map((entry) => entry.tradeEventId),
      ),
    },
    derived: {
      dividendEventIds: sortIds(affectedDividends.map((entry) => entry.dividendEventId)),
      dividendLedgerEntryIds: sortIds(
        affectedDividends
          .map((entry) => entry.dividendLedgerEntryId)
          .filter((value): value is string => Boolean(value)),
      ),
      cashLedgerEntryIds: sortIds(affectedDividends.flatMap((entry) => entry.cashLedgerEntryIds)),
      dividendDeductionEntryIds: sortIds(affectedDividends.flatMap((entry) => entry.dividendDeductionEntryIds)),
      dividendSourceLineIds: sortIds(affectedDividends.flatMap((entry) => entry.dividendSourceLineIds)),
      stockDividendPositionActionIds: sortIds(affectedDividends.flatMap((entry) => entry.stockDividendPositionActionIds)),
      holdingSnapshotIds: [],
    },
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function sameReviewedSet(simulation: SimulationResult, preview: DividendDestructivePreviewState): boolean {
  return stableStringify(simulation.affectedCounts) === stableStringify(preview.affectedCounts)
    && stableStringify(simulation.affectedDividends) === stableStringify(preview.affectedDividends)
    && stableStringify(simulation.manualReceiptReentryLedgerEntryIds) === stableStringify(preview.manualReceiptReentryLedgerEntryIds)
    && stableStringify(simulation.reviewedArtifacts) === stableStringify(preview.reviewedArtifacts);
}

function purgeAffectedDividendArtifacts(store: Store, affectedLedgerEntryIds: Set<string>): void {
  if (affectedLedgerEntryIds.size === 0) return;
  store.accounting.facts.dividendLedgerEntries = store.accounting.facts.dividendLedgerEntries.filter(
    (entry) => !affectedLedgerEntryIds.has(entry.id),
  );
  store.accounting.facts.dividendDeductionEntries = store.accounting.facts.dividendDeductionEntries.filter(
    (entry) => !affectedLedgerEntryIds.has(entry.dividendLedgerEntryId),
  );
  store.accounting.facts.dividendSourceLines = store.accounting.facts.dividendSourceLines.filter(
    (entry) => !affectedLedgerEntryIds.has(entry.dividendLedgerEntryId),
  );
  store.accounting.facts.cashLedgerEntries = store.accounting.facts.cashLedgerEntries.filter(
    (entry) => !entry.relatedDividendLedgerEntryId || !affectedLedgerEntryIds.has(entry.relatedDividendLedgerEntryId),
  );
  store.accounting.facts.positionActions = store.accounting.facts.positionActions.filter(
    (entry) => !entry.relatedDividendLedgerEntryId || !affectedLedgerEntryIds.has(entry.relatedDividendLedgerEntryId),
  );
}

function buildAffectedCounts(store: Store, state: OperationState, affectedLedgerEntryIds: Set<string>): DividendDestructiveAffectedCounts {
  const deletedTradeIds = new Set(state.deletedTradeEventIds);
  return {
    tradeEvents: state.deletedTradeEventIds.length,
    positionActions: state.deletedPositionActionIds.length,
    dividendLedgerEntries: affectedLedgerEntryIds.size,
    cashLedgerEntries: store.accounting.facts.cashLedgerEntries.filter((entry) =>
      deletedTradeIds.has(entry.relatedTradeEventId ?? "")
      || affectedLedgerEntryIds.has(entry.relatedDividendLedgerEntryId ?? "")).length,
    dividendDeductionEntries: store.accounting.facts.dividendDeductionEntries.filter((entry) =>
      affectedLedgerEntryIds.has(entry.dividendLedgerEntryId)).length,
    dividendSourceLines: store.accounting.facts.dividendSourceLines.filter((entry) =>
      affectedLedgerEntryIds.has(entry.dividendLedgerEntryId)).length,
    lotAllocations: store.accounting.projections.lotAllocations.filter((entry) =>
      deletedTradeIds.has(entry.tradeEventId)).length,
    stockDividendPositionActions: store.accounting.facts.positionActions.filter((entry) =>
      affectedLedgerEntryIds.has(entry.relatedDividendLedgerEntryId ?? "")).length,
    holdingSnapshots: 0,
  };
}

async function buildSimulation(persistence: Persistence, ownerUserId: string, operation: DestructiveOperation): Promise<SimulationResult> {
  const store = await persistence.loadStore(ownerUserId);
  const state = buildOperationState(store, ownerUserId, operation);
  const fingerprint = buildFingerprint(store, state);
  const replaySimulation = await simulateReplayChanges(store, state);
  const affectedLedgerEntryIds = replaySimulation.changedDividendIds;
  const manualReceiptReentryLedgerEntryIds = replaySimulation.affectedDividends
    .filter((entry) => entry.requiresManualReceiptReentry && entry.dividendLedgerEntryId)
    .map((entry) => entry.dividendLedgerEntryId!) ;
  const finalStore = structuredClone(store);
  applySourceDeletions(finalStore, state);
  purgeAffectedDividendArtifacts(finalStore, affectedLedgerEntryIds);
  const finalMemory = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
  await finalMemory.init();
  await finalMemory.saveStore(finalStore);
  for (const scope of state.touchedScopes) {
    await replayPositionHistory(finalMemory, ownerUserId, scope.accountId, scope.ticker, {
      marketCode: scope.marketCode,
      deletedTradeEventIds: state.deletedTradeEventIds,
    });
  }
  const persistedFinalStore = await finalMemory.loadStore(ownerUserId);
  const affectedCounts = buildAffectedCounts(store, state, affectedLedgerEntryIds);
  const affectedHoldingSnapshots = (await Promise.all(state.touchedScopes.map(async (scope) =>
    (await persistence.getHoldingSnapshotsForTicker(
      ownerUserId,
      scope.accountId,
      scope.ticker,
      state.snapshotFromDate,
      "9999-12-31",
    )).filter((snapshot) => snapshot.marketCode === scope.marketCode)
  ))).flat();
  affectedCounts.holdingSnapshots = affectedHoldingSnapshots.length;
  const reviewedArtifacts = buildReviewedArtifacts(store, state, replaySimulation.affectedDividends);
  reviewedArtifacts.derived.holdingSnapshotIds = sortIds(affectedHoldingSnapshots.map((snapshot) => snapshot.id));
  return {
    operation: state,
    fingerprint,
    affectedCounts,
    affectedDividends: replaySimulation.affectedDividends,
    manualReceiptReentryLedgerEntryIds,
    reviewedArtifacts,
    finalAccounting: persistedFinalStore.accounting,
  };
}

function toPreviewResponse(
  preview: DividendDestructivePreviewState,
  operation?: Pick<OperationState, "touchedScopes" | "snapshotFromDate">,
): PreviewResponse {
  return {
    preview,
    operation: {
      kind: preview.operationKind,
      accountId: preview.accountId,
      targetTradeEventId: preview.targetTradeEventId ?? null,
      cutoffDate: preview.cutoffDate ?? null,
      reason: preview.reason,
      replayScopes: (operation?.touchedScopes ?? []).map((scope) => ({
        ...scope,
        fromDate: operation?.snapshotFromDate ?? "1970-01-01",
      })),
    },
    affectedGroups: {
      source: {
        tradeEventIds: preview.reviewedArtifacts.source.tradeEventIds,
        positionActionIds: preview.reviewedArtifacts.source.positionActionIds,
      },
      derived: {
        dividendEventIds: preview.reviewedArtifacts.derived.dividendEventIds,
        dividendLedgerEntryIds: preview.reviewedArtifacts.derived.dividendLedgerEntryIds,
        cashLedgerEntryIds: preview.reviewedArtifacts.derived.cashLedgerEntryIds,
        dividendDeductionEntryIds: preview.reviewedArtifacts.derived.dividendDeductionEntryIds,
        dividendSourceLineIds: preview.reviewedArtifacts.derived.dividendSourceLineIds,
        stockDividendPositionActionIds: preview.reviewedArtifacts.derived.stockDividendPositionActionIds,
        holdingSnapshotIds: preview.reviewedArtifacts.derived.holdingSnapshotIds,
        lotAllocationTradeEventIds: preview.reviewedArtifacts.source.lotAllocationTradeEventIds,
      },
    },
    affectedCounts: preview.affectedCounts,
    affectedDividends: preview.affectedDividends,
    manualReceiptReentryLedgerEntryIds: preview.manualReceiptReentryLedgerEntryIds,
  };
}

async function createPreview(
  persistence: Persistence,
  ownerUserId: string,
  actorUserId: string | null,
  operation: DestructiveOperation,
  ipAddress?: string | null,
): Promise<PreviewResponse> {
  const simulation = await buildSimulation(persistence, ownerUserId, operation);
  return persistence.withDividendDestructiveLock(ownerUserId, simulation.operation.accountId, async () => {
    const lockedSimulation = await buildSimulation(persistence, ownerUserId, operation);
    const accountRevision = await persistence.getAccountAccountingRevision(ownerUserId, lockedSimulation.operation.accountId);
    const previewId = randomUUID();
    const previewVersion = await persistence.countDividendDestructivePreviews(ownerUserId, lockedSimulation.operation.operationKey) + 1;
    const createdAt = new Date().toISOString();
    const record: DividendDestructivePreviewRecord = {
      previewId,
      previewVersion,
      fingerprint: lockedSimulation.fingerprint,
      operationKind: lockedSimulation.operation.operationKind,
      operationKey: lockedSimulation.operation.operationKey,
      ownerUserId,
      actorUserId,
      accountId: lockedSimulation.operation.accountId,
      accountRevision,
      targetTradeEventId: lockedSimulation.operation.targetTradeEventId,
      cutoffDate: lockedSimulation.operation.cutoffDate,
      reason: lockedSimulation.operation.reason,
      expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
      createdAt,
      affectedCounts: lockedSimulation.affectedCounts,
      affectedDividends: lockedSimulation.affectedDividends,
      manualReceiptReentryLedgerEntryIds: lockedSimulation.manualReceiptReentryLedgerEntryIds,
      reviewedArtifacts: lockedSimulation.reviewedArtifacts,
    };
    await persistence.saveDividendDestructivePreview({ record, ipAddress });
    return toPreviewResponse({
      ...record,
      consumedAt: null,
      consumedResult: null,
    }, lockedSimulation.operation);
  });
}

async function confirmPreview(
  persistence: Persistence,
  ownerUserId: string,
  actorUserId: string | null,
  previewId: string,
  previewVersion: number,
  fingerprint: string,
  expectedResource: {
    operationKind: DividendDestructivePreviewRecord["operationKind"];
    accountId?: string;
    tradeEventId?: string;
  },
  ipAddress?: string | null,
): Promise<PreviewResponse> {
  const preview = await persistence.getDividendDestructivePreview(previewId);
  if (!preview) throw routeError(404, "dividend_destructive_preview_not_found", "Destructive preview not found");
  if (preview.ownerUserId !== ownerUserId) throw routeError(404, "dividend_destructive_preview_not_found", "Destructive preview not found");

  return persistence.withDividendDestructiveLock(ownerUserId, USER_WIDE_DESTRUCTIVE_LOCK, async () => {
    const lockedPreview = await persistence.getDividendDestructivePreview(previewId);
    if (!lockedPreview) throw routeError(404, "dividend_destructive_preview_not_found", "Destructive preview not found");
    if (
      lockedPreview.operationKind !== expectedResource.operationKind
      || (expectedResource.accountId !== undefined && lockedPreview.accountId !== expectedResource.accountId)
      || (expectedResource.tradeEventId !== undefined && lockedPreview.targetTradeEventId !== expectedResource.tradeEventId)
    ) {
      throw routeError(409, "dividend_destructive_preview_resource_mismatch", "Destructive preview does not match the requested resource");
    }
    if (lockedPreview.consumedAt) {
      throw routeError(409, "dividend_destructive_preview_consumed", "Destructive preview has already been consumed");
    }
    if (Date.parse(lockedPreview.expiresAt) <= Date.now()) {
      throw routeError(409, "dividend_destructive_preview_expired", "Destructive preview expired");
    }
    if (lockedPreview.previewVersion !== previewVersion) {
      throw routeError(409, "dividend_destructive_preview_stale", "Destructive preview version is stale");
    }
    const latestPreviewVersion = await persistence.countDividendDestructivePreviews(ownerUserId, lockedPreview.operationKey);
    if (latestPreviewVersion !== lockedPreview.previewVersion) {
      throw routeError(409, "dividend_destructive_preview_stale", "Destructive preview version is stale");
    }
    if (lockedPreview.fingerprint !== fingerprint) {
      throw routeError(409, "dividend_destructive_preview_fingerprint_mismatch", "Destructive preview fingerprint is stale");
    }

    const operation: DestructiveOperation = lockedPreview.operationKind === "trade_delete"
      ? {
          kind: "trade_delete",
          tradeEventId: lockedPreview.targetTradeEventId ?? "",
          reason: lockedPreview.reason,
        }
      : {
          kind: "account_cutoff_purge",
          accountId: lockedPreview.accountId,
          cutoffDate: lockedPreview.cutoffDate ?? "",
          reason: lockedPreview.reason,
        };
    const startedAt = new Date().toISOString();

    try {
      const simulation = await buildSimulation(persistence, ownerUserId, operation);
      if (simulation.fingerprint !== lockedPreview.fingerprint) {
        throw routeError(409, "dividend_destructive_preview_row_drift", "Underlying records changed after preview");
      }
      if (!sameReviewedSet(simulation, lockedPreview)) {
        throw routeError(409, "dividend_destructive_preview_row_drift", "Underlying records changed after preview");
      }

      await persistence.saveAccountingStoreWithAudit(ownerUserId, simulation.finalAccounting, {
        actorUserId,
        action: "dividend_destructive_confirmed",
        targetUserId: ownerUserId,
        ipAddress: ipAddress ?? null,
        metadata: {
          previewId: lockedPreview.previewId,
          previewVersion: lockedPreview.previewVersion,
          fingerprint: lockedPreview.fingerprint,
          operationKind: lockedPreview.operationKind,
          operationKey: lockedPreview.operationKey,
          ownerUserId,
          actorUserId,
          accountId: lockedPreview.accountId,
          targetTradeEventId: lockedPreview.targetTradeEventId ?? null,
          cutoffDate: lockedPreview.cutoffDate ?? null,
          reason: lockedPreview.reason,
          result: "confirmed",
          affectedCounts: simulation.affectedCounts,
          startedAt,
          completedAt: new Date().toISOString(),
        },
      }, {
        accountIds: [lockedPreview.accountId],
        expectedAccountRevision: {
          accountId: lockedPreview.accountId,
          revision: lockedPreview.accountRevision,
        },
        deleteHoldingSnapshotScopes: simulation.operation.touchedScopes.map((scope) => ({
          ...scope,
          fromDate: simulation.operation.snapshotFromDate,
        })),
        clearDividendPreviewPayloadId: lockedPreview.previewId,
      });

      return toPreviewResponse({
        ...lockedPreview,
        affectedCounts: simulation.affectedCounts,
        affectedDividends: simulation.affectedDividends,
        manualReceiptReentryLedgerEntryIds: simulation.manualReceiptReentryLedgerEntryIds,
        reviewedArtifacts: simulation.reviewedArtifacts,
        consumedAt: new Date().toISOString(),
        consumedResult: "confirmed",
      }, simulation.operation);
    } catch (error) {
      await persistence.recordDividendDestructiveOutcome({
        previewId: lockedPreview.previewId,
        ownerUserId,
        actorUserId,
        accountId: lockedPreview.accountId,
        operationKind: lockedPreview.operationKind,
        operationKey: lockedPreview.operationKey,
        previewVersion: lockedPreview.previewVersion,
        fingerprint: lockedPreview.fingerprint,
        targetTradeEventId: lockedPreview.targetTradeEventId ?? null,
        cutoffDate: lockedPreview.cutoffDate ?? null,
        reason: lockedPreview.reason,
        result: "failed",
        affectedCounts: lockedPreview.affectedCounts,
        affectedDividends: lockedPreview.affectedDividends,
        manualReceiptReentryLedgerEntryIds: lockedPreview.manualReceiptReentryLedgerEntryIds,
        reviewedArtifacts: lockedPreview.reviewedArtifacts,
        errorCode: error instanceof Error ? error.name : "unknown_error",
        errorMessage: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: new Date().toISOString(),
        ipAddress,
      });
      throw error;
    }
  });
}

export async function previewTradeDividendDeletion(
  persistence: Persistence,
  input: {
    ownerUserId: string;
    actorUserId: string | null;
    tradeEventId: string;
    reason: string;
    ipAddress?: string | null;
  },
): Promise<PreviewResponse> {
  return createPreview(persistence, input.ownerUserId, input.actorUserId, {
    kind: "trade_delete",
    tradeEventId: input.tradeEventId,
    reason: input.reason,
  }, input.ipAddress);
}

export async function confirmTradeDividendDeletion(
  persistence: Persistence,
  input: {
    ownerUserId: string;
    actorUserId: string | null;
    previewId: string;
    previewVersion: number;
    fingerprint: string;
    tradeEventId: string;
    ipAddress?: string | null;
  },
): Promise<PreviewResponse> {
  return confirmPreview(
    persistence,
    input.ownerUserId,
    input.actorUserId,
    input.previewId,
    input.previewVersion,
    input.fingerprint,
    { operationKind: "trade_delete", tradeEventId: input.tradeEventId },
    input.ipAddress,
  );
}

export async function previewAccountCutoffPurge(
  persistence: Persistence,
  input: {
    ownerUserId: string;
    actorUserId: string | null;
    accountId: string;
    cutoffDate: string;
    reason: string;
    ipAddress?: string | null;
  },
): Promise<PreviewResponse> {
  return createPreview(persistence, input.ownerUserId, input.actorUserId, {
    kind: "account_cutoff_purge",
    accountId: input.accountId,
    cutoffDate: input.cutoffDate,
    reason: input.reason,
  }, input.ipAddress);
}

export async function confirmAccountCutoffPurge(
  persistence: Persistence,
  input: {
    ownerUserId: string;
    actorUserId: string | null;
    previewId: string;
    previewVersion: number;
    fingerprint: string;
    accountId: string;
    ipAddress?: string | null;
  },
): Promise<PreviewResponse> {
  return confirmPreview(
    persistence,
    input.ownerUserId,
    input.actorUserId,
    input.previewId,
    input.previewVersion,
    input.fingerprint,
    { operationKind: "account_cutoff_purge", accountId: input.accountId },
    input.ipAddress,
  );
}
