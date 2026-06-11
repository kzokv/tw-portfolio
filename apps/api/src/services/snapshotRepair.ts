import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { MarketCode } from "@vakwen/domain";
import { MARKET_CODES } from "@vakwen/shared-types";
import { z } from "zod";
import type { Persistence } from "../persistence/types.js";
import { recomputeSnapshotsForTicker } from "./snapshotGeneration.js";

export const SNAPSHOT_REPAIR_QUEUE = "holding-snapshot-repair";
export const SNAPSHOT_REPAIR_SCAN_QUEUE = "holding-snapshot-repair-scan";
export const SNAPSHOT_REPAIR_SCAN_CRON = "23 21 * * *";
export const DEFAULT_SNAPSHOT_REPAIR_SCAN_LIMIT = 50;
export const DEFAULT_SNAPSHOT_REPAIR_LOOKBACK_DAYS = 45;

export interface SnapshotRepairJobData {
  ticker: string;
  marketCode: MarketCode;
  fromDate: string;
  trigger: "user_selection" | "first_trade" | "retry" | "daily_refresh" | "repair" | "admin_rerun";
}

export const SnapshotRepairJobDataSchema = z.object({
  ticker: z.string(),
  marketCode: z.enum(MARKET_CODES),
  fromDate: z.string(),
  trigger: z.enum(["user_selection", "first_trade", "retry", "daily_refresh", "repair", "admin_rerun"]),
}) satisfies z.ZodType<SnapshotRepairJobData>;

export interface SnapshotRepairScanJobData {
  fromDate?: string;
  toDate?: string;
  limit?: number;
  trigger?: "repair" | "admin_rerun";
}

export const SnapshotRepairScanJobDataSchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  trigger: z.enum(["repair", "admin_rerun"]).optional(),
}) satisfies z.ZodType<SnapshotRepairScanJobData>;

export function getSnapshotRepairSingletonKey(input: Pick<SnapshotRepairJobData, "ticker" | "marketCode" | "fromDate">): string {
  return `${input.ticker}:${input.marketCode}:${input.fromDate}`;
}

export function defaultSnapshotRepairScanFromDate(now = new Date()): string {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - DEFAULT_SNAPSHOT_REPAIR_LOOKBACK_DAYS);
  return from.toISOString().slice(0, 10);
}

export function defaultSnapshotRepairScanToDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function createSnapshotRepairHandler(deps: {
  persistence: Pick<Persistence,
    "listHoldingSnapshotRepairScopesForTickerMarket"
    | "listHoldingSnapshotRepairTargets"
    | "getSnapshotGenerationInputs"
    | "deleteHoldingSnapshotsForTicker"
    | "getDailyBarsForTickerMarket"
    | "bulkUpsertHoldingSnapshots"
  >;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}) {
  return async (jobs: JobWithMetadata<SnapshotRepairJobData>[]): Promise<void> => {
    let failedJobs = 0;
    let totalFailedScopes = 0;

    for (const job of jobs) {
      const data = SnapshotRepairJobDataSchema.parse(job.data);
      const scopes = await deps.persistence.listHoldingSnapshotRepairScopesForTickerMarket(data.ticker, data.marketCode);
      let repairedScopes = 0;
      let failedScopes = 0;

      for (const scope of scopes) {
        try {
          await recomputeSnapshotsForTicker(
            scope.userId,
            scope.accountId,
            scope.ticker,
            data.fromDate,
            deps.persistence as Persistence,
            scope.marketCode,
          );
          repairedScopes++;
        } catch (error) {
          failedScopes++;
          deps.log.warn(
            {
              err: error,
              userId: scope.userId,
              accountId: scope.accountId,
              ticker: scope.ticker,
              marketCode: scope.marketCode,
              fromDate: data.fromDate,
            },
            "snapshot_repair_scope_failed",
          );
        }
      }

      deps.log.info(
        {
          ticker: data.ticker,
          marketCode: data.marketCode,
          fromDate: data.fromDate,
          trigger: data.trigger,
          scopes: scopes.length,
          repairedScopes,
          failedScopes,
        },
        "snapshot_repair_complete",
      );

      if (failedScopes > 0) {
        failedJobs++;
        totalFailedScopes += failedScopes;
      }
    }

    if (totalFailedScopes > 0) {
      throw new Error(`Snapshot repair failed for ${totalFailedScopes} scope(s) across ${failedJobs} job(s)`);
    }
  };
}

export function createSnapshotRepairScanHandler(deps: {
  persistence: Pick<Persistence, "listHoldingSnapshotRepairTargets">;
  boss: Pick<PgBoss, "send">;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  now?: () => Date;
}) {
  return async (jobs: JobWithMetadata<SnapshotRepairScanJobData>[]): Promise<void> => {
    for (const job of jobs) {
      const data = SnapshotRepairScanJobDataSchema.parse(job.data);
      const now = deps.now?.() ?? new Date();
      const fromDate = data.fromDate ?? defaultSnapshotRepairScanFromDate(now);
      const toDate = data.toDate ?? defaultSnapshotRepairScanToDate(now);
      const limit = data.limit ?? DEFAULT_SNAPSHOT_REPAIR_SCAN_LIMIT;
      const trigger = data.trigger ?? "repair";

      if (fromDate > toDate) {
        deps.log.warn({ fromDate, toDate, limit, trigger }, "snapshot_repair_scan_invalid_window");
        continue;
      }

      const targets = await deps.persistence.listHoldingSnapshotRepairTargets({ fromDate, toDate, limit });
      let enqueuedTargets = 0;
      let failedTargets = 0;

      for (const target of targets) {
        const payload: SnapshotRepairJobData = {
          ticker: target.ticker,
          marketCode: target.marketCode,
          fromDate: target.fromDate,
          trigger,
        };
        try {
          await deps.boss.send(SNAPSHOT_REPAIR_QUEUE, payload, {
            singletonKey: getSnapshotRepairSingletonKey(payload),
          });
          enqueuedTargets++;
        } catch (error) {
          failedTargets++;
          deps.log.warn(
            { err: error, target, trigger },
            "snapshot_repair_scan_enqueue_failed",
          );
        }
      }

      deps.log.info(
        {
          fromDate,
          toDate,
          limit,
          trigger,
          matchedTargets: targets.length,
          enqueuedTargets,
          failedTargets,
          repairableRows: targets.reduce((sum, target) => sum + target.repairableRows, 0),
        },
        "snapshot_repair_scan_complete",
      );
    }
  };
}

export async function registerSnapshotRepairWorker(
  boss: PgBoss,
  deps: Parameters<typeof createSnapshotRepairHandler>[0],
): Promise<void> {
  await boss.createQueue(SNAPSHOT_REPAIR_QUEUE, {
    policy: "stately",
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
  });
  await boss.work(SNAPSHOT_REPAIR_QUEUE, { batchSize: 1, includeMetadata: true }, createSnapshotRepairHandler(deps));
  await boss.createQueue(SNAPSHOT_REPAIR_SCAN_QUEUE, {
    policy: "stately",
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
  });
  await boss.work(
    SNAPSHOT_REPAIR_SCAN_QUEUE,
    { batchSize: 1, includeMetadata: true },
    createSnapshotRepairScanHandler({ persistence: deps.persistence, boss, log: deps.log }),
  );
  await boss.schedule(SNAPSHOT_REPAIR_SCAN_QUEUE, SNAPSHOT_REPAIR_SCAN_CRON, {
    limit: DEFAULT_SNAPSHOT_REPAIR_SCAN_LIMIT,
    trigger: "repair",
  } satisfies SnapshotRepairScanJobData);
  await boss.send(
    SNAPSHOT_REPAIR_SCAN_QUEUE,
    { limit: DEFAULT_SNAPSHOT_REPAIR_SCAN_LIMIT, trigger: "repair" } satisfies SnapshotRepairScanJobData,
    { singletonKey: "startup" },
  );
}
