import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { MarketCode } from "@vakwen/domain";
import { MARKET_CODES } from "@vakwen/shared-types";
import { z } from "zod";
import { Env } from "@vakwen/config";
import type { AppInstance } from "../../app.js";
import type { Persistence } from "../../persistence/types.js";
import type { InstrumentCatalogProvider } from "./types.js";
import { RateLimitedError } from "./types.js";
import { runCatalogSync } from "./runCatalogSync.js";
import { enqueueDailyRefresh } from "./dailyRefreshEnqueue.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./registerBackfillWorker.js";
import { classifyProviderError } from "./backfillWorker.js";
import type { ProviderHealthService, ProviderId } from "./providerHealth.js";

export const CATALOG_SYNC_QUEUE = "catalog-sync";
/**
 * KZO-198: cron sourced from `Env.CATALOG_SYNC_CRON` (Tier 3, restart-required).
 * Default `"30 17 * * 1-5"` (weekdays 17:30 UTC, TW market close +30 min).
 */
export const CATALOG_SYNC_CRON = Env.CATALOG_SYNC_CRON;
const CATALOG_SYNC_QUEUE_OPTIONS = {
  ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
  policy: "singleton",
} as const;

/**
 * KZO-170 S6 — Catalog-sync job payload.
 *
 * Cron sends `{}` (no body); the handler treats `pendingMarkets === undefined` as
 * "sync every registered market." When `RateLimitedError` fires mid-iteration, the
 * handler reschedules itself with `pendingMarkets = remaining` (only the markets
 * NOT already completed) so the next run resumes from where it left off rather
 * than redoing completed work and re-hitting the rate limit.
 *
 * Schema parse runs BEFORE the surrounding `try` block per
 * `.claude/rules/typed-transient-error-catch-audit.md` Companion: the existing
 * catch path mutates state (daily-refresh enqueue, log lines), so a malformed
 * job must propagate straight to pg-boss without running side effects.
 */
export const CatalogSyncJobDataSchema = z.object({
  pendingMarkets: z.array(z.enum(MARKET_CODES)).optional(),
  providerOperationId: z.string().optional(),
});

export type CatalogSyncJobData = z.infer<typeof CatalogSyncJobDataSchema>;

/**
 * KZO-170 S6: literal-union form of `MarketCode` used inside the catalog-sync handler.
 * The repo's domain `MarketCode = string` is intentionally loose so future markets can
 * extend without ripple; here we want the Zod-validated literal union to flow through
 * `boss.send({ pendingMarkets })` against `CatalogSyncJobData`'s schema-derived shape.
 */
type StrictMarketCode = NonNullable<CatalogSyncJobData["pendingMarkets"]>[number];

export interface CatalogSyncWorkerDeps {
  boss: Pick<PgBoss, "send">;
  /** Per-market catalog registry. Replaces the `finmind` + `rateLimiter` deps (KZO-163). */
  catalogRegistry: Map<MarketCode, InstrumentCatalogProvider>;
  persistence: Pick<
    Persistence,
    | "upsertInstrumentCatalog"
    | "getAllMonitoredTickers"
    | "createRefreshBatch"
    // KZO-195 — admin notification fan-out on delisted>0 / guardTripped.
    | "listAdminUserIds"
    | "createNotification"
  > & Partial<Pick<Persistence, "getProviderOperation" | "updateProviderOperation" | "createProviderOperationLog">>;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  enqueueDailyRefreshFn?: typeof enqueueDailyRefresh;
  runCatalogSyncFn?: typeof runCatalogSync;
  /**
   * KZO-200 — provider health aggregator. Optional so memory-backed tests can
   * skip wiring it. When present, the catalog-sync handler records per-market
   * outcomes (success / rate_limit / error) against
   * `catalogProviderIdForMarket(market)`.
   */
  providerHealth?: ProviderHealthService;
}

/**
 * KZO-200 — map a market to the provider id used by the health aggregator
 * for catalog-sync outcomes. AU is owned by Twelve Data (KZO-194) — distinct
 * from `yahoo-finance-au`, which owns AU bars/dividends/metadata. TW + US
 * catalogs come from FinMind, sharing the same provider id as the bars path.
 */
export function catalogProviderIdForMarket(market: MarketCode): ProviderId {
  if (market === "AU") return "twelve-data-au";
  if (market === "KR") return "twelve-data-kr";
  if (market === "JP") return "twelve-data-jp";
  if (market === "US") return "finmind-us";
  return "finmind-tw";
}

export function createCatalogSyncHandler(deps: CatalogSyncWorkerDeps) {
  const { boss, catalogRegistry, persistence, log, providerHealth } = deps;
  const enqueueDailyRefreshFn = deps.enqueueDailyRefreshFn ?? enqueueDailyRefresh;
  const runCatalogSyncFn = deps.runCatalogSyncFn ?? runCatalogSync;

  async function logProviderOperation(
    providerOperationId: string | undefined,
    phase: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled",
    message: string,
    context: Record<string, unknown>,
    level: "info" | "warning" | "error" = "info",
  ): Promise<void> {
    if (!providerOperationId) return;
    if (!persistence.createProviderOperationLog) return;
    try {
      await persistence.createProviderOperationLog({
        operationId: providerOperationId,
        phase,
        level,
        message,
        context,
      });
    } catch (err) {
      log.warn({ err, providerOperationId }, "catalog_sync_provider_operation_log_failed");
    }
  }

  async function updateProviderOperation(
    providerOperationId: string | undefined,
    input: Omit<Parameters<Persistence["updateProviderOperation"]>[0], "id">,
  ): Promise<void> {
    if (!providerOperationId) return;
    if (!persistence.getProviderOperation || !persistence.updateProviderOperation) return;
    try {
      const current = await persistence.getProviderOperation(providerOperationId);
      await persistence.updateProviderOperation({
        id: providerOperationId,
        ...input,
        metadata: input.metadata
          ? { ...(current?.metadata ?? {}), ...input.metadata }
          : input.metadata,
      });
    } catch (err) {
      log.warn({ err, providerOperationId }, "catalog_sync_provider_operation_update_failed");
    }
  }

  async function shouldRunProviderOperation(providerOperationId: string | undefined): Promise<boolean> {
    if (!providerOperationId) return true;
    if (!persistence.getProviderOperation) return true;
    const operation = await persistence.getProviderOperation(providerOperationId);
    if (operation?.phase !== "paused" && operation?.phase !== "cancelled") return true;
    await logProviderOperation(
      providerOperationId,
      operation.phase,
      `catalog_sync_skipped provider=${operation.providerId} market=${operation.marketCode} phase=${operation.phase}`,
      { providerId: operation.providerId, marketCode: operation.marketCode },
      "warning",
    );
    return false;
  }

  // KZO-200: best-effort health record. Mirrors `safeRecordOutcome` in the
  // backfill worker — never throws into the caller's path because the
  // aggregator's own errors should not fail a successful sync.
  async function safeRecordOutcome(
    providerId: ProviderId,
    outcome: Parameters<ProviderHealthService["recordOutcome"]>[1],
  ): Promise<void> {
    if (!providerHealth) return;
    try {
      await providerHealth.recordOutcome(providerId, outcome);
    } catch (healthErr) {
      log.warn(
        { err: healthErr, providerId, outcomeKind: outcome.kind },
        "provider_health_record_outcome_failed",
      );
    }
  }

  return async ([job]: JobWithMetadata<unknown>[]): Promise<void> => {
    // KZO-170 S6: parse BEFORE the try block (per `typed-transient-error-catch-audit.md`
    // Companion). A malformed job must NOT trigger the daily-refresh enqueue side effect
    // in the `finally` clause — let the ZodError propagate straight to pg-boss.
    const parsed = CatalogSyncJobDataSchema.parse(job.data);
    const { providerOperationId } = parsed;

    // Resolve target markets. `undefined` (cron's `{}`) means every registered market.
    // An explicit `pendingMarkets: []` would mean "nothing to do" — handle as a clean no-op.
    // KZO-170 S6: locally narrow MarketCode to the literal union "TW"|"US"|"AU" so the
    // `satisfies CatalogSyncJobData` reschedule call below typechecks. The Zod schema
    // already enforces the runtime invariant; the cast is the bridge between the loose
    // `MarketCode = string` from `@vakwen/domain` and the strict shape the schema
    // produces.
    const registeredMarkets = [...catalogRegistry.keys()] as StrictMarketCode[];
    const targetMarkets: StrictMarketCode[] = parsed.pendingMarkets ?? registeredMarkets;

    let rescheduled = false;
    const completedMarkets: StrictMarketCode[] = [];
    // KZO-200: track which market was running when an exception fires so the
    // catch block can attribute the rate_limit / error outcome to the right
    // provider id. Markets completed before the failure are recorded inline.
    let activeMarket: StrictMarketCode | null = null;

    try {
      if (!(await shouldRunProviderOperation(providerOperationId))) return;
      await updateProviderOperation(providerOperationId, {
        phase: "running",
        startedAt: new Date().toISOString(),
        metadata: { progressPercent: 0, pendingMarkets: targetMarkets },
      });
      await logProviderOperation(
        providerOperationId,
        "running",
        `catalog_sync_started markets=${targetMarkets.join(",")}`,
        { pendingMarkets: targetMarkets },
      );
      for (const market of targetMarkets) {
        activeMarket = market;
        const catalogProvider = catalogRegistry.get(market);
        if (!catalogProvider) {
          // Skip markets that aren't registered (e.g. an in-flight job from a deploy that
          // referenced US before the US provider rolled out). Log + continue so we don't
          // wedge the entire sweep on a single missing provider.
          log.warn({ market }, "catalog_sync_skipped_unregistered_market");
          continue;
        }

        // KZO-163 HIGH-1 fix: pre-reserve 2 slots (catalog + delisting) per market to
        // prevent starvation under one-slot-at-a-time rate-limit replenishment.
        catalogProvider.reserveCapacity(2);
        const result = await runCatalogSyncFn({ catalogProvider, marketCode: market, persistence, log });
        completedMarkets.push(market);

        // KZO-195 (iter 9 / Codex P2) — admin notification fan-out.
        // `result.delisted` increments on BOTH the provider-feed path (TW)
        // AND the absence-detection path (AU). The two scenarios have different
        // operator stories:
        //   * Feed path: upstream provider explicitly published delisting
        //     records — the operator just needs the count.
        //   * Absence-detection path: the diff detector inferred the delisting
        //     from N consecutive absences. The operator should know it was
        //     detected (vs reported), and the candidate list is in
        //     `result.absentTickers`.
        // `result.absentTickers.length > 0` is the clean discriminator — it
        // is empty for the feed path (which never populates `absentTickers`)
        // and non-empty for the absence-detection path. Guard-tripped runs
        // also populate `absentTickers` but bypass `result.delisted > 0` (no
        // stamps applied).
        if (result.delisted > 0 || result.guardTripped) {
          try {
            const adminIds = await persistence.listAdminUserIds();
            const isAbsenceDetection = result.absentTickers.length > 0;
            const severity: "info" | "warning" = result.guardTripped ? "warning" : "info";
            const title = result.guardTripped
              ? `Mass-delisting guard tripped (${market})`
              : isAbsenceDetection
                ? `${result.delisted} ticker(s) auto-delisted (${market})`
                : `${result.delisted} ticker(s) marked delisted (provider feed, ${market})`;
            const body = result.guardTripped
              ? `Catalog sync flagged ${result.absent} candidates exceeding the safety ceiling. No streak bumps or stamps applied.`
              : isAbsenceDetection
                ? `Absence-based detection stamped ${result.delisted} ticker(s) delisted after consecutive absences from the catalog.`
                : `Provider feed reported ${result.delisted} ticker(s) as delisted this run.`;
            const detail = {
              marketCode: market,
              delisted: result.delisted,
              absent: result.absent,
              guardTripped: result.guardTripped,
              absentTickers: result.absentTickers.slice(0, 50),
            };
            await Promise.all(
              adminIds.map((userId) =>
                persistence
                  .createNotification({
                    userId,
                    severity,
                    source: "delisting_detector",
                    title,
                    body,
                    detail,
                  })
                  .catch((notifyErr: unknown) => {
                    log.warn({ err: notifyErr, userId, market }, "delisting_notification_create_failed");
                  }),
              ),
            );
          } catch (notifyErr) {
            log.warn({ err: notifyErr, market }, "delisting_notification_fanout_failed");
          }
        }
        // KZO-200: each market's catalog call lives on a distinct provider id
        // (TW/US → FinMind, AU → Twelve Data) — record successes per market
        // so the admin UI can show last_successful_run for each.
        await safeRecordOutcome(catalogProviderIdForMarket(market), { kind: "success" });
      }
      activeMarket = null;
      log.info({ completedMarkets }, "catalog_sync_completed");
      await updateProviderOperation(providerOperationId, {
        phase: "completed",
        completedAt: new Date().toISOString(),
        metadata: { progressPercent: 100, completedMarkets },
      });
      await logProviderOperation(
        providerOperationId,
        "completed",
        `catalog_sync_completed markets=${completedMarkets.join(",")}`,
        { completedMarkets },
      );
    } catch (error) {
      // KZO-170 S6: provider rate limit → reschedule with remaining markets only.
      // `completedMarkets` is the set we already processed before the error fired, so
      // the reschedule only re-runs the failed market + any unstarted markets.
      if (error instanceof RateLimitedError) {
        // KZO-200: record the rate_limit against the active market's provider id.
        if (activeMarket !== null) {
          await safeRecordOutcome(catalogProviderIdForMarket(activeMarket), {
            kind: "rate_limit",
            errorMessage: error.message,
          });
        }
        const delaySec = error.retryAfterSeconds;
        const remaining: StrictMarketCode[] = targetMarkets.filter((m) => !completedMarkets.includes(m));
        await updateProviderOperation(providerOperationId, {
          phase: "queued",
          metadata: {
            progressPercent: targetMarkets.length > 0 ? Math.round((completedMarkets.length / targetMarkets.length) * 100) : 100,
            completedMarkets,
            remainingMarkets: remaining,
            rateLimited: true,
            retryAfterSeconds: delaySec,
          },
        });
        await logProviderOperation(
          providerOperationId,
          "queued",
          `catalog_sync_rate_limited_rescheduled remaining=${remaining.join(",")} retry_after=${delaySec}`,
          { completedMarkets, remainingMarkets: remaining, retryAfterSeconds: delaySec },
          "warning",
        );
        log.info(
          { delaySec, completedMarkets, remaining },
          "catalog_sync_rate_limited: rescheduling per-market",
        );
        const id = await boss.send(
          CATALOG_SYNC_QUEUE,
          {
            pendingMarkets: remaining,
            ...(providerOperationId ? { providerOperationId } : {}),
          } satisfies CatalogSyncJobData,
          {
            startAfter: delaySec,
            singletonKey: CATALOG_SYNC_QUEUE,
            priority: 0,
          },
        );
        if (id === null) {
          log.warn(
            { delaySec, remaining },
            "catalog_sync_rate_limit_reschedule_dropped: existing singleton covers this work",
          );
        }
        rescheduled = true;
        return;
      }
      // KZO-200: non-rate-limit failure — attribute to the active market's
      // provider id with a best-effort error class.
      if (activeMarket !== null) {
        await safeRecordOutcome(catalogProviderIdForMarket(activeMarket), {
          kind: "error",
          errorClass: classifyProviderError(error),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      const terminal = job.retryCount >= job.retryLimit;
      await updateProviderOperation(providerOperationId, {
        phase: terminal ? "failed" : "running",
        completedAt: terminal ? new Date().toISOString() : null,
        metadata: {
          progressPercent: targetMarkets.length > 0 ? Math.round((completedMarkets.length / targetMarkets.length) * 100) : 0,
          completedMarkets,
          failedMarket: activeMarket,
          failureReason: error instanceof Error ? error.message : String(error),
          retryCount: job.retryCount,
          retryLimit: job.retryLimit,
        },
      });
      await logProviderOperation(
        providerOperationId,
        terminal ? "failed" : "running",
        `catalog_sync_${terminal ? "failed" : "attempt_failed"} market=${activeMarket ?? "unknown"} reason=${error instanceof Error ? error.message : String(error)}`,
        { completedMarkets, failedMarket: activeMarket, retryCount: job.retryCount, retryLimit: job.retryLimit },
        terminal ? "error" : "warning",
      );
      log.error({ error }, "catalog_sync_failed");
      throw error;
    } finally {
      // KZO-170 S6: enqueue the daily refresh in two cases:
      //   1. We did NOT reschedule (success path or non-rate-limit failure) — preserves
      //      the legacy "fire daily-refresh on generic error" semantics.
      //   2. We DID reschedule but at least one market completed before the rate-limit
      //      fired — those completed markets shouldn't have to wait for the rescheduled
      //      job to run before their tickers get refreshed.
      // The enqueue is market-agnostic (walks every monitored ticker the persistence
      // layer reports), so a single call covers all completed markets. Skip ONLY when
      // we rescheduled AND nothing completed first (the rescheduled job will own it).
      if (!rescheduled || completedMarkets.length > 0) {
        await enqueueDailyRefreshFn(boss, persistence, log);
      }
    }
  };
}

export async function registerCatalogSyncWorker(
  app: AppInstance,
  boss: PgBoss,
  deps: CatalogSyncWorkerDeps,
): Promise<void> {
  await boss.createQueue(CATALOG_SYNC_QUEUE, CATALOG_SYNC_QUEUE_OPTIONS);
  await boss.work(CATALOG_SYNC_QUEUE, { batchSize: 1, includeMetadata: true }, createCatalogSyncHandler(deps));
  app.log.info("catalog sync worker registered");
}
