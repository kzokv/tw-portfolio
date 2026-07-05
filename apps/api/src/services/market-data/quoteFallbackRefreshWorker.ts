import type { MarketCode } from "@vakwen/domain";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Persistence, QuoteFallbackPolicyRecord } from "../../persistence/types.js";
import { runQuoteFallbackRefresh, type RunQuoteFallbackRefreshInput } from "./quoteFallbackRefreshService.js";

export const QUOTE_FALLBACK_REFRESH_QUEUE = "quote-fallback-refresh";
export const QUOTE_FALLBACK_REFRESH_SCHEDULE_CRON = "*/30 * * * *";

export interface QuoteFallbackPolicyRefreshJobData {
  kind: "policy_refresh";
  ticker: string;
  marketCode: MarketCode;
  requestedAt: string;
  trigger: "scheduled" | "manual";
}

export interface QuoteFallbackScheduledScanJobData {
  kind: "scheduled_scan";
  requestedAt?: string;
}

export type QuoteFallbackRefreshJobData =
  | QuoteFallbackPolicyRefreshJobData
  | QuoteFallbackScheduledScanJobData;

export interface QuoteFallbackRefreshWorkerConfig {
  concurrency: number;
  retryLimit: number;
  retryDelaySeconds: number;
  retryBackoff: boolean;
  expireInSeconds: number;
}

export interface QuoteFallbackRefreshRuntimeConfig {
  closeRefreshGraceMinutes: number;
  dailyCallLimit: number;
  supportedMarkets: ReadonlyArray<MarketCode>;
}

export interface QuoteFallbackRefreshWorkerDeps {
  boss?: Pick<PgBoss, "send">;
  persistence: Persistence;
  provider: RunQuoteFallbackRefreshInput["provider"];
  tradingCalendar: RunQuoteFallbackRefreshInput["tradingCalendar"];
  resolveRuntimeConfig: () => QuoteFallbackRefreshRuntimeConfig;
  log: NonNullable<RunQuoteFallbackRefreshInput["log"]>;
}

export function quoteFallbackRefreshSingletonKey(ticker: string, marketCode: MarketCode): string {
  return `${QUOTE_FALLBACK_REFRESH_QUEUE}:${marketCode}:${ticker.trim().toUpperCase()}`;
}

export function buildQuoteFallbackRefreshQueueOptions(config: QuoteFallbackRefreshWorkerConfig) {
  return {
    policy: "stately",
    retryLimit: config.retryLimit,
    retryDelay: config.retryDelaySeconds,
    retryBackoff: config.retryBackoff,
    expireInSeconds: config.expireInSeconds,
  } as const;
}

export function createQuoteFallbackRefreshHandler(deps: QuoteFallbackRefreshWorkerDeps) {
  return async (jobs: ReadonlyArray<JobWithMetadata<QuoteFallbackRefreshJobData>>) => {
    for (const job of jobs) {
      const data = job.data;
      if (data?.kind === "scheduled_scan") {
        await enqueueScheduledQuoteFallbackRefreshes({
          boss: deps.boss ?? null,
          persistence: deps.persistence,
          requestedAt: data.requestedAt,
          supportedMarkets: deps.resolveRuntimeConfig().supportedMarkets,
          log: deps.log,
        });
        continue;
      }
      if (data?.kind !== "policy_refresh" || !data.ticker || !data.marketCode) {
        throw new Error("quote_fallback_refresh_job_invalid");
      }

      const policy = await deps.persistence.getQuoteFallbackPolicy(data.ticker, data.marketCode);
      if (!policy || !policy.active) {
        deps.log.warn(
          { ticker: data.ticker, marketCode: data.marketCode, jobId: job.id },
          "quote_fallback_refresh_policy_missing_or_inactive",
        );
        continue;
      }

      const runtimeConfig = deps.resolveRuntimeConfig();
      deps.log.info(
        { ticker: data.ticker, marketCode: data.marketCode, jobId: job.id, trigger: data.trigger },
        "quote_fallback_refresh_started",
      );
      const result = await runQuoteFallbackRefresh({
        policies: [policy],
        persistence: createQuoteFallbackRefreshPersistenceAdapter(deps.persistence),
        provider: deps.provider,
        tradingCalendar: deps.tradingCalendar,
        budget: {
          tryConsume: async ({ budgetDate, calls }) => {
            const budget = await deps.persistence.consumeEodhdCallBudget({
              budgetDate,
              limit: runtimeConfig.dailyCallLimit,
              calls,
            });
            return {
              allowed: budget.allowed,
              limit: budget.limit,
              used: budget.used,
              remaining: budget.remaining,
            };
          },
        },
        closeRefreshGraceMinutes: runtimeConfig.closeRefreshGraceMinutes,
        now: parseRequestedAt(data.requestedAt),
        log: deps.log,
      });
      deps.log.info(
        {
          ticker: data.ticker,
          marketCode: data.marketCode,
          jobId: job.id,
          trigger: data.trigger,
          summary: result.summary,
        },
        "quote_fallback_refresh_worker_completed",
      );
    }
  };
}

function createQuoteFallbackRefreshPersistenceAdapter(
  persistence: Persistence,
): RunQuoteFallbackRefreshInput["persistence"] {
  return {
    getQuoteFallbackPolicy: (ticker, marketCode) => persistence.getQuoteFallbackPolicy(ticker, marketCode),
    getLatestQuoteFallbackSnapshot: (policyId) => persistence.getLatestQuoteFallbackSnapshot(policyId),
    upsertQuoteFallbackSnapshot: async (input) => {
      await persistence.upsertQuoteFallbackSnapshot(input);
    },
    updateQuoteFallbackPolicyRefreshStatus: async (input) => {
      await persistence.updateQuoteFallbackPolicyRefreshStatus(input);
    },
    createMarketDataActivityEvent: async (input) => {
      await persistence.createMarketCalendarActivityEvent({
        marketCode: input.marketCode,
        category: input.category,
        result: input.result,
        sourceKind: input.sourceKind,
        sourceId: "eodhd",
        eventType: input.eventType,
        title: input.title,
        message: input.message,
        ticker: input.ticker,
        providerSymbol: input.providerSymbol,
        dedupeKey: input.dedupeKey,
        detail: input.detail,
      });
    },
  };
}

function parseRequestedAt(requestedAt: string): Date {
  const parsed = new Date(requestedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function enqueueScheduledQuoteFallbackRefreshes(input: {
  boss: Pick<PgBoss, "send"> | null;
  persistence: Persistence;
  requestedAt?: string;
  supportedMarkets: ReadonlyArray<MarketCode>;
  log: NonNullable<RunQuoteFallbackRefreshInput["log"]>;
}): Promise<{ policyCount: number; enqueuedCount: number; droppedCount: number }> {
  if (!input.boss) {
    input.log.warn({}, "quote_fallback_refresh_scheduled_scan_queue_unavailable");
    return { policyCount: 0, enqueuedCount: 0, droppedCount: 0 };
  }

  const supportedMarkets = new Set(input.supportedMarkets);
  const heldPairs = new Set(
    (await input.persistence.listHeldTickerMarketPairs())
      .map((pair) => `${pair.marketCode}:${pair.ticker.trim().toUpperCase()}`),
  );
  const requestedAt = parseRequestedAt(input.requestedAt ?? new Date().toISOString()).toISOString();
  const policies = (await input.persistence.listActiveQuoteFallbackPolicies())
    .filter((policy) => isRefreshCandidatePolicy(policy, supportedMarkets, heldPairs));

  let enqueuedCount = 0;
  let droppedCount = 0;
  for (const policy of policies) {
    const jobId = await enqueueQuoteFallbackRefresh(input.boss, {
      kind: "policy_refresh",
      ticker: policy.ticker,
      marketCode: policy.marketCode,
      requestedAt,
      trigger: "scheduled",
    });
    if (jobId) enqueuedCount += 1;
    else droppedCount += 1;
  }
  input.log.info(
    { policyCount: policies.length, enqueuedCount, droppedCount },
    "quote_fallback_refresh_scheduled_scan_enqueued",
  );
  return { policyCount: policies.length, enqueuedCount, droppedCount };
}

function isRefreshCandidatePolicy(
  policy: QuoteFallbackPolicyRecord,
  supportedMarkets: ReadonlySet<MarketCode>,
  heldPairs: ReadonlySet<string>,
): boolean {
  return policy.active
    && policy.provider === "eodhd"
    && policy.priceType === "eod_close"
    && supportedMarkets.has(policy.marketCode)
    && heldPairs.has(`${policy.marketCode}:${policy.ticker.trim().toUpperCase()}`);
}

export async function enqueueQuoteFallbackRefresh(
  boss: Pick<PgBoss, "send"> | null,
  data: QuoteFallbackPolicyRefreshJobData,
): Promise<string | null> {
  if (!boss) return null;
  return await boss.send(QUOTE_FALLBACK_REFRESH_QUEUE, data, {
    singletonKey: quoteFallbackRefreshSingletonKey(data.ticker, data.marketCode),
  });
}
