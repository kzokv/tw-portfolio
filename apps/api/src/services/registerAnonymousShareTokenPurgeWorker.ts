import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { FastifyBaseLogger } from "fastify";
import type { AppInstance } from "../app.js";
import type { Persistence } from "../persistence/types.js";
import { Env } from "@vakwen/config";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./market-data/registerBackfillWorker.js";

export const ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE = "anonymous-share-token-purge";
/** KZO-198: schedule sourced from `Env.ANONYMOUS_SHARE_TOKEN_PURGE_CRON` (Tier 3, restart-required). */
export const ANONYMOUS_SHARE_TOKEN_PURGE_CRON = Env.ANONYMOUS_SHARE_TOKEN_PURGE_CRON;

const ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE_OPTIONS = {
  ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
  policy: "singleton",
} as const;

export interface AnonymousShareTokenPurgeDeps {
  persistence: Pick<Persistence, "purgeTerminalAnonymousShareTokens">;
  cutoffMs: number;
  log: FastifyBaseLogger;
}

export function createAnonymousShareTokenPurgeHandler(deps: AnonymousShareTokenPurgeDeps) {
  return async (_jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    try {
      const deleted = await deps.persistence.purgeTerminalAnonymousShareTokens(deps.cutoffMs);
      deps.log.info({ deleted, cutoffMs: deps.cutoffMs }, "anonymous_share_token_purge_completed");
    } catch (error) {
      deps.log.error({ error, cutoffMs: deps.cutoffMs }, "anonymous_share_token_purge_failed");
      throw error; // pg-boss retry
    }
  };
}

export async function registerAnonymousShareTokenPurgeWorker(
  app: AppInstance,
  boss: PgBoss,
  deps: AnonymousShareTokenPurgeDeps,
): Promise<void> {
  await boss.createQueue(ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE, ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE_OPTIONS);
  await boss.work(
    ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE,
    { batchSize: 1, includeMetadata: true },
    createAnonymousShareTokenPurgeHandler(deps),
  );
  app.log.info("anonymous share token purge worker registered");
}
