import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DailyBar, MarketCode } from "@vakwen/domain";
import { MARKET_CODES, marketCodeFor, type MarketCode as SharedMarketCode } from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import type { McpToolHandlerContext } from "../mcp/types.js";
import type { HoldingSnapshotScopePair, McpReplayRunRecord, McpReplayScopeRecord } from "../persistence/types.js";
import type { RecomputeJob, Store } from "../types/store.js";
import { listHoldings } from "./portfolio.js";
import { previewRecompute, confirmRecompute } from "./recompute.js";
import { replayPositionHistory } from "./replayPositionHistory.js";
import { recomputeSnapshotsForTicker, generateHoldingSnapshots } from "./snapshotGeneration.js";
import { generateCurrencyWalletSnapshots } from "./currencyWalletSnapshotGeneration.js";
import { getEffectiveTickerPriceFreshnessConfig } from "./appConfig/tickerPriceFreshness.js";
import { enqueueDemandIntradayRefreshes } from "./market-data/intradayDemandRefresh.js";
import { isRegularSessionMarketCode } from "./market-data/marketRegularSession.js";
import { runCloseRefresh } from "./market-data/closeRefreshService.js";
import { enqueueCloseRefresh } from "./market-data/closeRefreshWorker.js";
import { TwseStockDayCloseProvider, YahooChartCloseProvider } from "./market-data/providers/index.js";
import { upsertDailyBars } from "./market-data/upserts.js";
import {
  BACKFILL_QUEUE,
  getBackfillJobSingletonKey,
  type BackfillJobData,
} from "./market-data/backfillWorker.js";

export const MCP_REPLAY_POSITION_RUN_QUEUE = "mcp-replay-position-runs";
const MAX_REPLAY_SCOPES = 50;
const MAX_SNAPSHOT_PAGE_SIZE = 200;
const REPLAY_CONFIRMATION_TTL_MS = 15 * 60 * 1000;
const RECOMPUTE_CONFIRMATION_TTL_MS = 15 * 60 * 1000;

interface TickerMarketInput {
  ticker: string;
  marketCode: SharedMarketCode;
}

interface ScopedInput {
  accountIds?: string[];
  accountNames?: string[];
  tickerMarkets?: TickerMarketInput[];
}

export interface RefreshPortfolioPricesInput extends ScopedInput {
  includeIntraday?: boolean;
}

export interface RecomputePortfolioFeesPreviewInput extends ScopedInput {
  profileId?: string;
  useFallbackBindings?: boolean;
}

export interface RecomputePortfolioFeesInput {
  jobId: string;
  confirmationSummary: string;
  confirmationDigest: string;
}

export type ReplayPortfolioPositionsPreviewInput = ScopedInput;

export interface ReplayPortfolioPositionsInput {
  previewId: string;
  confirmationSummary: string;
  confirmationDigest: string;
}

export interface GetReplayPortfolioPositionsRunInput {
  runId: string;
}

export interface BackfillTickersInput extends ScopedInput {
  startDate?: string;
  endDate?: string;
  includeBars?: boolean;
  includeDividends?: boolean;
}

export interface GetDailySnapshotsInput extends ScopedInput {
  startDate?: string;
  endDate?: string;
  includeProvisional?: boolean;
  limit?: number;
  offset?: number;
}

interface ScopedPair {
  accountId: string;
  accountName: string;
  ticker: string;
  marketCode: MarketCode;
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function assertSharedMarketCode(marketCode: string): asserts marketCode is SharedMarketCode {
  if (!(MARKET_CODES as readonly string[]).includes(marketCode)) {
    throw routeError(400, "mcp_invalid_market_code", `Unsupported marketCode ${marketCode}`);
  }
}

async function loadContextStore(deps: McpToolHandlerContext): Promise<{ userId: string; store: Store }> {
  const userId = deps.requestContext.resolvedContext.portfolioContextUserId;
  return { userId, store: await deps.app.persistence.loadStore(userId) };
}

function resolveAccountIds(store: Store, input: ScopedInput): Set<string> {
  const activeAccounts = store.accounts;
  const activeIds = new Set(activeAccounts.map((account) => account.id));
  const hasAccountIdFilter = input.accountIds !== undefined && input.accountIds.length > 0;
  const accountIds = hasAccountIdFilter
    ? new Set(input.accountIds)
    : new Set(activeIds);

  for (const accountId of accountIds) {
    if (!activeIds.has(accountId)) {
      throw routeError(404, "mcp_account_not_found", `Active account ${accountId} was not found`);
    }
  }

  if (!input.accountNames || input.accountNames.length === 0) return accountIds;
  const byName = new Map<string, Store["accounts"]>();
  for (const account of activeAccounts) {
    const key = account.name.trim().toLowerCase();
    const bucket = byName.get(key) ?? [];
    bucket.push(account);
    byName.set(key, bucket);
  }
  const fromNames = new Set<string>();
  for (const accountName of input.accountNames) {
    const matches = byName.get(accountName.trim().toLowerCase()) ?? [];
    if (matches.length === 0) {
      throw routeError(404, "mcp_account_not_found", `Active account named ${accountName} was not found`);
    }
    if (matches.length > 1) {
      throw routeError(409, "mcp_account_name_ambiguous", `Account name ${accountName} matched multiple active accounts`);
    }
    fromNames.add(matches[0]!.id);
  }
  const idList = [...accountIds].sort();
  const nameList = [...fromNames].sort();
  if (hasAccountIdFilter && (idList.length !== nameList.length || idList.some((id, index) => id !== nameList[index]))) {
    throw routeError(409, "mcp_account_filter_conflict", "accountIds and accountNames resolved to different accounts");
  }
  return fromNames;
}

function resolveHeldMarketCode(store: Store, holding: { accountId: string; ticker: string; currency: string }): MarketCode | null {
  const tradeMarkets = [...new Set(
    store.accounting.facts.tradeEvents
      .filter((trade) => trade.accountId === holding.accountId && trade.ticker === holding.ticker)
      .map((trade) => trade.marketCode),
  )];
  if (tradeMarkets.length === 1) return tradeMarkets[0]!;
  if (tradeMarkets.length > 1) {
    throw routeError(400, "mcp_ambiguous_market_scope", `Holding ${holding.ticker} has multiple trade markets; provide or repair explicit market identity`);
  }
  const instrumentMarkets = [...new Set(
    store.instruments
      .filter((instrument) => instrument.ticker === holding.ticker)
      .map((instrument) => instrument.marketCode),
  )];
  if (instrumentMarkets.length === 1) return instrumentMarkets[0]!;
  if (instrumentMarkets.length > 1) {
    throw routeError(400, "mcp_ambiguous_market_scope", `Holding ${holding.ticker} has multiple instrument markets; provide or repair explicit market identity`);
  }
  const account = store.accounts.find((item) => item.id === holding.accountId);
  return account ? marketCodeFor(account.defaultCurrency) : null;
}

function resolveHeldPairs(store: Store, userId: string, input: ScopedInput): ScopedPair[] {
  const accountIds = resolveAccountIds(store, input);
  const requested = input.tickerMarkets && input.tickerMarkets.length > 0
    ? new Set(input.tickerMarkets.map((pair) => {
        assertSharedMarketCode(pair.marketCode);
        return `${normalizeTicker(pair.ticker)}\0${pair.marketCode}`;
      }))
    : null;
  const accountsById = new Map(store.accounts.map((account) => [account.id, account]));
  const pairs = new Map<string, ScopedPair>();
  for (const holding of listHoldings(store, userId)) {
    if (holding.quantity <= 0 || !accountIds.has(holding.accountId)) continue;
    const marketCode = resolveHeldMarketCode(store, holding);
    if (!marketCode) continue;
    assertSharedMarketCode(marketCode);
    const ticker = normalizeTicker(holding.ticker);
    if (requested && !requested.has(`${ticker}\0${marketCode}`)) continue;
    const account = accountsById.get(holding.accountId);
    if (!account) continue;
    pairs.set(`${holding.accountId}\0${ticker}\0${marketCode}`, {
      accountId: holding.accountId,
      accountName: account.name,
      ticker,
      marketCode,
    });
  }
  if (requested) {
    const resolvedTickerMarkets = new Set([...pairs.values()].map((pair) => `${pair.ticker}\0${pair.marketCode}`));
    const missing = [...requested].filter((key) => !resolvedTickerMarkets.has(key));
    if (missing.length > 0) {
      throw routeError(400, "mcp_ticker_not_in_portfolio_scope", "tickerMarkets must be held by the selected portfolio/account scope");
    }
  }
  return [...pairs.values()].sort((left, right) =>
    left.accountName.localeCompare(right.accountName)
    || left.ticker.localeCompare(right.ticker)
    || left.marketCode.localeCompare(right.marketCode));
}

function toSnapshotScopePairs(
  accountIds: readonly string[],
  tickerMarkets: readonly TickerMarketInput[] | undefined,
): HoldingSnapshotScopePair[] | undefined {
  if (!tickerMarkets || tickerMarkets.length === 0) return undefined;
  return accountIds.flatMap((accountId) => tickerMarkets.map((pair) => {
    assertSharedMarketCode(pair.marketCode);
    return {
      accountId,
      ticker: normalizeTicker(pair.ticker),
      marketCode: pair.marketCode,
    };
  }));
}

async function opportunisticUpsertDailyBars(app: FastifyInstance, bars: DailyBar[], marketCode: MarketCode): Promise<void> {
  if (bars.length === 0) return;
  const dates = [...new Set(bars.map((bar) => bar.barDate))];
  if ("getPool" in app.persistence && typeof app.persistence.getPool === "function") {
    await upsertDailyBars(app.persistence.getPool(), bars.map((bar) => ({
      ticker: bar.ticker,
      marketCode,
      barDate: bar.barDate,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      quality: bar.quality,
      sourceId: bar.source,
    })));
  } else if ("_seedDailyBars" in app.persistence && typeof app.persistence._seedDailyBars === "function") {
    app.persistence._seedDailyBars(bars.map((bar) => ({ ...bar, marketCode })));
  }
  app.tradingCalendarCache.notifyBarsUpserted(marketCode, dates);
}

export async function refreshPortfolioPrices(
  deps: McpToolHandlerContext,
  input: RefreshPortfolioPricesInput,
) {
  const { userId, store } = await loadContextStore(deps);
  const heldPairs = resolveHeldPairs(store, userId, input)
    .filter((pair) => isRegularSessionMarketCode(pair.marketCode));
  const config = getEffectiveTickerPriceFreshnessConfig();
  const syncPairs = heldPairs.slice(0, config.syncTickerCap);
  const queuedPairs = heldPairs.slice(config.syncTickerCap);
  const fallbackProviders = {
    twseStockDay: new TwseStockDayCloseProvider(),
    ...(deps.app.tickerPriceChartRequestBudget
      ? {
          yahooChartClose: new YahooChartCloseProvider({
            range: config.yahooChartRange,
            interval: config.yahooChartInterval,
            persistence: deps.app.persistence,
            requestBudget: deps.app.tickerPriceChartRequestBudget,
          }),
        }
      : {}),
  };
  const result = await runCloseRefresh({
    pairs: syncPairs,
    persistence: deps.app.persistence,
    activityPersistence: deps.app.persistence,
    tradingCalendar: deps.app.tradingCalendarCache,
    marketDataProviders: deps.app.marketDataRegistry.marketData,
    fallbackProviders,
    upsertBars: (bars, marketCode) => opportunisticUpsertDailyBars(deps.app, bars, marketCode),
    closeRefreshGraceMinutes: config.closeRefreshGraceMinutes,
    supportedMarkets: config.supportedMarkets,
    log: deps.app.log,
  });
  for (const pair of queuedPairs) {
    const jobId = await enqueueCloseRefresh(deps.app.boss ?? null, {
      ticker: pair.ticker,
      marketCode: pair.marketCode,
      requestedAt: new Date().toISOString(),
    });
    result.items.push({
      ticker: pair.ticker,
      marketCode: pair.marketCode,
      status: jobId ? "queued" : "failed",
      barDate: null,
      source: null,
      quality: null,
      ...(jobId ? {} : { error: "close_refresh_queue_unavailable" }),
    });
    result.summary[jobId ? "queued" : "failed"] += 1;
  }
  const intraday = input.includeIntraday === false
    ? null
    : await enqueueDemandIntradayRefreshes({
        pairs: heldPairs,
        boss: deps.app.boss ?? null,
        persistence: deps.app.persistence,
        tradingCalendar: deps.app.tradingCalendarCache,
        log: deps.app.log,
      });
  return { ...result, intraday, scope: { heldTickerMarketPairs: heldPairs.length, syncCap: config.syncTickerCap } };
}

export async function previewRecomputePortfolioFees(
  deps: McpToolHandlerContext,
  input: RecomputePortfolioFeesPreviewInput,
) {
  const { userId, store } = await loadContextStore(deps);
  const hasAccountFilter = (input.accountIds && input.accountIds.length > 0)
    || (input.accountNames && input.accountNames.length > 0);
  const accountIds = hasAccountFilter ? resolveAccountIds(store, input) : new Set<string>();
  if (hasAccountFilter && accountIds.size > 1) {
    throw routeError(400, "mcp_single_account_required", "preview_recompute_portfolio_fees supports one account scope per preview");
  }
  const job = previewRecompute(store, {
    userId,
    profileId: input.profileId,
    accountId: hasAccountFilter ? [...accountIds][0] : undefined,
    useFallbackBindings: input.useFallbackBindings ?? true,
  });
  await deps.app.persistence.saveStore(store);
  const confirmation = buildRecomputeConfirmation(job);
  return {
    jobId: job.id,
    status: job.status,
    affectedItemCount: job.items.length,
    confirmationSummary: confirmation.summary,
    confirmationDigest: confirmation.digest,
    expiresAt: new Date(new Date(job.createdAt).getTime() + RECOMPUTE_CONFIRMATION_TTL_MS).toISOString(),
    deltas: job.items.slice(0, 100).map((item) => ({
      tradeEventId: item.tradeEventId,
      commissionDelta: item.nextCommissionAmount - item.previousCommissionAmount,
      taxDelta: item.nextTaxAmount - item.previousTaxAmount,
    })),
    deltasTruncated: job.items.length > 100,
  };
}

export async function recomputePortfolioFees(
  deps: McpToolHandlerContext,
  input: RecomputePortfolioFeesInput,
) {
  const { userId, store } = await loadContextStore(deps);
  const preview = store.recomputeJobs.find((item) => item.id === input.jobId && item.userId === userId);
  if (!preview) throw routeError(404, "job_not_found", "Recompute job not found");
  if (preview.status !== "PREVIEWED") {
    throw routeError(409, "mcp_recompute_preview_already_confirmed", "Recompute preview was already confirmed");
  }
  if (new Date(preview.createdAt).getTime() + RECOMPUTE_CONFIRMATION_TTL_MS < Date.now()) {
    throw routeError(409, "mcp_recompute_preview_expired", "Recompute preview expired");
  }
  const confirmation = buildRecomputeConfirmation(preview);
  if (input.confirmationSummary !== confirmation.summary || input.confirmationDigest !== confirmation.digest) {
    throw routeError(409, "mcp_recompute_confirmation_mismatch", "Recompute confirmation does not match the latest preview");
  }
  const job = confirmRecompute(store, userId, input.jobId);
  await deps.app.persistence.saveStore(store);
  const snapshotRunId = randomUUID();
  setImmediate(async () => {
    try {
      const result = await generateHoldingSnapshots(userId, deps.app.persistence, { generationRunId: snapshotRunId });
      if (deps.app.boss && result.tickersNeedingBackfill.length > 0) {
        for (const { ticker, marketCode } of result.tickersNeedingBackfill) {
          await deps.app.boss.send(
            BACKFILL_QUEUE,
            { ticker, marketCode, trigger: "first_trade", includeBars: true } satisfies BackfillJobData,
            { singletonKey: getBackfillJobSingletonKey({ ticker, marketCode }) },
          );
        }
      }
      await generateCurrencyWalletSnapshots(userId, deps.app.persistence);
    } catch (error) {
      deps.app.log.warn({ err: error instanceof Error ? error.message : String(error), snapshotRunId }, "mcp_recompute_snapshot_refresh_failed");
    }
  });
  return {
    jobId: job.id,
    status: job.status,
    affectedItemCount: job.items.length,
    holdingSnapshotGenerationRunId: snapshotRunId,
    walletSnapshotRefreshQueued: true,
  };
}

function buildRecomputeConfirmation(job: RecomputeJob): { summary: string; digest: string } {
  const summary = `Recompute fees for ${job.items.length} trade event(s) in ${job.accountId ? `account ${job.accountId}` : "all selected accounts"} using profile ${job.profileId}`;
  const digest = createHash("sha256").update(JSON.stringify({
    jobId: job.id,
    userId: job.userId,
    accountId: job.accountId ?? null,
    profileId: job.profileId,
    createdAt: job.createdAt,
    items: job.items.map((item) => ({
      tradeEventId: item.tradeEventId,
      previousCommissionAmount: item.previousCommissionAmount,
      previousTaxAmount: item.previousTaxAmount,
      nextCommissionAmount: item.nextCommissionAmount,
      nextTaxAmount: item.nextTaxAmount,
    })),
  })).digest("hex");
  return { summary, digest };
}

function buildReplayConfirmation(scopes: readonly McpReplayScopeRecord[]): { summary: string; digest: string } {
  const summary = `Replay ${scopes.length} position scope(s): ${scopes
    .map((scope) => `${scope.accountName}/${scope.ticker}.${scope.marketCode}`)
    .join(", ")}`;
  const digest = createHash("sha256").update(JSON.stringify(scopes.map((scope) => ({
    accountId: scope.accountId,
    ticker: scope.ticker,
    marketCode: scope.marketCode,
  })))).digest("hex");
  return { summary, digest };
}

export async function previewReplayPortfolioPositions(
  deps: McpToolHandlerContext,
  input: ReplayPortfolioPositionsPreviewInput,
) {
  const { userId, store } = await loadContextStore(deps);
  const heldPairs = resolveHeldPairs(store, userId, input);
  const scopes = heldPairs.slice(0, MAX_REPLAY_SCOPES).map((pair) => ({
    accountId: pair.accountId,
    accountName: pair.accountName,
    ticker: pair.ticker,
    marketCode: pair.marketCode,
  }));
  if (scopes.length === 0) throw routeError(400, "mcp_no_replay_scopes", "No held position scopes matched the request");
  const warnings = heldPairs.length > MAX_REPLAY_SCOPES
    ? [`Scope capped at ${MAX_REPLAY_SCOPES} position scopes`]
    : [];
  const confirmation = buildReplayConfirmation(scopes);
  const now = new Date();
  const preview = {
    id: randomUUID(),
    sessionUserId: deps.requestContext.resolvedContext.sessionUserId,
    portfolioContextUserId: userId,
    scopes,
    warnings,
    confirmationSummary: confirmation.summary,
    confirmationDigest: confirmation.digest,
    expiresAt: new Date(now.getTime() + REPLAY_CONFIRMATION_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
  };
  await deps.app.persistence.saveMcpReplayPreview(preview);
  return preview;
}

export async function replayPortfolioPositions(
  deps: McpToolHandlerContext,
  input: ReplayPortfolioPositionsInput,
) {
  const userId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const preview = await deps.app.persistence.getMcpReplayPreview(input.previewId);
  if (!preview || preview.portfolioContextUserId !== userId) {
    throw routeError(404, "mcp_replay_preview_not_found", "Replay preview not found");
  }
  if (new Date(preview.expiresAt).getTime() < Date.now()) {
    throw routeError(409, "mcp_replay_preview_expired", "Replay preview expired");
  }
  if (preview.confirmationSummary !== input.confirmationSummary || preview.confirmationDigest !== input.confirmationDigest) {
    throw routeError(409, "mcp_replay_confirmation_mismatch", "Replay confirmation does not match the latest preview");
  }
  const { store } = await loadContextStore(deps);
  const currentScopes = resolveHeldPairs(store, userId, { tickerMarkets: preview.scopes.map((scope) => ({
    ticker: scope.ticker,
    marketCode: scope.marketCode as SharedMarketCode,
  })), accountIds: [...new Set(preview.scopes.map((scope) => scope.accountId))] });
  const currentKeys = new Set(currentScopes.map((scope) => `${scope.accountId}\0${scope.ticker}\0${scope.marketCode}`));
  const previewKeys = preview.scopes.map((scope) => `${scope.accountId}\0${scope.ticker}\0${scope.marketCode}`);
  if (currentKeys.size !== previewKeys.length || previewKeys.some((key) => !currentKeys.has(key))) {
    throw routeError(409, "mcp_replay_scope_changed", "Replay scope changed after preview; create a new preview");
  }
  const now = new Date().toISOString();
  if (!deps.app.boss) {
    throw routeError(503, "mcp_replay_queue_unavailable", "Replay queue is unavailable");
  }
  const run: McpReplayRunRecord = {
    id: randomUUID(),
    previewId: preview.id,
    sessionUserId: deps.requestContext.resolvedContext.sessionUserId,
    portfolioContextUserId: userId,
    status: "queued",
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    scopes: preview.scopes.map((scope) => ({
      ...scope,
      status: "pending",
      errorMessage: null,
      replayedTradeCount: null,
      snapshotGenerationRunId: null,
      updatedAt: now,
    })),
  };
  await deps.app.persistence.createMcpReplayRun(run);
  try {
    await deps.app.boss.send(MCP_REPLAY_POSITION_RUN_QUEUE, { runId: run.id }, {
      singletonKey: run.id,
    });
  } catch (error) {
    await deps.app.persistence.updateMcpReplayRunStatus({
      runId: run.id,
      status: "failed",
      finishedAt: new Date().toISOString(),
    });
    for (const scope of run.scopes) {
      await deps.app.persistence.updateMcpReplayRunScope({
        ...scope,
        runId: run.id,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      });
    }
    throw error;
  }
  return run;
}

export async function executeReplayRun(app: FastifyInstance, userId: string, runId: string): Promise<void> {
  const run = await app.persistence.getMcpReplayRun(runId);
  if (!run || run.portfolioContextUserId !== userId) return;
  await app.persistence.updateMcpReplayRunStatus({ runId, status: "running", startedAt: new Date().toISOString() });
  let succeeded = 0;
  let failed = 0;
  for (const scope of run.scopes) {
    await app.persistence.updateMcpReplayRunScope({ ...scope, runId, status: "running", updatedAt: new Date().toISOString() });
    try {
      const summary = await replayPositionHistory(app.persistence, userId, scope.accountId, scope.ticker, {
        marketCode: scope.marketCode,
      });
      const snapshotResult = await recomputeSnapshotsForTicker(userId, scope.accountId, scope.ticker, "1970-01-01", app.persistence, scope.marketCode);
      await app.persistence.updateMcpReplayRunScope({
        ...scope,
        runId,
        status: "succeeded",
        replayedTradeCount: summary.affectedTradeCount,
        snapshotGenerationRunId: snapshotResult.generationRunId,
        updatedAt: new Date().toISOString(),
      });
      succeeded++;
    } catch (error) {
      await app.persistence.updateMcpReplayRunScope({
        ...scope,
        runId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      });
      failed++;
    }
  }
  try {
    if (succeeded > 0) await generateCurrencyWalletSnapshots(userId, app.persistence);
  } catch {
    // Replay status is position-scoped; wallet refresh failures are surfaced by logs.
  }
  await app.persistence.updateMcpReplayRunStatus({
    runId,
    status: failed === 0 ? "completed" : succeeded === 0 ? "failed" : "completed_with_failures",
    finishedAt: new Date().toISOString(),
  });
}

export async function getReplayPortfolioPositionsRun(
  deps: McpToolHandlerContext,
  input: GetReplayPortfolioPositionsRunInput,
) {
  const userId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const run = await deps.app.persistence.getMcpReplayRun(input.runId);
  if (!run || run.portfolioContextUserId !== userId) {
    throw routeError(404, "mcp_replay_run_not_found", "Replay run not found");
  }
  return run;
}

export async function backfillTickers(
  deps: McpToolHandlerContext,
  input: BackfillTickersInput,
) {
  if (!deps.app.boss) throw routeError(503, "mcp_backfill_queue_unavailable", "Backfill queue is unavailable");
  const { userId, store } = await loadContextStore(deps);
  const held = resolveHeldPairs(store, userId, {
    accountIds: input.accountIds,
    accountNames: input.accountNames,
  });
  const monitored = await deps.app.persistence.getMonitoredSet(userId);
  const eligible = new Map<string, { ticker: string; marketCode: MarketCode }>();
  for (const pair of held) eligible.set(`${pair.ticker}\0${pair.marketCode}`, pair);
  for (const pair of monitored) {
    assertSharedMarketCode(pair.marketCode);
    eligible.set(`${normalizeTicker(pair.ticker)}\0${pair.marketCode}`, {
      ticker: normalizeTicker(pair.ticker),
      marketCode: pair.marketCode,
    });
  }
  const requested = input.tickerMarkets && input.tickerMarkets.length > 0
    ? input.tickerMarkets.map((pair) => {
        assertSharedMarketCode(pair.marketCode);
        return `${normalizeTicker(pair.ticker)}\0${pair.marketCode}`;
      })
    : [...eligible.keys()];
  const enqueued = [];
  for (const key of requested) {
    const pair = eligible.get(key);
    if (!pair) throw routeError(400, "mcp_ticker_not_in_portfolio_scope", "Backfill is limited to held or monitored ticker-market pairs");
    const payload = {
      ticker: pair.ticker,
      marketCode: pair.marketCode,
      userId,
      trigger: "repair",
      startDate: input.startDate,
      endDate: input.endDate,
      includeBars: input.includeBars ?? true,
      includeDividends: input.includeDividends ?? true,
    } satisfies BackfillJobData;
    const jobId = await deps.app.boss.send(BACKFILL_QUEUE, payload, {
      singletonKey: getBackfillJobSingletonKey(payload),
    });
    enqueued.push({ ...pair, jobId });
  }
  return { enqueuedCount: enqueued.length, enqueued };
}

export async function getDailySnapshots(
  deps: McpToolHandlerContext,
  input: GetDailySnapshotsInput,
) {
  const { userId, store } = await loadContextStore(deps);
  const accountIds = [...resolveAccountIds(store, input)];
  const scopePairs = toSnapshotScopePairs(accountIds, input.tickerMarkets);
  const limit = Math.min(input.limit ?? 100, MAX_SNAPSHOT_PAGE_SIZE);
  const offset = input.offset ?? 0;
  const result = await deps.app.persistence.listHoldingSnapshots(userId, {
    accountIds,
    pairs: scopePairs,
    startDate: input.startDate,
    endDate: input.endDate,
    includeProvisional: input.includeProvisional ?? true,
    limit,
    offset,
  });
  return {
    rows: result.rows,
    summary: {
      total: result.total,
      provisionalCount: result.provisionalCount,
      limit,
      offset,
      hasMore: offset + result.rows.length < result.total,
    },
  };
}
