import type { PgBoss } from "pg-boss";
import type { EffectiveTickerPriceFreshnessConfig } from "../appConfig/tickerPriceFreshness.js";
import {
  buildCloseRefreshQueueOptions,
  CLOSE_REFRESH_QUEUE,
  CLOSE_REFRESH_SCHEDULE_CRON,
  createCloseRefreshHandler,
  type CloseRefreshWorkerConfig,
  type CloseRefreshWorkerDeps,
} from "./closeRefreshWorker.js";

export function buildCloseRefreshWorkerConfig(
  config: Pick<EffectiveTickerPriceFreshnessConfig, "queueConcurrency">,
): CloseRefreshWorkerConfig {
  return {
    concurrency: config.queueConcurrency,
    retryLimit: 5,
    retryDelaySeconds: 60,
    retryBackoff: true,
    expireInSeconds: 30 * 60,
  };
}

export async function registerCloseRefreshWorker(
  boss: PgBoss,
  config: CloseRefreshWorkerConfig,
  deps: CloseRefreshWorkerDeps,
): Promise<void> {
  await boss.createQueue(CLOSE_REFRESH_QUEUE, buildCloseRefreshQueueOptions(config));
  await boss.work(
    CLOSE_REFRESH_QUEUE,
    { batchSize: 1, includeMetadata: true, teamSize: config.concurrency } as never,
    createCloseRefreshHandler(deps),
  );
  await boss.schedule(CLOSE_REFRESH_QUEUE, CLOSE_REFRESH_SCHEDULE_CRON, { kind: "scheduled_scan" });
}
