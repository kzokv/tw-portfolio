import type { PgBoss } from "pg-boss";
import type { AppInstance } from "../../app.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./registerBackfillWorker.js";
import { FX_REFRESH_QUEUE, createFxRefreshHandler, type FxRefreshWorkerDeps } from "./fxRefreshWorker.js";

const FX_REFRESH_QUEUE_OPTIONS = {
  ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
  policy: "singleton",
} as const;

export async function registerFxRefreshWorker(
  app: AppInstance,
  boss: PgBoss,
  deps: FxRefreshWorkerDeps,
): Promise<void> {
  await boss.createQueue(FX_REFRESH_QUEUE, FX_REFRESH_QUEUE_OPTIONS);
  await boss.work(FX_REFRESH_QUEUE, { batchSize: 1, includeMetadata: true }, createFxRefreshHandler(deps));
  app.log.info("fx refresh worker registered");
}
