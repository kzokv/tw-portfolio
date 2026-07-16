import { createHash, randomUUID } from "node:crypto";
import { calculateBuyFees, calculateSellFees, roundToDecimal } from "@vakwen/domain";
import type {
  MarketCode,
  PostedTransactionMutationConfirmRequestDto,
  PostedTransactionMutationDeleteItemDto,
  PostedTransactionMutationErrorDto,
  PostedTransactionMutationImpactSummaryDto,
  PostedTransactionMutationOperation,
  PostedTransactionMutationPreviewDto,
  PostedTransactionMutationPreviewItemDto,
  PostedTransactionMutationPreviewQueryDto,
  PostedTransactionMutationRunDto,
  PostedTransactionMutationScopeDto,
  PostedTransactionMutationScopeStatus,
  PostedTransactionMutationTransactionFactsDto,
  PostedTransactionMutationUpdateItemDto,
} from "@vakwen/shared-types";
import { MemoryPersistence } from "../persistence/memory.js";
import type { Persistence, TradeEventPatch } from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";
import { replayPositionHistory } from "./replayPositionHistory.js";
import { recomputeSnapshotsForTicker } from "./snapshotGeneration.js";
import { canonicalJsonStringify } from "./canonicalJson.js";
import type { BookedTradeEvent, Store } from "../types/store.js";
import { MCP_REPLAY_POSITION_RUN_QUEUE } from "./mcpPortfolioMaintenance.js";

const PREVIEW_TTL_MS = 30 * 60 * 1000;
const INITIAL_PREVIEW_PAGE_LIMIT = 50;
const MUTATION_REBUILD_MAX_ATTEMPTS = 3;

type ReplayScope = {
  accountId: string;
  accountName: string;
  ticker: string;
  marketCode: MarketCode;
  fromDate: string;
  accountRevision: number;
  fingerprint: string;
  deletedTradeEventIds?: string[];
};

type ScopeLike = {
  accountId: string;
  ticker: string;
  marketCode: string;
};

type PreviewResult = {
  record: import("../persistence/types.js").PostedTransactionMutationPreviewRecord;
  page: PostedTransactionMutationPreviewItemDto[];
};

type MutationEventBus = {
  publishEvent(userId: string, type: string, payload: unknown): Promise<void>;
};

type MutationSideEffects = {
  eventBus?: MutationEventBus;
};

type CacheInvalidationPayload = {
  invalidatedReads: string[];
  invalidatedRoutes: string[];
};

function asMutationErrors(
  errors: readonly import("../persistence/types.js").PostedTransactionMutationErrorRecord[],
): PostedTransactionMutationErrorDto[] {
  return errors.map((error) => ({
    code: error.code as PostedTransactionMutationErrorDto["code"],
    message: error.message,
    transactionId: error.transactionId ?? null,
  }));
}

function asFactsRecord(
  facts: PostedTransactionMutationTransactionFactsDto | null,
): Record<string, unknown> | null {
  return facts ? (facts as unknown as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asMarketCode(value: unknown): MarketCode | null {
  return value === "TW" || value === "US" || value === "AU" || value === "KR" || value === "JP" ? value : null;
}

function asScopeStatus(value: unknown): PostedTransactionMutationScopeStatus | undefined {
  return value === "queued" || value === "running" || value === "completed" || value === "partially_failed" || value === "failed"
    ? value
    : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function hasErrorCode(error: unknown, code: string): error is Error & { code: string } {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === code;
}

function mapPreviewFactsRecord(
  facts: Record<string, unknown> | null,
): PostedTransactionMutationTransactionFactsDto | null {
  if (!facts) return null;

  const transactionId = asString(facts.transactionId);
  const accountId = asString(facts.accountId);
  const accountName = asString(facts.accountName);
  const ticker = asString(facts.ticker);
  const marketCode = asMarketCode(facts.marketCode);
  const priceCurrency = asString(facts.priceCurrency);
  const tradeDate = asString(facts.tradeDate);
  const side = facts.side;
  const quantity = asNumber(facts.quantity);
  const unitPrice = asNumber(facts.unitPrice);
  const grossTradeValueAmount = asNumber(facts.grossTradeValueAmount);
  const commissionAmount = asNumber(facts.commissionAmount);
  const taxAmount = asNumber(facts.taxAmount);
  const settlementAmount = facts.settlementAmount === null ? null : asNumber(facts.settlementAmount);
  const settlementAvailable = asBoolean(facts.settlementAvailable);
  const bookedCostAmount = facts.bookedCostAmount === null ? null : asNumber(facts.bookedCostAmount);
  const isDayTrade = asBoolean(facts.isDayTrade);
  const feesSource = facts.feesSource;

  if (
    !transactionId
    || !accountId
    || !accountName
    || !ticker
    || !marketCode
    || !priceCurrency
    || !tradeDate
    || (side !== "BUY" && side !== "SELL")
    || quantity === null
    || unitPrice === null
    || grossTradeValueAmount === null
    || commissionAmount === null
    || taxAmount === null
    || settlementAmount === undefined
    || settlementAvailable === null
    || bookedCostAmount === undefined
    || isDayTrade === null
    || (feesSource !== "CALCULATED" && feesSource !== "MANUAL" && feesSource !== "SOURCE_PROVIDED")
  ) {
    throw new Error("Invalid posted transaction mutation preview facts record");
  }

  return {
    transactionId,
    accountId,
    accountName,
    ticker,
    marketCode: marketCode as MarketCode,
    priceCurrency,
    tradeDate,
    side,
    quantity,
    unitPrice,
    grossTradeValueAmount,
    commissionAmount,
    taxAmount,
    settlementAmount,
    settlementAvailable,
    bookedCostAmount,
    isDayTrade,
    feesSource,
  };
}

function mapPreviewItemRecord(
  item: import("../persistence/types.js").PostedTransactionMutationPreviewItemRecord,
): PostedTransactionMutationPreviewItemDto {
  return {
    transactionId: item.transactionId,
    status: item.status,
    note: item.note,
    before: mapPreviewFactsRecord(item.before),
    after: mapPreviewFactsRecord(item.after),
    impacts: item.impacts,
    warnings: item.warnings,
    blockers: item.blockers,
    errors: asMutationErrors(item.errors),
  };
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}

async function readAccountRevisions(
  persistence: Persistence,
  ownerUserId: string,
  accountIds: readonly string[],
): Promise<Record<string, number>> {
  return Object.fromEntries(await Promise.all(
    [...accountIds].sort().map(async (accountId) => [
      accountId,
      await persistence.getAccountAccountingRevision(ownerUserId, accountId),
    ] as const),
  ));
}

function accountRevisionsMatch(
  expected: Readonly<Record<string, number>>,
  actual: Readonly<Record<string, number>>,
): boolean {
  const expectedEntries = Object.entries(expected);
  return expectedEntries.length === Object.keys(actual).length
    && expectedEntries.every(([accountId, revision]) => actual[accountId] === revision);
}

function settlementAmountForTrade(trade: BookedTradeEvent): number {
  const gross = roundToDecimal(trade.quantity * trade.unitPrice, 2);
  return trade.type === "BUY"
    ? roundToDecimal(gross + trade.commissionAmount + trade.taxAmount, 2)
    : roundToDecimal(gross - trade.commissionAmount - trade.taxAmount, 2);
}

function bookedCostForTrade(trade: BookedTradeEvent): number | null {
  if (trade.type !== "BUY") return null;
  return roundToDecimal((trade.quantity * trade.unitPrice) + trade.commissionAmount + trade.taxAmount, 2);
}

function toTradeFacts(trade: BookedTradeEvent, accountName: string): PostedTransactionMutationTransactionFactsDto {
  const grossTradeValueAmount = roundToDecimal(trade.quantity * trade.unitPrice, 2);
  return {
    transactionId: trade.id,
    accountId: trade.accountId,
    accountName,
    ticker: trade.ticker,
    marketCode: trade.marketCode as MarketCode,
    priceCurrency: trade.priceCurrency,
    tradeDate: trade.tradeDate,
    side: trade.type,
    quantity: trade.quantity,
    unitPrice: trade.unitPrice,
    grossTradeValueAmount,
    commissionAmount: trade.commissionAmount,
    taxAmount: trade.taxAmount,
    settlementAmount: settlementAmountForTrade(trade),
    settlementAvailable: true,
    bookedCostAmount: bookedCostForTrade(trade),
    isDayTrade: trade.isDayTrade,
    feesSource: trade.feesSource ?? "CALCULATED",
  };
}

function requireTrade(store: Store, ownerUserId: string, tradeEventId: string): BookedTradeEvent {
  const trade = store.accounting.facts.tradeEvents.find((entry) => entry.id === tradeEventId && entry.userId === ownerUserId);
  if (!trade) throw routeError(404, "trade_event_not_found", "Trade event not found");
  return trade;
}

function compactBookingSequence(trades: BookedTradeEvent[], accountId: string, tradeDate: string): void {
  trades
    .filter((entry) => entry.accountId === accountId && entry.tradeDate === tradeDate)
    .sort((left, right) => (left.bookingSequence ?? 0) - (right.bookingSequence ?? 0))
    .forEach((entry, index) => {
      entry.bookingSequence = index + 1;
    });
}

function assignBookingSequence(trades: BookedTradeEvent[], trade: BookedTradeEvent, tradeEventId: string, tradeDate: string): void {
  const nextSequence = trades
    .filter((entry) => entry.accountId === trade.accountId && entry.tradeDate === tradeDate && entry.id !== tradeEventId)
    .reduce((max, entry) => Math.max(max, entry.bookingSequence ?? 0), 0) + 1;
  trade.bookingSequence = nextSequence;
}

function applyUpdatePatch(trade: BookedTradeEvent, patch: TradeEventPatch): { oldTradeDate: string } {
  const oldTradeDate = trade.tradeDate;
  if (patch.date !== undefined) {
    trade.tradeDate = patch.date;
    trade.tradeTimestamp = new Date(`${patch.date}T00:00:00.000Z`).toISOString();
  }
  if (patch.quantity !== undefined) trade.quantity = patch.quantity;
  if (patch.price !== undefined) trade.unitPrice = patch.price;
  if (patch.side !== undefined) trade.type = patch.side;
  if (patch.isDayTrade !== undefined) trade.isDayTrade = patch.isDayTrade;
  if (patch.commissionAmount !== undefined) trade.commissionAmount = patch.commissionAmount;
  if (patch.taxAmount !== undefined) trade.taxAmount = patch.taxAmount;
  if (patch.feesSource !== undefined) trade.feesSource = patch.feesSource;
  return { oldTradeDate };
}

function positionEffectForFacts(facts: PostedTransactionMutationTransactionFactsDto | null): number {
  if (!facts) return 0;
  return facts.side === "BUY" ? facts.quantity : -facts.quantity;
}

function cashEffectForFacts(facts: PostedTransactionMutationTransactionFactsDto | null): number {
  if (!facts) return 0;
  const settlementAmount = facts.settlementAmount ?? 0;
  return facts.side === "BUY" ? -settlementAmount : settlementAmount;
}

function buildImpact(before: PostedTransactionMutationTransactionFactsDto | null, after: PostedTransactionMutationTransactionFactsDto | null): PostedTransactionMutationImpactSummaryDto {
  return {
    quantityDelta: roundToDecimal(positionEffectForFacts(after) - positionEffectForFacts(before), 8),
    costBasisDelta: roundToDecimal((after?.bookedCostAmount ?? 0) - (before?.bookedCostAmount ?? 0), 2),
    realizedPnlDelta: 0,
    cashDelta: roundToDecimal(cashEffectForFacts(after) - cashEffectForFacts(before), 2),
    reopenedDividendCount: 0,
    deletedDividendCount: before && !after ? 1 : 0,
  };
}

function scopeKey(scope: ScopeLike): string {
  return `${scope.accountId}\0${scope.ticker}\0${scope.marketCode}`;
}

function affectedCacheInvalidation(): CacheInvalidationPayload {
  return {
    invalidatedReads: [
      "portfolio_transactions",
      "portfolio_holdings",
      "portfolio_dividends",
      "portfolio_reports",
      "portfolio_dashboard",
      "portfolio_cash_ledger",
      "audit_log",
      "transaction_draft_batches",
      "posted_transaction_mutation_runs",
    ],
    invalidatedRoutes: [
      "/transactions",
      "/portfolio",
      "/dividends",
      "/reports",
      "/dashboard",
      "/settings?tab=ai-connectors",
      "/transactions/mutations",
    ],
  };
}

async function publishMutationCommitEvents(
  eventBus: MutationEventBus,
  ownerUserId: string,
  run: import("../persistence/types.js").PostedTransactionMutationRunRecord,
): Promise<void> {
  const invalidation = affectedCacheInvalidation();
  const payload = {
    reason: "posted_transaction_mutation_committed" as const,
    runId: run.id,
    previewId: run.previewId,
    operation: run.operation,
    affectedAccountIds: run.affectedAccountIds,
    affectedTickers: run.affectedTickers,
    ...invalidation,
  };
  await eventBus.publishEvent(ownerUserId, "portfolio_transactions_changed", payload);
  await eventBus.publishEvent(ownerUserId, "portfolio_holdings_changed", payload);
  await eventBus.publishEvent(ownerUserId, "portfolio_dividends_changed", payload);
  await eventBus.publishEvent(ownerUserId, "audit_log_changed", {
    reason: "posted_transaction_mutation_committed" as const,
    runId: run.id,
    previewId: run.previewId,
    action: "delegated_portfolio_write" as const,
    ...invalidation,
  });
  await eventBus.publishEvent(ownerUserId, "posted_transaction_mutation_rebuild", {
    runId: run.id,
    previewId: run.previewId,
    operation: run.operation,
    status: "queued",
    affectedAccountIds: run.affectedAccountIds,
    affectedTickers: run.affectedTickers,
  });
}

async function publishMutationRebuildEvent(
  eventBus: MutationEventBus,
  run: import("../persistence/types.js").PostedTransactionMutationRunRecord,
  status: "running" | "completed" | "partially_failed" | "failed",
): Promise<void> {
  await eventBus.publishEvent(run.ownerUserId, "posted_transaction_mutation_rebuild", {
    runId: run.id,
    previewId: run.previewId,
    operation: run.operation,
    status,
    affectedAccountIds: run.affectedAccountIds,
    affectedTickers: run.affectedTickers,
  });
}

function buildScopeFingerprint(trades: readonly BookedTradeEvent[], scope: ScopeLike): string {
  return hashPayload(trades
    .filter((trade) => trade.accountId === scope.accountId && trade.ticker === scope.ticker && trade.marketCode === scope.marketCode)
    .map((trade) => ({
      id: trade.id,
      tradeDate: trade.tradeDate,
      side: trade.type,
      quantity: trade.quantity,
      unitPrice: trade.unitPrice,
      commissionAmount: trade.commissionAmount,
      taxAmount: trade.taxAmount,
      isDayTrade: trade.isDayTrade,
    })));
}

function tradeScopeMatches(
  trade: ScopeLike,
  scope: ScopeLike,
): boolean {
  return trade.accountId === scope.accountId
    && trade.ticker === scope.ticker
    && trade.marketCode === scope.marketCode;
}

function buildScopeDividendImpact(
  store: Store,
  scope: ScopeLike,
): {
  ledgerIds: Set<string>;
  openLedgerIds: Set<string>;
} {
  const dividendEventIds = new Set(store.marketData.dividendEvents
    .filter((event) => event.ticker === scope.ticker && (event.marketCode ?? scope.marketCode) === scope.marketCode)
    .map((event) => event.id));
  const reversedLedgerEntryIds = new Set(store.accounting.facts.dividendLedgerEntries
    .map((entry) => entry.reversalOfDividendLedgerEntryId)
    .filter((entry): entry is string => Boolean(entry)));
  const ledgerRows = store.accounting.facts.dividendLedgerEntries.filter((entry) =>
    entry.accountId === scope.accountId
    && dividendEventIds.has(entry.dividendEventId)
    && !entry.reversalOfDividendLedgerEntryId
    && !entry.supersededAt
    && !reversedLedgerEntryIds.has(entry.id));
  return {
    ledgerIds: new Set(ledgerRows.map((entry) => entry.id)),
    openLedgerIds: new Set(ledgerRows
      .filter((entry) => entry.reconciliationStatus === "open")
      .map((entry) => entry.id)),
  };
}

function collectDestructiveDividendArtifacts(
  beforeStore: Store,
  simulatedStore: Store,
  scopes: readonly ScopeLike[],
): {
  affectedLedgerEntryIds: Set<string>;
  manualReceiptIdsByScope: Map<string, string[]>;
} {
  const scopeByAccountEvent = new Map<string, string>();
  for (const scope of scopes) {
    for (const event of beforeStore.marketData.dividendEvents) {
      if (event.ticker !== scope.ticker || (event.marketCode ?? scope.marketCode) !== scope.marketCode) continue;
      scopeByAccountEvent.set(`${scope.accountId}:${event.id}`, scopeKey(scope));
    }
  }
  const isActive = (entry: Store["accounting"]["facts"]["dividendLedgerEntries"][number]) =>
    !entry.reversalOfDividendLedgerEntryId && !entry.supersededAt;
  const beforeActive = new Map(beforeStore.accounting.facts.dividendLedgerEntries
    .filter((entry) => isActive(entry) && scopeByAccountEvent.has(`${entry.accountId}:${entry.dividendEventId}`))
    .map((entry) => [`${entry.accountId}:${entry.dividendEventId}`, entry]));
  const afterActive = new Map(simulatedStore.accounting.facts.dividendLedgerEntries
    .filter((entry) => isActive(entry) && scopeByAccountEvent.has(`${entry.accountId}:${entry.dividendEventId}`))
    .map((entry) => [`${entry.accountId}:${entry.dividendEventId}`, entry]));
  const affectedAccountEvents = new Set<string>();
  const manualReceiptIdsByScope = new Map<string, string[]>();
  for (const [accountEventKey, before] of beforeActive) {
    const after = afterActive.get(accountEventKey);
    if (
      after
      && after.eligibleQuantity === before.eligibleQuantity
      && after.expectedCashAmount === before.expectedCashAmount
      && after.expectedStockQuantity === before.expectedStockQuantity
    ) {
      continue;
    }
    affectedAccountEvents.add(accountEventKey);
    if (before.postingStatus !== "expected") {
      const impactedScope = scopeByAccountEvent.get(accountEventKey);
      if (impactedScope) {
        manualReceiptIdsByScope.set(impactedScope, [
          ...(manualReceiptIdsByScope.get(impactedScope) ?? []),
          before.id,
        ]);
      }
    }
  }
  const affectedLedgerEntryIds = new Set(beforeStore.accounting.facts.dividendLedgerEntries
    .filter((entry) => affectedAccountEvents.has(`${entry.accountId}:${entry.dividendEventId}`))
    .map((entry) => entry.id));
  return { affectedLedgerEntryIds, manualReceiptIdsByScope };
}

function purgeDividendArtifacts(store: Store, affectedLedgerEntryIds: ReadonlySet<string>): void {
  if (affectedLedgerEntryIds.size === 0) return;
  const stockDividendLotIds = new Set(store.accounting.facts.positionActions
    .filter((entry) => entry.actionType === "STOCK_DIVIDEND" && affectedLedgerEntryIds.has(entry.relatedDividendLedgerEntryId ?? ""))
    .map((entry) => `lot-pa-${entry.id}`));
  store.accounting.projections.lotAllocations = store.accounting.projections.lotAllocations.filter(
    (entry) => !stockDividendLotIds.has(entry.lotId),
  );
  store.accounting.projections.lots = store.accounting.projections.lots.filter(
    (entry) => !stockDividendLotIds.has(entry.id),
  );
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

function buildScopeImpactFromStores(
  beforeStore: Store,
  afterStore: Store,
  scope: ScopeLike,
  beforeFacts: PostedTransactionMutationTransactionFactsDto | null,
  afterFacts: PostedTransactionMutationTransactionFactsDto | null,
): PostedTransactionMutationImpactSummaryDto {
  const beforeTrades = beforeStore.accounting.facts.tradeEvents.filter((trade) => tradeScopeMatches(trade, scope));
  const afterTrades = afterStore.accounting.facts.tradeEvents.filter((trade) => tradeScopeMatches(trade, scope));
  const beforeDividends = buildScopeDividendImpact(beforeStore, scope);
  const afterDividends = buildScopeDividendImpact(afterStore, scope);
  return {
    quantityDelta: roundToDecimal(positionEffectForFacts(afterFacts) - positionEffectForFacts(beforeFacts), 8),
    costBasisDelta: roundToDecimal((afterFacts?.bookedCostAmount ?? 0) - (beforeFacts?.bookedCostAmount ?? 0), 2),
    realizedPnlDelta: roundToDecimal(
      afterTrades.reduce((sum, trade) => sum + (trade.realizedPnlAmount ?? 0), 0)
        - beforeTrades.reduce((sum, trade) => sum + (trade.realizedPnlAmount ?? 0), 0),
      2,
    ),
    cashDelta: roundToDecimal(cashEffectForFacts(afterFacts) - cashEffectForFacts(beforeFacts), 2),
    reopenedDividendCount: [...afterDividends.openLedgerIds].filter((id) => !beforeDividends.openLedgerIds.has(id)).length,
    deletedDividendCount: [...beforeDividends.ledgerIds].filter((id) => !afterDividends.ledgerIds.has(id)).length,
  };
}

function normalizeUpdatePatch(item: PostedTransactionMutationUpdateItemDto, trade: BookedTradeEvent): { patch: TradeEventPatch; changedFields: string[] } {
  const patch: TradeEventPatch = {};
  const changedFields: string[] = [];
  if (item.patch.tradeDate !== undefined && item.patch.tradeDate !== trade.tradeDate) {
    patch.date = item.patch.tradeDate;
    changedFields.push("tradeDate");
  }
  if (item.patch.quantity !== undefined && item.patch.quantity !== trade.quantity) {
    patch.quantity = item.patch.quantity;
    changedFields.push("quantity");
  }
  if (item.patch.unitPrice !== undefined && item.patch.unitPrice !== trade.unitPrice) {
    patch.price = item.patch.unitPrice;
    changedFields.push("unitPrice");
  }
  if (item.patch.side !== undefined && item.patch.side !== trade.type) {
    patch.side = item.patch.side;
    changedFields.push("side");
  }
  const requestedSide = item.patch.side ?? trade.type;
  const requestedIsDayTrade = requestedSide === "BUY" ? false : (item.patch.isDayTrade ?? trade.isDayTrade);
  if (requestedIsDayTrade !== trade.isDayTrade) {
    patch.isDayTrade = requestedIsDayTrade;
    changedFields.push("isDayTrade");
  }
  if (item.patch.commissionAmount !== undefined && item.patch.commissionAmount !== trade.commissionAmount) {
    patch.commissionAmount = item.patch.commissionAmount;
    changedFields.push("commissionAmount");
  }
  if (item.patch.taxAmount !== undefined && item.patch.taxAmount !== trade.taxAmount) {
    patch.taxAmount = item.patch.taxAmount;
    changedFields.push("taxAmount");
  }
  const explicitFeeOverride = item.patch.commissionAmount !== undefined || item.patch.taxAmount !== undefined;
  const feeFieldsChanged = changedFields.some((field) =>
    field === "quantity" || field === "unitPrice" || field === "side" || field === "isDayTrade");
  const explicitRecalculation = item.patch.feeOverrideMode === "recalculate";
  if (explicitFeeOverride) {
    patch.feesSource = "MANUAL";
  } else if (feeFieldsChanged || explicitRecalculation) {
    const feesSource = trade.feesSource ?? "CALCULATED";
    if (feesSource === "CALCULATED" || explicitRecalculation) {
      const quantity = patch.quantity ?? trade.quantity;
      const unitPrice = patch.price ?? trade.unitPrice;
      const side = patch.side ?? trade.type;
      const tradeValue = quantity * unitPrice;
      const fees = side === "BUY"
        ? calculateBuyFees(trade.feeSnapshot, tradeValue, trade.priceCurrency)
        : calculateSellFees(trade.feeSnapshot, {
            tradeValueAmount: tradeValue,
            tradeCurrency: trade.priceCurrency,
            instrumentType: trade.instrumentType,
            isDayTrade: patch.isDayTrade ?? trade.isDayTrade,
            marketCode: trade.marketCode,
          });
      patch.commissionAmount = fees.commissionAmount;
      patch.taxAmount = fees.taxAmount;
      patch.feesSource = "CALCULATED";
    }
  }
  if (changedFields.length === 0 && patch.commissionAmount === undefined && patch.taxAmount === undefined) {
    throw routeError(409, "posted_transaction_mutation_no_changes", "Mutation item produced no changes");
  }
  return { patch, changedFields };
}

async function simulateMutation(
  persistence: Persistence,
  ownerUserId: string,
  operation: PostedTransactionMutationOperation,
  items: readonly PostedTransactionMutationUpdateItemDto[] | readonly PostedTransactionMutationDeleteItemDto[],
  reason: string,
): Promise<PreviewResult> {
  const policy = await persistence.getAiConnectorPolicySettings();
  if (items.length > policy.postedTransactionMutationBatchLimit) {
    throw routeError(409, "posted_transaction_mutation_batch_limit_exceeded", "Mutation batch exceeds configured limit");
  }
  const uniqueIds = new Set(items.map((item) => item.transactionId));
  if (uniqueIds.size !== items.length) {
    throw routeError(409, "posted_transaction_mutation_duplicate_transaction", "Mutation batch contains duplicate transaction IDs");
  }

  // Resolve the account set first, then bracket the store load with revision
  // reads. This prevents a preview from pairing an old accounting snapshot
  // with a newer revision when a concurrent write lands during hydration.
  const discoveryStore = await persistence.loadStore(ownerUserId);
  const affectedAccountIds = [...new Set(items.map((item) =>
    requireTrade(discoveryStore, ownerUserId, item.transactionId).accountId))].sort();
  const initialAccountRevisions = await readAccountRevisions(
    persistence,
    ownerUserId,
    affectedAccountIds,
  );
  const baseStore = await persistence.loadStore(ownerUserId);
  const loadedAccountIds = [...new Set(items.map((item) =>
    requireTrade(baseStore, ownerUserId, item.transactionId).accountId))].sort();
  const loadedAccountRevisions = await readAccountRevisions(
    persistence,
    ownerUserId,
    affectedAccountIds,
  );
  if (
    loadedAccountIds.length !== affectedAccountIds.length
    || loadedAccountIds.some((accountId, index) => accountId !== affectedAccountIds[index])
    || !accountRevisionsMatch(initialAccountRevisions, loadedAccountRevisions)
  ) {
    throw routeError(
      409,
      "posted_transaction_mutation_preview_stale",
      "Underlying records changed while the mutation preview was being created",
    );
  }
  const draftStore = structuredClone(baseStore);
  const accountNames = new Map(baseStore.accounts.map((account) => [account.id, account.name]));
  const scopeMap = new Map<string, ReplayScope>();
  const previewItems: PostedTransactionMutationPreviewItemDto[] = [];
  const accountRevisionEntries = new Map<string, number>(Object.entries(initialAccountRevisions));
  const deletedTradeIdsByScope = new Map<string, string[]>();
  const previewItemScopeKeys = new Map<string, string>();
  const replayBlockersByScope = new Map<string, string>();

  for (const item of items) {
    const baseTrade = requireTrade(baseStore, ownerUserId, item.transactionId);
    const draftTrade = requireTrade(draftStore, ownerUserId, item.transactionId);
    const beforeFacts = toTradeFacts(baseTrade, accountNames.get(baseTrade.accountId) ?? baseTrade.accountId);
    let afterFacts: PostedTransactionMutationTransactionFactsDto | null = null;
    let fromDate = baseTrade.tradeDate;

    const key = scopeKey(baseTrade);

    if (operation === "update") {
      const { patch } = normalizeUpdatePatch(item as PostedTransactionMutationUpdateItemDto, baseTrade);
      const { oldTradeDate } = applyUpdatePatch(draftTrade, patch);
      if (patch.date && patch.date !== oldTradeDate) {
        assignBookingSequence(draftStore.accounting.facts.tradeEvents, draftTrade, draftTrade.id, patch.date);
        compactBookingSequence(draftStore.accounting.facts.tradeEvents, draftTrade.accountId, oldTradeDate);
      }
      fromDate = patch.date && patch.date < oldTradeDate ? patch.date : oldTradeDate;
      afterFacts = toTradeFacts(draftTrade, accountNames.get(draftTrade.accountId) ?? draftTrade.accountId);
    } else {
      draftStore.accounting.facts.tradeEvents = draftStore.accounting.facts.tradeEvents.filter((entry) => entry.id !== draftTrade.id);
      compactBookingSequence(draftStore.accounting.facts.tradeEvents, draftTrade.accountId, draftTrade.tradeDate);
      const deletedTradeIds = deletedTradeIdsByScope.get(key) ?? [];
      deletedTradeIds.push(draftTrade.id);
      deletedTradeIdsByScope.set(key, deletedTradeIds);
    }

    if (!scopeMap.has(key)) {
      const accountRevision = initialAccountRevisions[baseTrade.accountId];
      if (accountRevision === undefined) {
        throw routeError(
          409,
          "posted_transaction_mutation_preview_stale",
          "Mutation account scope changed while the preview was being created",
        );
      }
      scopeMap.set(key, {
        accountId: baseTrade.accountId,
        accountName: accountNames.get(baseTrade.accountId) ?? baseTrade.accountId,
        ticker: baseTrade.ticker,
        marketCode: baseTrade.marketCode as MarketCode,
        fromDate,
        accountRevision,
        fingerprint: "",
      });
    } else {
      scopeMap.get(key)!.fromDate = scopeMap.get(key)!.fromDate < fromDate ? scopeMap.get(key)!.fromDate : fromDate;
    }

    previewItems.push({
      transactionId: item.transactionId,
      status: operation === "delete" ? "deleted" : "changed",
      note: item.note ?? null,
      before: beforeFacts,
      after: afterFacts,
      impacts: buildImpact(beforeFacts, afterFacts),
      warnings: [],
      blockers: [],
      errors: [],
    });
    previewItemScopeKeys.set(item.transactionId, key);
  }

  const simulation = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
  await simulation.init();
  await simulation.saveStore(draftStore);
  for (const scope of [...scopeMap.values()].sort((left, right) =>
    left.accountId.localeCompare(right.accountId)
    || left.ticker.localeCompare(right.ticker)
    || left.marketCode.localeCompare(right.marketCode))) {
    try {
      await replayPositionHistory(simulation, ownerUserId, scope.accountId, scope.ticker, {
        marketCode: scope.marketCode,
        deletedTradeEventIds: deletedTradeIdsByScope.get(scopeKey(scope)) ?? [],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      replayBlockersByScope.set(
        scopeKey(scope),
        `This mutation would create a negative position. ${detail}`,
      );
    }
  }
  let finalStore = replayBlockersByScope.size > 0
    ? baseStore
    : await simulation.loadStore(ownerUserId);
  let manualReceiptIdsByScope = new Map<string, string[]>();
  if (operation === "delete" && replayBlockersByScope.size === 0) {
    const destructiveImpact = collectDestructiveDividendArtifacts(
      baseStore,
      finalStore,
      [...scopeMap.values()],
    );
    manualReceiptIdsByScope = destructiveImpact.manualReceiptIdsByScope;
    if (destructiveImpact.affectedLedgerEntryIds.size > 0) {
      const destructiveStore = structuredClone(draftStore);
      purgeDividendArtifacts(destructiveStore, destructiveImpact.affectedLedgerEntryIds);
      const destructiveSimulation = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
      await destructiveSimulation.init();
      await destructiveSimulation.saveStore(destructiveStore);
      for (const scope of [...scopeMap.values()].sort((left, right) =>
        left.accountId.localeCompare(right.accountId)
        || left.ticker.localeCompare(right.ticker)
        || left.marketCode.localeCompare(right.marketCode))) {
        try {
          await replayPositionHistory(destructiveSimulation, ownerUserId, scope.accountId, scope.ticker, {
            marketCode: scope.marketCode,
            deletedTradeEventIds: deletedTradeIdsByScope.get(scopeKey(scope)) ?? [],
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          replayBlockersByScope.set(
            scopeKey(scope),
            `This mutation would create a negative position. ${detail}`,
          );
        }
      }
      finalStore = replayBlockersByScope.size > 0
        ? baseStore
        : await destructiveSimulation.loadStore(ownerUserId);
    }
  }
  const scopeImpacts = new Map<string, PostedTransactionMutationImpactSummaryDto>();
  for (const scope of scopeMap.values()) {
    scope.fingerprint = buildScopeFingerprint(finalStore.accounting.facts.tradeEvents, scope);
    scopeImpacts.set(
      scopeKey(scope),
      buildScopeImpactFromStores(
        baseStore,
        finalStore,
        scope,
        null,
        null,
      ),
    );
  }
  const scopeItemCounts = new Map<string, number>();
  for (const key of previewItemScopeKeys.values()) {
    scopeItemCounts.set(key, (scopeItemCounts.get(key) ?? 0) + 1);
  }
  for (const item of previewItems) {
    const key = previewItemScopeKeys.get(item.transactionId);
    if (!key) continue;
    const replayBlocker = replayBlockersByScope.get(key);
    if (replayBlocker) {
      item.status = "blocked";
      item.blockers = [...item.blockers, replayBlocker];
      item.errors = [...item.errors, {
        code: "posted_transaction_mutation_inventory_conflict",
        message: replayBlocker,
        transactionId: item.transactionId,
      }];
    }
    const scopeImpact = scopeImpacts.get(key);
    if (!scopeImpact) continue;
    item.impacts = {
      ...item.impacts,
      realizedPnlDelta: scopeImpact.realizedPnlDelta,
      reopenedDividendCount: scopeImpact.reopenedDividendCount,
      deletedDividendCount: scopeImpact.deletedDividendCount,
    };
    if ((scopeItemCounts.get(key) ?? 0) > 1) {
      item.warnings = [...item.warnings, "Batch includes multiple mutations in the same account/ticker scope; realized P&L and dividend counts reflect the combined scope result."];
    }
    const manualReceiptIds = manualReceiptIdsByScope.get(key) ?? [];
    if (manualReceiptIds.length > 0) {
      item.warnings = [
        ...item.warnings,
        `Posted dividend receipt ledger ${manualReceiptIds.join(", ")} will be removed and must be entered again after deletion.`,
      ];
    }
  }
  const itemSummary = previewItems.reduce<PostedTransactionMutationImpactSummaryDto>((acc, item) => ({
    quantityDelta: roundToDecimal(acc.quantityDelta + item.impacts.quantityDelta, 8),
    costBasisDelta: roundToDecimal(acc.costBasisDelta + item.impacts.costBasisDelta, 2),
    realizedPnlDelta: acc.realizedPnlDelta,
    cashDelta: roundToDecimal(acc.cashDelta + item.impacts.cashDelta, 2),
    reopenedDividendCount: acc.reopenedDividendCount,
    deletedDividendCount: acc.deletedDividendCount,
  }), {
    quantityDelta: 0,
    costBasisDelta: 0,
    realizedPnlDelta: 0,
    cashDelta: 0,
    reopenedDividendCount: 0,
    deletedDividendCount: 0,
  });
  const scopeSummary = [...scopeImpacts.values()].reduce<Pick<PostedTransactionMutationImpactSummaryDto, "realizedPnlDelta" | "reopenedDividendCount" | "deletedDividendCount">>((acc, impact) => ({
    realizedPnlDelta: roundToDecimal(acc.realizedPnlDelta + impact.realizedPnlDelta, 2),
    reopenedDividendCount: acc.reopenedDividendCount + impact.reopenedDividendCount,
    deletedDividendCount: acc.deletedDividendCount + impact.deletedDividendCount,
  }), {
    realizedPnlDelta: 0,
    reopenedDividendCount: 0,
    deletedDividendCount: 0,
  });
  const summary: PostedTransactionMutationImpactSummaryDto = {
    ...itemSummary,
    realizedPnlDelta: scopeSummary.realizedPnlDelta,
    reopenedDividendCount: scopeSummary.reopenedDividendCount,
    deletedDividendCount: scopeSummary.deletedDividendCount,
  };
  const finalAccountRevisions = await readAccountRevisions(
    persistence,
    ownerUserId,
    affectedAccountIds,
  );
  if (!accountRevisionsMatch(initialAccountRevisions, finalAccountRevisions)) {
    throw routeError(
      409,
      "posted_transaction_mutation_preview_stale",
      "Underlying records changed while the mutation preview was being created",
    );
  }
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS).toISOString();
  const confirmationSummary = `${operation} ${items.length} posted transaction${items.length === 1 ? "" : "s"}: ${reason}`;
  const replayBlockers = [...new Set(replayBlockersByScope.values())];
  const fingerprint = hashPayload({
    operation,
    reason,
    accountRevisions: Object.fromEntries(accountRevisionEntries),
    scopes: [...scopeMap.values()].map((scope) => ({
      accountId: scope.accountId,
      ticker: scope.ticker,
      marketCode: scope.marketCode,
      fromDate: scope.fromDate,
      fingerprint: scope.fingerprint,
    })),
    items: previewItems.map((item) => ({
      transactionId: item.transactionId,
      before: item.before,
      after: item.after,
    })),
  });
  const record: import("../persistence/types.js").PostedTransactionMutationPreviewRecord = {
    id: randomUUID(),
    ownerUserId,
    actorUserId: ownerUserId,
    operation,
    status: replayBlockers.length > 0 ? "failed" : "ready",
    version: 1,
    reason,
    confirmationSummary,
    confirmationDigest: hashPayload({ operation, reason, summary, items: previewItems }),
    fingerprint,
    batchLimit: policy.postedTransactionMutationBatchLimit,
    summary,
    warnings: [...new Set([...manualReceiptIdsByScope.values()].flat())].map(
      (ledgerEntryId) => `Posted dividend receipt ledger ${ledgerEntryId} must be entered again after deletion.`,
    ),
    blockers: replayBlockers,
    errors: replayBlockers.map((message) => ({
      code: "posted_transaction_mutation_inventory_conflict",
      message,
    })),
    affectedAccountIds: [...new Set(previewItems.map((item) => item.before?.accountId ?? item.after?.accountId ?? ""))].filter(Boolean),
    affectedTickers: [...new Map(previewItems
      .map((item) => item.before ?? item.after)
      .filter((item): item is PostedTransactionMutationTransactionFactsDto => Boolean(item))
      .map((item) => [`${item.ticker}:${item.marketCode}`, { ticker: item.ticker, marketCode: item.marketCode as MarketCode }])).values()],
    scopes: [...scopeMap.values()].map((scope) => ({
      accountId: scope.accountId,
      accountName: scope.accountName,
      ticker: scope.ticker,
      marketCode: scope.marketCode,
      earliestReplayDate: scope.fromDate,
      accountRevision: scope.accountRevision,
      fingerprint: scope.fingerprint,
      status: replayBlockersByScope.has(scopeKey(scope)) ? "failed" : undefined,
      errorMessage: replayBlockersByScope.get(scopeKey(scope)) ?? null,
    })),
    accountRevisions: Object.fromEntries(accountRevisionEntries),
    items: previewItems.map((item) => ({
      ...item,
      before: asFactsRecord(item.before),
      after: asFactsRecord(item.after),
    })),
    finalAccounting: finalStore.accounting,
    replayScopes: [...scopeMap.values()].map((scope) => ({
      accountId: scope.accountId,
      ticker: scope.ticker,
      marketCode: scope.marketCode,
      fromDate: scope.fromDate,
      deletedTradeEventIds: deletedTradeIdsByScope.get(scopeKey(scope)) ?? [],
    })),
    createdAt,
    expiresAt,
    confirmedAt: null,
    confirmedRunId: null,
  };
  return { record, page: previewItems.slice(0, INITIAL_PREVIEW_PAGE_LIMIT) };
}

function derivePreviewStatus(
  preview: import("../persistence/types.js").PostedTransactionMutationPreviewRecord,
  currentAccountRevisions: Record<string, number>,
): import("@vakwen/shared-types").PostedTransactionMutationPreviewStatus {
  if (preview.confirmedRunId) return "confirmed";
  if (new Date(preview.expiresAt).getTime() <= Date.now()) return "expired";
  return Object.entries(preview.accountRevisions).some(([accountId, revision]) => currentAccountRevisions[accountId] !== revision)
    ? "stale"
    : preview.status;
}

function buildPreviewDto(
  preview: import("../persistence/types.js").PostedTransactionMutationPreviewRecord,
  appBaseUrl: string,
  query?: PostedTransactionMutationPreviewQueryDto,
): PostedTransactionMutationPreviewDto {
  const filtered = preview.items.filter((item) => {
    if (query?.accountId && item.before?.accountId !== query.accountId && item.after?.accountId !== query.accountId) return false;
    if (query?.ticker && item.before?.ticker !== query.ticker && item.after?.ticker !== query.ticker) return false;
    if (query?.marketCode && item.before?.marketCode !== query.marketCode && item.after?.marketCode !== query.marketCode) return false;
    if (query?.status === "warning" && item.warnings.length === 0) return false;
    if (query?.status && query.status !== "warning" && item.status !== query.status) return false;
    return true;
  });
  const offset = query?.offset ?? 0;
  const limit = Math.min(query?.limit ?? INITIAL_PREVIEW_PAGE_LIMIT, 200);
  const previewPath = withPortfolioContext(
    `/transactions/mutations/previews/${encodeURIComponent(preview.id)}`,
    preview.ownerUserId,
    preview.actorUserId,
  );
  const runPath = preview.confirmedRunId
    ? withPortfolioContext(
        `/transactions/mutations/runs/${encodeURIComponent(preview.confirmedRunId)}`,
        preview.ownerUserId,
        preview.actorUserId,
      )
    : null;
  const transactionPath = withPortfolioContext("/transactions", preview.ownerUserId, preview.actorUserId);
  return {
    previewId: preview.id,
    previewVersion: preview.version,
    status: preview.status,
    operation: preview.operation,
    reason: preview.reason,
    confirmationSummary: preview.confirmationSummary,
    confirmationDigest: preview.confirmationDigest,
    fingerprint: preview.fingerprint,
    expiresAt: preview.expiresAt,
    createdAt: preview.createdAt,
    batchLimit: preview.batchLimit,
    affectedAccountIds: preview.affectedAccountIds,
    affectedTickers: preview.affectedTickers.map((item) => ({ ticker: item.ticker, marketCode: item.marketCode as MarketCode })),
    scopes: preview.scopes.map((scope) => ({
      accountId: scope.accountId,
      accountName: scope.accountName,
      ticker: scope.ticker,
      marketCode: scope.marketCode as MarketCode,
      earliestReplayDate: scope.earliestReplayDate,
      accountRevision: scope.accountRevision,
      fingerprint: scope.fingerprint,
      status: asScopeStatus(scope.status),
      errorMessage: scope.errorMessage ?? null,
      replayRunId: scope.replayRunId ?? null,
    })),
    warnings: preview.warnings,
    blockers: preview.blockers,
    errors: asMutationErrors(preview.errors),
    summary: preview.summary,
    page: {
      items: filtered.slice(offset, offset + limit).map(mapPreviewItemRecord),
      total: filtered.length,
      limit,
      offset,
    },
    deepLinks: {
      previewPath,
      runPath,
      transactionPath,
      previewUrl: `${appBaseUrl}${previewPath}`,
      runUrl: runPath ? `${appBaseUrl}${runPath}` : null,
    },
  };
}

function withPortfolioContext(path: string, ownerUserId: string, actorUserId: string | null | undefined): string {
  if (!actorUserId || actorUserId === ownerUserId) return path;
  return `${path}${path.includes("?") ? "&" : "?"}as=${encodeURIComponent(ownerUserId)}`;
}

function isIdenticalConfirmationRetry(
  preview: import("../persistence/types.js").PostedTransactionMutationPreviewRecord,
  confirmation: PostedTransactionMutationConfirmRequestDto,
): boolean {
  return (
    preview.version === confirmation.previewVersion
    && preview.operation === confirmation.operation
    && preview.fingerprint === confirmation.fingerprint
    && preview.confirmationSummary === confirmation.confirmationSummary
    && preview.confirmationDigest === confirmation.confirmationDigest
  );
}

async function collectDeletedDraftLineage(
  persistence: Persistence,
  ownerUserId: string,
  tradeEventIds: readonly string[],
  mutationRunId: string,
  deletedAt: string,
  deletedByUserId: string,
): Promise<import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord[]> {
  if (tradeEventIds.length === 0) return [];
  const byTradeEventId = new Map<string, import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord>();
  const batches = await persistence.listAiTransactionDraftBatchesForOwner(ownerUserId);
  for (const batch of batches) {
    const aggregate = await persistence.getAiTransactionDraftBatch(batch.id);
    if (!aggregate) continue;
    for (const row of aggregate.rows) {
      if (!row.confirmedTradeEventId || !tradeEventIds.includes(row.confirmedTradeEventId)) continue;
      byTradeEventId.set(row.confirmedTradeEventId, {
        tradeEventId: row.confirmedTradeEventId,
        ownerUserId,
        batchId: row.batchId,
        rowId: row.id,
        deletedAt,
        deletedByUserId,
        mutationRunId,
      });
    }
  }
  return [...byTradeEventId.values()];
}

type PostedTransactionUpdatePreviewInput = {
  ownerUserId: string;
  actorUserId?: string;
  items: readonly PostedTransactionMutationUpdateItemDto[];
  reason: string;
  appBaseUrl: string;
};

type PostedTransactionDeletePreviewInput = {
  ownerUserId: string;
  actorUserId?: string;
  items: readonly PostedTransactionMutationDeleteItemDto[];
  reason: string;
  appBaseUrl: string;
};

async function preparePostedTransactionUpdateBatch(
  persistence: Persistence,
  input: PostedTransactionUpdatePreviewInput,
): Promise<PreviewResult> {
  const result = await simulateMutation(persistence, input.ownerUserId, "update", input.items, input.reason);
  result.record.actorUserId = input.actorUserId ?? input.ownerUserId;
  return result;
}

async function preparePostedTransactionDeleteBatch(
  persistence: Persistence,
  input: PostedTransactionDeletePreviewInput,
): Promise<PreviewResult> {
  const result = await simulateMutation(persistence, input.ownerUserId, "delete", input.items, input.reason);
  result.record.actorUserId = input.actorUserId ?? input.ownerUserId;
  return result;
}

export async function simulatePostedTransactionUpdateBatch(
  persistence: Persistence,
  input: PostedTransactionUpdatePreviewInput,
): Promise<PostedTransactionMutationPreviewDto> {
  const result = await preparePostedTransactionUpdateBatch(persistence, input);
  return buildPreviewDto(result.record, input.appBaseUrl);
}

export async function simulatePostedTransactionDeleteBatch(
  persistence: Persistence,
  input: PostedTransactionDeletePreviewInput,
): Promise<PostedTransactionMutationPreviewDto> {
  const result = await preparePostedTransactionDeleteBatch(persistence, input);
  return buildPreviewDto(result.record, input.appBaseUrl);
}

export async function previewPostedTransactionUpdateBatch(
  persistence: Persistence,
  input: PostedTransactionUpdatePreviewInput,
): Promise<PostedTransactionMutationPreviewDto> {
  const result = await preparePostedTransactionUpdateBatch(persistence, input);
  await persistence.savePostedTransactionMutationPreview(result.record);
  return buildPreviewDto(result.record, input.appBaseUrl);
}

export async function previewPostedTransactionDeleteBatch(
  persistence: Persistence,
  input: PostedTransactionDeletePreviewInput,
): Promise<PostedTransactionMutationPreviewDto> {
  const result = await preparePostedTransactionDeleteBatch(persistence, input);
  await persistence.savePostedTransactionMutationPreview(result.record);
  return buildPreviewDto(result.record, input.appBaseUrl);
}

export async function getPostedTransactionMutationPreview(
  persistence: Persistence,
  input: {
    ownerUserId: string;
    actorUserId?: string;
    previewId: string;
    appBaseUrl: string;
    query?: PostedTransactionMutationPreviewQueryDto;
  },
): Promise<PostedTransactionMutationPreviewDto> {
  const preview = await persistence.getPostedTransactionMutationPreview(input.previewId);
  if (
    !preview
    || preview.ownerUserId !== input.ownerUserId
    || (input.actorUserId && preview.actorUserId !== input.actorUserId)
  ) {
    throw routeError(404, "posted_transaction_mutation_unauthorized_or_missing", "Posted transaction mutation preview not found");
  }
  const revisions = Object.fromEntries(await Promise.all(
    Object.keys(preview.accountRevisions).map(async (accountId) => [accountId, await persistence.getAccountAccountingRevision(input.ownerUserId, accountId)] as const),
  ));
  preview.status = derivePreviewStatus(preview, revisions);
  await persistence.savePostedTransactionMutationPreview(preview);
  return buildPreviewDto(preview, input.appBaseUrl, input.query);
}

async function runRebuildSynchronously(
  persistence: Persistence,
  ownerUserId: string,
  runId: string,
  eventBus?: MutationEventBus,
): Promise<void> {
  const mutationRun = await persistence.getPostedTransactionMutationRun(runId);
  const replayRun = mutationRun?.replayRunId ? await persistence.getMcpReplayRun(mutationRun.replayRunId) : null;
  if (!mutationRun || !replayRun) {
    throw routeError(404, "posted_transaction_mutation_rebuild_unavailable", "Mutation rebuild run not found");
  }
  const replayScopes = mutationRun.scopes.map((scope) => ({
    accountId: scope.accountId,
    accountName: scope.accountName,
    ticker: scope.ticker,
    marketCode: scope.marketCode,
    fromDate: scope.earliestReplayDate,
    accountRevision: scope.accountRevision,
    fingerprint: scope.fingerprint,
    deletedTradeEventIds: replayRun.scopes.find((candidate) => scopeKey(candidate) === scopeKey(scope))?.deletedTradeEventIds ?? [],
  }));
  const now = new Date().toISOString();
  await persistence.updateMcpReplayRunStatus({
    runId: replayRun.id,
    status: "running",
    startedAt: now,
  });
  await persistence.savePostedTransactionMutationRun({
    ...mutationRun,
    status: "running",
    rebuildStatus: "running",
    startedAt: mutationRun.startedAt ?? now,
  });
  if (eventBus) {
    await publishMutationRebuildEvent(eventBus, mutationRun, "running");
  }
  let failed = 0;
  for (const scope of replayRun.scopes) {
    const replayScope = replayScopes.find((candidate) => scopeKey(candidate) === scopeKey(scope));
    await persistence.updateMcpReplayRunScope({ ...scope, runId, status: "running", updatedAt: new Date().toISOString() });
    let lastError: unknown = null;
    let completed = false;
    for (let attempt = 1; attempt <= MUTATION_REBUILD_MAX_ATTEMPTS; attempt += 1) {
      try {
        const summary = await replayPositionHistory(persistence, ownerUserId, scope.accountId, scope.ticker, {
          marketCode: scope.marketCode,
          deletedTradeEventIds: replayScope?.deletedTradeEventIds,
        });
        const snapshotResult = await recomputeSnapshotsForTicker(
          ownerUserId,
          scope.accountId,
          scope.ticker,
          replayScope?.fromDate ?? "1970-01-01",
          persistence,
          scope.marketCode,
        );
        await persistence.updateMcpReplayRunScope({
          ...scope,
          runId,
          status: "succeeded",
          replayedTradeCount: summary.affectedTradeCount,
          snapshotGenerationRunId: snapshotResult.generationRunId,
          updatedAt: new Date().toISOString(),
        });
        completed = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!completed) {
      failed += 1;
      await persistence.updateMcpReplayRunScope({
        ...scope,
        runId,
        status: "failed",
        errorMessage: lastError instanceof Error ? lastError.message : String(lastError),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  const replayTerminalStatus = failed === 0
    ? "completed"
    : failed === replayRun.scopes.length
      ? "failed"
      : "completed_with_failures";
  const mutationTerminalStatus = failed === 0
    ? "completed"
    : failed === replayRun.scopes.length
      ? "failed"
      : "partially_failed";
  const completedAt = new Date().toISOString();
  await persistence.updateMcpReplayRunStatus({
    runId,
    status: replayTerminalStatus,
    finishedAt: completedAt,
  });
  const completedReplayRun = await persistence.getMcpReplayRun(replayRun.id);
  await persistence.savePostedTransactionMutationRun({
    ...mutationRun,
    status: mutationTerminalStatus,
    rebuildStatus: mutationTerminalStatus,
    startedAt: mutationRun.startedAt ?? now,
    completedAt,
    errors: [
      ...mutationRun.errors,
      ...(completedReplayRun?.scopes ?? [])
        .filter((scope) => scope.status === "failed")
        .map((scope) => ({
          code: "posted_transaction_mutation_rebuild_failed",
          message: scope.errorMessage ?? `Snapshot rebuild failed for ${scope.ticker}.${scope.marketCode}`,
        })),
    ],
    scopes: mutationRun.scopes.map((scope) => {
      const replayScope = completedReplayRun?.scopes.find((candidate) => scopeKey(candidate) === scopeKey(scope));
      return {
        ...scope,
        status: replayScope?.status === "succeeded"
          ? "completed"
          : replayScope?.status === "pending"
            ? "queued"
            : replayScope?.status ?? scope.status,
        errorMessage: replayScope?.errorMessage ?? scope.errorMessage,
      };
    }),
  });
  if (eventBus) {
    await publishMutationRebuildEvent(
      eventBus,
      mutationRun,
      mutationTerminalStatus,
    );
  }
}

function mapRunFromReplay(
  run: import("../persistence/types.js").PostedTransactionMutationRunRecord,
  replayRun: import("../persistence/types.js").McpReplayRunRecord | null,
  appBaseUrl: string,
): PostedTransactionMutationRunDto {
  const replayStatus = replayRun?.status ?? null;
  const rebuildStatus = replayStatus === "running"
    ? "running"
    : replayStatus === "completed"
      ? "completed"
      : replayStatus === "completed_with_failures"
        ? "partially_failed"
        : replayStatus === "failed"
          ? "failed"
          : run.rebuildStatus;
  const status = replayStatus === "running"
    ? "running"
    : replayStatus === "completed_with_failures"
      ? "partially_failed"
      : replayStatus === "failed"
        ? "failed"
        : replayStatus === "completed"
          ? "completed"
          : run.status;
  const requiresRecovery = rebuildStatus === "partially_failed" || rebuildStatus === "failed";
  const warnings = requiresRecovery
    ? [...new Set([
        ...run.warnings,
        "Core accounting is committed, but one or more snapshot rebuild scopes failed. Use preview_replay_portfolio_positions and replay_portfolio_positions for explicit recovery before reporting the mutation fully complete.",
      ])]
    : run.warnings;
  const scopes: PostedTransactionMutationScopeDto[] = replayRun
    ? replayRun.scopes.map((scope) => ({
        accountId: scope.accountId,
        accountName: scope.accountName,
        ticker: scope.ticker,
        marketCode: scope.marketCode as MarketCode,
        earliestReplayDate: run.scopes.find((item) => scopeKey(item) === scopeKey(scope))?.earliestReplayDate ?? "1970-01-01",
        accountRevision: run.scopes.find((item) => scopeKey(item) === scopeKey(scope))?.accountRevision ?? 0,
        fingerprint: run.scopes.find((item) => scopeKey(item) === scopeKey(scope))?.fingerprint ?? "",
        status: asScopeStatus(scope.status === "pending" ? "queued" : scope.status === "succeeded" ? "completed" : scope.status),
        errorMessage: scope.errorMessage,
        replayRunId: replayRun.id,
      }))
    : run.scopes.map((scope) => ({
        accountId: scope.accountId,
        accountName: scope.accountName,
        ticker: scope.ticker,
        marketCode: scope.marketCode as MarketCode,
        earliestReplayDate: scope.earliestReplayDate,
        accountRevision: scope.accountRevision,
        fingerprint: scope.fingerprint,
        status: asScopeStatus(scope.status),
        errorMessage: scope.errorMessage ?? null,
        replayRunId: scope.replayRunId ?? null,
      }));
  const previewPath = withPortfolioContext(
    `/transactions/mutations/previews/${encodeURIComponent(run.previewId)}`,
    run.ownerUserId,
    run.actorUserId,
  );
  const runPath = withPortfolioContext(
    `/transactions/mutations/runs/${encodeURIComponent(run.id)}`,
    run.ownerUserId,
    run.actorUserId,
  );
  const transactionPath = withPortfolioContext("/transactions", run.ownerUserId, run.actorUserId);
  return {
    runId: run.id,
    previewId: run.previewId,
    operation: run.operation,
    status,
    rebuildStatus,
    createdAt: run.createdAt,
    startedAt: replayRun?.startedAt ?? run.startedAt,
    completedAt: replayRun?.finishedAt ?? run.completedAt,
    reason: run.reason,
    warnings,
    blockers: run.blockers,
    errors: asMutationErrors(run.errors),
    summary: run.summary,
    affectedAccountIds: run.affectedAccountIds,
    affectedTickers: run.affectedTickers.map((item) => ({ ticker: item.ticker, marketCode: item.marketCode as MarketCode })),
    scopes: scopes.map((scope) => ({
      accountId: scope.accountId,
      accountName: scope.accountName,
      ticker: scope.ticker,
      marketCode: scope.marketCode as MarketCode,
      earliestReplayDate: scope.earliestReplayDate,
      accountRevision: scope.accountRevision,
      fingerprint: scope.fingerprint,
      status: asScopeStatus(scope.status),
      errorMessage: scope.errorMessage ?? null,
      replayRunId: scope.replayRunId ?? null,
    })),
    deepLinks: {
      previewPath,
      runPath,
      transactionPath,
      previewUrl: `${appBaseUrl}${previewPath}`,
      runUrl: `${appBaseUrl}${runPath}`,
    },
  };
}

export async function confirmPostedTransactionMutation(
  persistence: Persistence,
  input: {
    ownerUserId: string;
    actorUserId?: string;
    appBaseUrl: string;
    confirmation: PostedTransactionMutationConfirmRequestDto;
  },
  sideEffects: MutationSideEffects = {},
): Promise<PostedTransactionMutationRunDto> {
  const preview = await persistence.getPostedTransactionMutationPreview(input.confirmation.previewId);
  if (
    !preview
    || preview.ownerUserId !== input.ownerUserId
    || (input.actorUserId && preview.actorUserId !== input.actorUserId)
  ) {
    throw routeError(404, "posted_transaction_mutation_unauthorized_or_missing", "Posted transaction mutation preview not found");
  }
  const revisions = Object.fromEntries(await Promise.all(
    Object.keys(preview.accountRevisions).map(async (accountId) => [accountId, await persistence.getAccountAccountingRevision(input.ownerUserId, accountId)] as const),
  ));
  const status = derivePreviewStatus(preview, revisions);
  if (preview.confirmedRunId) {
    if (!isIdenticalConfirmationRetry(preview, input.confirmation)) {
      throw routeError(409, "posted_transaction_mutation_confirmation_conflict", "Preview confirmation does not match prior confirmation");
    }
    const existingRun = await persistence.getPostedTransactionMutationRun(preview.confirmedRunId);
    if (!existingRun) {
      throw routeError(409, "posted_transaction_mutation_confirmation_conflict", "Confirmed mutation run is missing");
    }
    const replayRun = existingRun.replayRunId ? await persistence.getMcpReplayRun(existingRun.replayRunId) : null;
    return mapRunFromReplay(existingRun, replayRun, input.appBaseUrl);
  }
  if (status === "expired") throw routeError(409, "posted_transaction_mutation_preview_expired", "Mutation preview expired");
  if (status === "stale") throw routeError(409, "posted_transaction_mutation_preview_stale", "Mutation preview is stale");
  if (status === "failed") {
    throw routeError(
      409,
      "posted_transaction_mutation_inventory_conflict",
      preview.blockers[0] ?? "Mutation preview contains blocking accounting conflicts",
    );
  }
  if (
    preview.version !== input.confirmation.previewVersion
    || preview.operation !== input.confirmation.operation
    || preview.fingerprint !== input.confirmation.fingerprint
    || preview.confirmationSummary !== input.confirmation.confirmationSummary
    || preview.confirmationDigest !== input.confirmation.confirmationDigest
  ) {
    throw routeError(409, "posted_transaction_mutation_confirmation_conflict", "Mutation confirmation does not match preview");
  }
  const runId = randomUUID();
  const createdAt = new Date().toISOString();
  const deletedTradeEventIds = preview.items.reduce<string[]>((acc, item) => {
    const transactionId = item.before ? asString(item.before.transactionId) : null;
    if (item.status === "deleted" && transactionId) acc.push(transactionId);
    return acc;
  }, []);
  const deletedDraftLineage = preview.operation === "delete"
    ? await collectDeletedDraftLineage(
        persistence,
        input.ownerUserId,
        deletedTradeEventIds,
        runId,
        createdAt,
        input.actorUserId ?? input.ownerUserId,
      )
    : [];
  const replayScopes = preview.scopes.map((scope) => ({
    ...scope,
    fromDate: preview.replayScopes.find((item) => scopeKey(item) === scopeKey(scope))?.fromDate ?? "1970-01-01",
    deletedTradeEventIds: preview.replayScopes.find((item) => scopeKey(item) === scopeKey(scope))?.deletedTradeEventIds ?? [],
  }));
  preview.confirmedAt = createdAt;
  preview.confirmedRunId = runId;
  preview.status = "confirmed";
  const runRecord: import("../persistence/types.js").PostedTransactionMutationRunRecord = {
    id: runId,
    previewId: preview.id,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId ?? input.ownerUserId,
    operation: preview.operation,
    status: "queued",
    rebuildStatus: "pending",
    reason: preview.reason,
    warnings: preview.warnings,
    blockers: preview.blockers,
    errors: preview.errors,
    summary: preview.summary,
    affectedAccountIds: preview.affectedAccountIds,
    affectedTickers: preview.affectedTickers,
    scopes: replayScopes.map((scope) => ({
      accountId: scope.accountId,
      accountName: scope.accountName,
      ticker: scope.ticker,
      marketCode: scope.marketCode,
      earliestReplayDate: scope.fromDate,
      accountRevision: scope.accountRevision,
      fingerprint: scope.fingerprint,
      status: "queued",
      errorMessage: null,
      replayRunId: runId,
    })),
    fingerprint: preview.fingerprint,
    confirmationDigest: preview.confirmationDigest,
    replayRunId: runId,
    createdAt,
    startedAt: null,
    completedAt: null,
  };
  const replayPreviewRecord: import("../persistence/types.js").McpReplayPreviewRecord = {
    id: preview.id,
    sessionUserId: input.actorUserId ?? input.ownerUserId,
    portfolioContextUserId: input.ownerUserId,
    scopes: replayScopes.map((scope) => ({
      accountId: scope.accountId,
      accountName: scope.accountName,
      ticker: scope.ticker,
      marketCode: scope.marketCode,
    })),
    warnings: preview.warnings,
    confirmationSummary: preview.confirmationSummary,
    confirmationDigest: preview.confirmationDigest,
    expiresAt: preview.expiresAt,
    createdAt: preview.createdAt,
  };
  const replayRunRecord: import("../persistence/types.js").McpReplayRunRecord = {
    id: runId,
    previewId: preview.id,
    sessionUserId: input.actorUserId ?? input.ownerUserId,
    portfolioContextUserId: input.ownerUserId,
    status: "queued",
    createdAt,
    startedAt: null,
    finishedAt: null,
    scopes: replayScopes.map((scope) => ({
      accountId: scope.accountId,
      accountName: scope.accountName,
      ticker: scope.ticker,
      marketCode: scope.marketCode,
      status: "pending",
      errorMessage: null,
      replayedTradeCount: null,
      snapshotGenerationRunId: null,
      earliestReplayDate: scope.fromDate,
      deletedTradeEventIds: scope.deletedTradeEventIds ?? [],
      updatedAt: createdAt,
    })),
  };
  try {
    await persistence.commitPostedTransactionMutation({
      userId: input.ownerUserId,
      accounting: preview.finalAccounting,
      auditEntry: {
        actorUserId: input.actorUserId ?? input.ownerUserId,
        action: "delegated_portfolio_write",
        targetUserId: input.ownerUserId,
        metadata: {
          mutation: "posted_transaction_mutation_confirmed",
          previewId: preview.id,
          runId,
          operation: preview.operation,
          completedAt: createdAt,
        },
      },
      preview,
      replayPreview: replayPreviewRecord,
      run: runRecord,
      replayRun: replayRunRecord,
      options: {
        accountIds: preview.affectedAccountIds,
        expectedAccountRevisions: preview.accountRevisions,
        deleteHoldingSnapshotScopes: preview.replayScopes.map((scope) => ({
          accountId: scope.accountId,
          ticker: scope.ticker,
          marketCode: scope.marketCode,
          fromDate: scope.fromDate,
        })),
        deletedDraftLineage,
      },
    });
  } catch (error) {
    if (!hasErrorCode(error, "posted_transaction_mutation_preview_stale")) throw error;
    const latestPreview = await persistence.getPostedTransactionMutationPreview(preview.id);
    if (!latestPreview?.confirmedRunId) throw error;
    if (!isIdenticalConfirmationRetry(latestPreview, input.confirmation)) {
      throw routeError(
        409,
        "posted_transaction_mutation_confirmation_conflict",
        "Preview confirmation does not match prior confirmation",
      );
    }
    const existingRun = await persistence.getPostedTransactionMutationRun(latestPreview.confirmedRunId);
    if (!existingRun) throw error;
    const existingReplayRun = existingRun.replayRunId
      ? await persistence.getMcpReplayRun(existingRun.replayRunId)
      : null;
    return mapRunFromReplay(existingRun, existingReplayRun, input.appBaseUrl);
  }
  if (sideEffects.eventBus) {
    try {
      await publishMutationCommitEvents(sideEffects.eventBus, input.ownerUserId, runRecord);
    } catch {
      // Core accounting and the durable run are already committed; event delivery is best-effort.
    }
  }
  return mapRunFromReplay(runRecord, replayRunRecord, input.appBaseUrl);
}

export async function getPostedTransactionMutationRun(
  persistence: Persistence,
  input: {
    ownerUserId: string;
    actorUserId?: string;
    runId: string;
    appBaseUrl: string;
  },
): Promise<PostedTransactionMutationRunDto> {
  const run = await persistence.getPostedTransactionMutationRun(input.runId);
  if (
    !run
    || run.ownerUserId !== input.ownerUserId
    || (input.actorUserId && run.actorUserId !== input.actorUserId)
  ) {
    throw routeError(404, "posted_transaction_mutation_unauthorized_or_missing", "Posted transaction mutation run not found");
  }
  const replayRun = run.replayRunId ? await persistence.getMcpReplayRun(run.replayRunId) : null;
  return mapRunFromReplay(run, replayRun, input.appBaseUrl);
}

export async function dispatchPostedTransactionMutationRebuild(
  persistence: Persistence,
  input: {
    ownerUserId: string;
    runId: string;
    boss?: { send(queue: string, payload: Record<string, unknown>, options?: { singletonKey?: string }): Promise<unknown> };
    eventBus?: MutationEventBus;
  },
): Promise<void> {
  if (input.boss) {
    try {
      await input.boss.send(MCP_REPLAY_POSITION_RUN_QUEUE, { runId: input.runId }, { singletonKey: input.runId });
    } catch (error) {
      const failedAt = new Date().toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);
      const mutationRun = await persistence.getPostedTransactionMutationRun(input.runId);
      const replayRun = mutationRun?.replayRunId
        ? await persistence.getMcpReplayRun(mutationRun.replayRunId)
        : null;
      if (replayRun) {
        await persistence.updateMcpReplayRunStatus({
          runId: replayRun.id,
          status: "failed",
          finishedAt: failedAt,
        });
        for (const scope of replayRun.scopes) {
          await persistence.updateMcpReplayRunScope({
            ...scope,
            runId: replayRun.id,
            status: "failed",
            errorMessage,
            updatedAt: failedAt,
          });
        }
      }
      if (mutationRun) {
        await persistence.savePostedTransactionMutationRun({
          ...mutationRun,
          status: "failed",
          rebuildStatus: "failed",
          errors: [
            ...mutationRun.errors,
            { code: "posted_transaction_mutation_enqueue_failed", message: errorMessage },
          ],
          scopes: mutationRun.scopes.map((scope) => ({
            ...scope,
            status: "failed",
            errorMessage,
          })),
          completedAt: failedAt,
        });
        if (input.eventBus) {
          try {
            await publishMutationRebuildEvent(input.eventBus, mutationRun, "failed");
          } catch {
            // The durable failed run remains the source of truth if event delivery also fails.
          }
        }
      }
    }
    return;
  }
  await runRebuildSynchronously(persistence, input.ownerUserId, input.runId, input.eventBus);
}
