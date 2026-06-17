import type { DailyBar, MarketCode } from "@vakwen/domain";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import { runCloseRefresh, type RunCloseRefreshInput } from "./closeRefreshService.js";

export const CLOSE_REFRESH_QUEUE = "ticker-close-refresh";
export const CLOSE_REFRESH_SCHEDULE_CRON = "*/30 * * * *";

export interface CloseRefreshTickerJobData {
  kind?: "ticker";
  ticker: string;
  marketCode: MarketCode;
  requestedAt: string;
}

export interface CloseRefreshScheduledScanJobData {
  kind: "scheduled_scan";
  requestedAt?: string;
}

export type CloseRefreshJobData = CloseRefreshTickerJobData | CloseRefreshScheduledScanJobData;

export interface CloseRefreshWorkerConfig {
  concurrency: number;
  retryLimit: number;
  retryDelaySeconds: number;
  retryBackoff: boolean;
  expireInSeconds: number;
}

export interface CloseRefreshWorkerDeps extends Omit<RunCloseRefreshInput, "pairs" | "now" | "persistence"> {
  boss?: Pick<PgBoss, "send">;
  persistence: RunCloseRefreshInput["persistence"] & Partial<Pick<Persistence, "listHeldTickerMarketPairs">>;
  log: NonNullable<RunCloseRefreshInput["log"]>;
}

export function closeRefreshSingletonKey(ticker: string, marketCode: MarketCode): string {
  return `${CLOSE_REFRESH_QUEUE}:${marketCode}:${ticker}`;
}

export function buildCloseRefreshQueueOptions(config: CloseRefreshWorkerConfig) {
  return {
    policy: "stately",
    retryLimit: config.retryLimit,
    retryDelay: config.retryDelaySeconds,
    retryBackoff: config.retryBackoff,
    expireInSeconds: config.expireInSeconds,
  } as const;
}

export function createCloseRefreshHandler(deps: CloseRefreshWorkerDeps) {
  return async (jobs: ReadonlyArray<JobWithMetadata<CloseRefreshJobData>>) => {
    for (const job of jobs) {
      const data = job.data;
      if (data?.kind === "scheduled_scan") {
        await enqueueScheduledCloseRefreshes({
          boss: deps.boss ?? null,
          persistence: deps.persistence,
          requestedAt: data.requestedAt,
          supportedMarkets: deps.supportedMarkets,
          log: deps.log,
        });
        continue;
      }
      if (!data?.ticker || !data.marketCode) {
        throw new Error("close_refresh_job_invalid");
      }
      deps.log.info(
        { ticker: data.ticker, marketCode: data.marketCode, jobId: job.id },
        "close_refresh_started",
      );
      const result = await runCloseRefresh({
        ...deps,
        pairs: [{ ticker: data.ticker, marketCode: data.marketCode }],
        now: parseRequestedAt(data.requestedAt),
      });
      deps.log.info(
        {
          ticker: data.ticker,
          marketCode: data.marketCode,
          jobId: job.id,
          summary: result.summary,
        },
        "close_refresh_worker_completed",
      );
    }
  };
}

function parseRequestedAt(requestedAt: string): Date {
  const parsed = new Date(requestedAt);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export async function enqueueScheduledCloseRefreshes(input: {
  boss: Pick<PgBoss, "send"> | null;
  persistence: Partial<Pick<Persistence, "listHeldTickerMarketPairs">>;
  requestedAt?: string;
  supportedMarkets: ReadonlyArray<MarketCode>;
  log: NonNullable<RunCloseRefreshInput["log"]>;
}): Promise<{ pairCount: number; enqueuedCount: number; droppedCount: number }> {
  if (!input.boss) {
    input.log.warn({}, "close_refresh_scheduled_scan_queue_unavailable");
    return { pairCount: 0, enqueuedCount: 0, droppedCount: 0 };
  }
  if (!input.persistence.listHeldTickerMarketPairs) {
    input.log.warn({}, "close_refresh_scheduled_scan_missing_persistence_method");
    return { pairCount: 0, enqueuedCount: 0, droppedCount: 0 };
  }

  const supportedMarkets = new Set<MarketCode>(input.supportedMarkets);
  const requestedAt = parseRequestedAt(input.requestedAt ?? new Date().toISOString()).toISOString();
  const pairs = (await input.persistence.listHeldTickerMarketPairs())
    .filter((pair): pair is { ticker: string; marketCode: MarketCode } =>
      supportedMarkets.has(pair.marketCode as MarketCode));
  let enqueuedCount = 0;
  let droppedCount = 0;
  for (const pair of pairs) {
    const jobId = await enqueueCloseRefresh(input.boss, {
      ticker: pair.ticker,
      marketCode: pair.marketCode,
      requestedAt,
    });
    if (jobId) enqueuedCount += 1;
    else droppedCount += 1;
  }
  input.log.info(
    { pairCount: pairs.length, enqueuedCount, droppedCount },
    "close_refresh_scheduled_scan_enqueued",
  );
  return { pairCount: pairs.length, enqueuedCount, droppedCount };
}

export async function enqueueCloseRefresh(
  boss: Pick<PgBoss, "send"> | null,
  data: CloseRefreshTickerJobData,
): Promise<string | null> {
  if (!boss) return null;
  return await boss.send(CLOSE_REFRESH_QUEUE, data, {
    singletonKey: closeRefreshSingletonKey(data.ticker, data.marketCode),
  });
}

export function toDailyBarUpsertRows(bars: DailyBar[], marketCode: MarketCode) {
  return bars.map((bar) => ({
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
  }));
}
