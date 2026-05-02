/**
 * KZO-170 (D12) — Per-market catalog sync reschedule via `pendingMarkets`.
 *
 * The catalog sync handler now iterates `catalogRegistry.entries()` driven by a
 * `{ pendingMarkets?: MarketCode[] }` Zod-parsed payload. The per-market loop
 * body is wrapped in try/catch — when one market throws `RateLimitedError` the
 * worker re-enqueues a job with the rate-limited markets only, and the daily
 * refresh enqueues for the **completed** markets immediately.
 *
 * Pattern mirrors `apps/api/test/unit/catalog-sync-worker.test.ts` (the legacy
 * KZO-163 test surface) extended to the per-market shape.
 *
 * Per scope-todo G-NC-3 + `.claude/rules/typed-transient-error-catch-audit.md`
 * Companion: the Zod parse runs BEFORE the surrounding try block — malformed
 * `job.data` (`pendingMarkets` containing an invalid market code) throws
 * `ZodError` straight to pg-boss, no side effects.
 */

import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { JobWithMetadata } from "pg-boss";
import { createCatalogSyncHandler, CATALOG_SYNC_QUEUE } from "../../src/services/market-data/registerCatalogSyncWorker.js";
import { RateLimitedError } from "../../src/services/market-data/types.js";

function createJob(data: Record<string, unknown> = {}): JobWithMetadata<unknown> {
  return {
    data,
    retryCount: 0,
    retryLimit: 3,
  } as unknown as JobWithMetadata<unknown>;
}

function createProvider() {
  return {
    reserveCapacity: vi.fn(),
    fetchInstrumentCatalog: vi.fn(),
    fetchDelistingHistory: vi.fn(),
  };
}

function createDeps() {
  const boss = { send: vi.fn().mockResolvedValue("job-id") };
  const twProvider = createProvider();
  const usProvider = createProvider();
  const catalogRegistry = new Map([
    ["TW", twProvider],
    ["US", usProvider],
  ]);
  const persistence = {
    upsertInstrumentCatalog: vi.fn(),
    getAllMonitoredTickers: vi.fn().mockResolvedValue([]),
    createRefreshBatch: vi.fn(),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { boss, twProvider, usProvider, catalogRegistry, persistence, log };
}

describe("catalog sync per-market reschedule (KZO-170 D12)", () => {
  // ── Happy path: empty body / cron-shaped invocation ─────────────────────────

  it("runs for ALL markets (no pendingMarkets) when payload is the cron-default empty object", async () => {
    const deps = createDeps();
    const runCatalogSyncFn = vi.fn().mockResolvedValue({ upserted: 1, delisted: 0 });
    const enqueueDailyRefreshFn = vi.fn().mockResolvedValue(0);

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    await handler([createJob({})]);

    // runCatalogSync called once per market in the registry (TW + US = 2 calls).
    expect(runCatalogSyncFn).toHaveBeenCalledTimes(2);
    // Daily refresh enqueue runs once at the end (completed both markets).
    expect(enqueueDailyRefreshFn).toHaveBeenCalledTimes(1);
    // No reschedule.
    expect(deps.boss.send).not.toHaveBeenCalled();
  });

  // ── Subset reschedule path: only the rate-limited markets re-enqueue ────────

  it("reschedules only the rate-limited US market when TW completes and US throws RateLimitedError", async () => {
    const deps = createDeps();
    // TW succeeds, US throws — runCatalogSyncFn drives both via the catalogProvider arg.
    const runCatalogSyncFn = vi.fn().mockImplementation(async ({ catalogProvider }) => {
      if (catalogProvider === deps.usProvider) {
        throw new RateLimitedError({ msUntilAvailable: 60_000 });
      }
      return { upserted: 1, delisted: 0 };
    });
    const enqueueDailyRefreshFn = vi.fn().mockResolvedValue(0);

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    await handler([createJob({})]);

    // Reschedule sent with only the US market in pendingMarkets, ceil(60_000/1000)=60.
    expect(deps.boss.send).toHaveBeenCalledWith(
      CATALOG_SYNC_QUEUE,
      { pendingMarkets: ["US"] },
      expect.objectContaining({ startAfter: 60, singletonKey: CATALOG_SYNC_QUEUE }),
    );
    // Daily refresh STILL fires for the completed (TW) markets — completed work
    // shouldn't wait on the rate-limited market to recover.
    expect(enqueueDailyRefreshFn).toHaveBeenCalledTimes(1);
  });

  // ── Subset reschedule from a previous reschedule's payload ──────────────────

  it("processes only US when the job payload says pendingMarkets=['US']", async () => {
    const deps = createDeps();
    const runCatalogSyncFn = vi.fn().mockResolvedValue({ upserted: 1, delisted: 0 });
    const enqueueDailyRefreshFn = vi.fn().mockResolvedValue(0);

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    await handler([createJob({ pendingMarkets: ["US"] })]);

    // Only the US provider was consulted; TW skipped because not in pendingMarkets.
    expect(runCatalogSyncFn).toHaveBeenCalledTimes(1);
    expect(runCatalogSyncFn).toHaveBeenCalledWith(
      expect.objectContaining({ catalogProvider: deps.usProvider }),
    );
    // No reschedule (US succeeded), daily refresh fires.
    expect(deps.boss.send).not.toHaveBeenCalled();
    expect(enqueueDailyRefreshFn).toHaveBeenCalledTimes(1);
  });

  // ── Both markets rate-limited → reschedule with both in payload ─────────────

  it("reschedules both markets when both throw RateLimitedError", async () => {
    const deps = createDeps();
    // Each provider throws with its own msUntilAvailable; reschedule should
    // pick the larger (or earlier — the contract is "wait long enough"; either
    // implementation choice should produce a finite startAfter ≥ both delays).
    const runCatalogSyncFn = vi.fn().mockImplementation(async ({ catalogProvider }) => {
      if (catalogProvider === deps.twProvider) {
        throw new RateLimitedError({ msUntilAvailable: 30_000 });
      }
      throw new RateLimitedError({ msUntilAvailable: 90_000 });
    });
    const enqueueDailyRefreshFn = vi.fn().mockResolvedValue(0);

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    await handler([createJob({})]);

    // Reschedule includes both markets (order may vary by registry iteration).
    expect(deps.boss.send).toHaveBeenCalledTimes(1);
    const sendCall = deps.boss.send.mock.calls[0]!;
    expect(sendCall[0]).toBe(CATALOG_SYNC_QUEUE);
    const payload = sendCall[1] as { pendingMarkets: string[] };
    expect(payload.pendingMarkets.sort()).toEqual(["TW", "US"]);
    const opts = sendCall[2] as { startAfter: number; singletonKey: string };
    expect(opts.startAfter).toBeGreaterThanOrEqual(30);
    expect(opts.singletonKey).toBe(CATALOG_SYNC_QUEUE);

    // Daily refresh skipped — no completed markets.
    expect(enqueueDailyRefreshFn).not.toHaveBeenCalled();
  });

  // ── Zod parse precedes try block (typed-transient-error-catch-audit Companion) ─

  it("rejects malformed pendingMarkets with ZodError before any side effects", async () => {
    const deps = createDeps();
    const runCatalogSyncFn = vi.fn();
    const enqueueDailyRefreshFn = vi.fn();

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    // Invalid market code in pendingMarkets — Zod parse must throw.
    await expect(handler([createJob({ pendingMarkets: ["JP"] })])).rejects.toThrow(ZodError);

    // No side effects: provider not consulted, no reschedule, no refresh enqueue.
    expect(runCatalogSyncFn).not.toHaveBeenCalled();
    expect(enqueueDailyRefreshFn).not.toHaveBeenCalled();
    expect(deps.boss.send).not.toHaveBeenCalled();
  });

  // ── Non-rate-limit error from one market still propagates / does not reschedule ─

  it("non-rate-limit error from one market propagates and does not reschedule", async () => {
    const deps = createDeps();
    // TW throws a generic Error — handler must surface it for pg-boss retry.
    const runCatalogSyncFn = vi.fn().mockImplementation(async ({ catalogProvider }) => {
      if (catalogProvider === deps.twProvider) {
        throw new Error("provider exploded");
      }
      return { upserted: 1, delisted: 0 };
    });
    const enqueueDailyRefreshFn = vi.fn().mockResolvedValue(0);

    const handler = createCatalogSyncHandler({
      boss: deps.boss,
      catalogRegistry: deps.catalogRegistry as never,
      persistence: deps.persistence,
      log: deps.log,
      runCatalogSyncFn,
      enqueueDailyRefreshFn,
    });

    await expect(handler([createJob({})])).rejects.toThrow("provider exploded");

    // No reschedule via boss.send for non-rate-limit errors — pg-boss handles retry.
    expect(deps.boss.send).not.toHaveBeenCalled();
  });
});
