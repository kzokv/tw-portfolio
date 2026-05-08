import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { MarketCode } from "@tw-portfolio/domain";
import { z } from "zod";
import { Env } from "@tw-portfolio/config";
import type { AppInstance } from "../../app.js";
import type { Persistence } from "../../persistence/types.js";
import type { InstrumentCatalogProvider } from "./types.js";
import { RateLimitedError } from "./types.js";
import { runCatalogSync } from "./runCatalogSync.js";
import { enqueueDailyRefresh } from "./dailyRefreshEnqueue.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./registerBackfillWorker.js";

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
  pendingMarkets: z.array(z.enum(["TW", "US", "AU"])).optional(),
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
  persistence: Pick<Persistence, "upsertInstrumentCatalog" | "getAllMonitoredTickers" | "createRefreshBatch">;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  enqueueDailyRefreshFn?: typeof enqueueDailyRefresh;
  runCatalogSyncFn?: typeof runCatalogSync;
}

export function createCatalogSyncHandler(deps: CatalogSyncWorkerDeps) {
  const { boss, catalogRegistry, persistence, log } = deps;
  const enqueueDailyRefreshFn = deps.enqueueDailyRefreshFn ?? enqueueDailyRefresh;
  const runCatalogSyncFn = deps.runCatalogSyncFn ?? runCatalogSync;

  return async ([job]: JobWithMetadata<unknown>[]): Promise<void> => {
    // KZO-170 S6: parse BEFORE the try block (per `typed-transient-error-catch-audit.md`
    // Companion). A malformed job must NOT trigger the daily-refresh enqueue side effect
    // in the `finally` clause — let the ZodError propagate straight to pg-boss.
    const parsed = CatalogSyncJobDataSchema.parse(job.data);

    // Resolve target markets. `undefined` (cron's `{}`) means every registered market.
    // An explicit `pendingMarkets: []` would mean "nothing to do" — handle as a clean no-op.
    // KZO-170 S6: locally narrow MarketCode to the literal union "TW"|"US"|"AU" so the
    // `satisfies CatalogSyncJobData` reschedule call below typechecks. The Zod schema
    // already enforces the runtime invariant; the cast is the bridge between the loose
    // `MarketCode = string` from `@tw-portfolio/domain` and the strict shape the schema
    // produces.
    const registeredMarkets = [...catalogRegistry.keys()] as StrictMarketCode[];
    const targetMarkets: StrictMarketCode[] = parsed.pendingMarkets ?? registeredMarkets;

    let rescheduled = false;
    const completedMarkets: StrictMarketCode[] = [];

    try {
      for (const market of targetMarkets) {
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
        await runCatalogSyncFn({ catalogProvider, marketCode: market, persistence, log });
        completedMarkets.push(market);
      }
      log.info({ completedMarkets }, "catalog_sync_completed");
    } catch (error) {
      // KZO-170 S6: provider rate limit → reschedule with remaining markets only.
      // `completedMarkets` is the set we already processed before the error fired, so
      // the reschedule only re-runs the failed market + any unstarted markets.
      if (error instanceof RateLimitedError) {
        const delaySec = error.retryAfterSeconds;
        const remaining: StrictMarketCode[] = targetMarkets.filter((m) => !completedMarkets.includes(m));
        log.info(
          { delaySec, completedMarkets, remaining },
          "catalog_sync_rate_limited: rescheduling per-market",
        );
        const id = await boss.send(
          CATALOG_SYNC_QUEUE,
          { pendingMarkets: remaining } satisfies CatalogSyncJobData,
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
