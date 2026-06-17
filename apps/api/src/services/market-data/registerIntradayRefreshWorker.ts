import type { PgBoss } from "pg-boss";
import {
  buildIntradayRefreshQueueOptions,
  createIntradayRefreshHandler,
  INTRADAY_REFRESH_QUEUE,
  type IntradayRefreshWorkerConfig,
  type IntradayRefreshWorkerDeps,
} from "./intradayRefreshWorker.js";
import type { EffectiveTickerPriceFreshnessConfig } from "../appConfig/tickerPriceFreshness.js";

export function buildIntradayRefreshWorkerConfig(
  config: Pick<EffectiveTickerPriceFreshnessConfig, "queueConcurrency">,
): IntradayRefreshWorkerConfig {
  return {
    concurrency: config.queueConcurrency,
    maxRequestBudgetPerJob: 1,
    retryLimit: 20,
    retryDelaySeconds: 30,
    retryBackoff: true,
    expireInSeconds: 10 * 60,
  };
}

export async function registerIntradayRefreshWorker(
  boss: PgBoss,
  config: IntradayRefreshWorkerConfig,
  deps: IntradayRefreshWorkerDeps,
): Promise<void> {
  await boss.createQueue(INTRADAY_REFRESH_QUEUE, buildIntradayRefreshQueueOptions(config));
  await boss.work(
    INTRADAY_REFRESH_QUEUE,
    { batchSize: 1, includeMetadata: true, teamSize: config.concurrency } as never,
    createIntradayRefreshHandler(deps),
  );
}
