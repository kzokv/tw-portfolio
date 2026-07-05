import type { PgBoss } from "pg-boss";
import type { EffectiveTickerPriceFreshnessConfig } from "../appConfig/tickerPriceFreshness.js";
import {
  buildQuoteFallbackRefreshQueueOptions,
  createQuoteFallbackRefreshHandler,
  QUOTE_FALLBACK_REFRESH_QUEUE,
  QUOTE_FALLBACK_REFRESH_SCHEDULE_CRON,
  type QuoteFallbackRefreshWorkerConfig,
  type QuoteFallbackRefreshWorkerDeps,
} from "./quoteFallbackRefreshWorker.js";

export function buildQuoteFallbackRefreshWorkerConfig(
  config: Pick<EffectiveTickerPriceFreshnessConfig, "queueConcurrency">,
): QuoteFallbackRefreshWorkerConfig {
  return {
    concurrency: config.queueConcurrency,
    retryLimit: 5,
    retryDelaySeconds: 60,
    retryBackoff: true,
    expireInSeconds: 30 * 60,
  };
}

export async function registerQuoteFallbackRefreshWorker(
  boss: PgBoss,
  config: QuoteFallbackRefreshWorkerConfig,
  deps: QuoteFallbackRefreshWorkerDeps,
): Promise<void> {
  await boss.createQueue(QUOTE_FALLBACK_REFRESH_QUEUE, buildQuoteFallbackRefreshQueueOptions(config));
  await boss.work(
    QUOTE_FALLBACK_REFRESH_QUEUE,
    { batchSize: 1, includeMetadata: true, teamSize: config.concurrency } as never,
    createQuoteFallbackRefreshHandler(deps),
  );
  await boss.schedule(QUOTE_FALLBACK_REFRESH_QUEUE, QUOTE_FALLBACK_REFRESH_SCHEDULE_CRON, { kind: "scheduled_scan" });
}
