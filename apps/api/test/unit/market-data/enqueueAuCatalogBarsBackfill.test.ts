/**
 * KZO-197 — Unit tests for `enqueueAuCatalogBarsBackfill`.
 *
 * Helper signature (per architect-design.md):
 *   enqueueAuCatalogBarsBackfill(
 *     boss: Pick<PgBoss, "send"> | null,
 *     persistence: Pick<Persistence, "listAuCatalogBarsBackfillCandidates">,
 *     log: { info: (...args: unknown[]) => void },
 *     opts: { trigger: BackfillJobData["trigger"] },
 *   ) => Promise<{ tickerCount: number; batchId: string | null }>
 *
 * Coverage:
 *   - Reads candidates via `persistence.listAuCatalogBarsBackfillCandidates()`.
 *   - For each candidate, `boss.send(BACKFILL_QUEUE, payload, options)`:
 *     • payload omits `startDate` (worker resolves `historyStartFor("AU")`).
 *     • payload includes `marketCode: "AU"`, the supplied `trigger`, a
 *       generated `batchId`, and `includeBars: true` + `includeDividends: true`.
 *     • options includes composite singleton key `${ticker}:AU` per
 *       `pgboss-composite-singleton-key.md`.
 *     • options includes the live priority via `getEffectiveDailyRefreshPriority()`.
 *   - Memory-backend short-circuit: when `boss === null` the helper returns
 *     `{tickerCount:0, batchId:null}` and never calls `boss.send`.
 *   - Empty-candidates short-circuit: returns `{tickerCount:0, batchId:null}`
 *     and never calls `boss.send`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKFILL_QUEUE } from "../../../src/services/market-data/backfillWorker.js";
import { enqueueAuCatalogBarsBackfill } from "../../../src/services/market-data/enqueueAuCatalogBarsBackfill.js";
import { Env } from "@vakwen/config";

describe("enqueueAuCatalogBarsBackfill (KZO-197)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enqueues one full-history catalog warm-up job per AU candidate", async () => {
    vi.setSystemTime(new Date("2026-05-09T09:30:00Z"));
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const persistence = {
      listAuCatalogBarsBackfillCandidates: vi.fn().mockResolvedValue([
        { ticker: "AUWARM01", marketCode: "AU" as const },
        { ticker: "AUWARM02", marketCode: "AU" as const },
      ]),
      createRefreshBatch: vi.fn().mockResolvedValue("batch-au-001"),
    };
    const log = { info: vi.fn() };

    const result = await enqueueAuCatalogBarsBackfill(boss, persistence, log, {
      trigger: "admin_rerun",
    });

    expect(result.tickerCount).toBe(2);
    // batchId is a non-empty string returned by createRefreshBatch.
    expect(typeof result.batchId).toBe("string");
    expect((result.batchId ?? "").length).toBeGreaterThan(0);
    expect(persistence.listAuCatalogBarsBackfillCandidates).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenCalledTimes(2);

    // First call — payload omits startDate; composite singleton key.
    const [queue1, payload1, opts1] = boss.send.mock.calls[0]!;
    expect(queue1).toBe(BACKFILL_QUEUE);
    expect(payload1).toMatchObject({
      ticker: "AUWARM01",
      marketCode: "AU",
      trigger: "admin_rerun",
      batchId: result.batchId,
      includeBars: true,
      includeDividends: true,
    });
    // Critical: NO startDate — worker resolves to historyStartFor("AU").
    expect(payload1).not.toHaveProperty("startDate");
    expect(opts1).toMatchObject({ singletonKey: "AUWARM01:AU" });
    expect(opts1).toHaveProperty("priority");

    const [, payload2, opts2] = boss.send.mock.calls[1]!;
    expect(payload2).toMatchObject({
      ticker: "AUWARM02",
      marketCode: "AU",
      trigger: "admin_rerun",
      batchId: result.batchId,
    });
    expect(payload2).not.toHaveProperty("startDate");
    expect(opts2).toMatchObject({ singletonKey: "AUWARM02:AU" });
  });

  it("uses the live daily-refresh priority resolver for queue options", async () => {
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const persistence = {
      listAuCatalogBarsBackfillCandidates: vi.fn().mockResolvedValue([
        { ticker: "AUWARM01", marketCode: "AU" as const },
      ]),
      createRefreshBatch: vi.fn().mockResolvedValue("b"),
    };
    const log = { info: vi.fn() };

    await enqueueAuCatalogBarsBackfill(boss, persistence, log, {
      trigger: "admin_rerun",
    });

    const [, , opts] = boss.send.mock.calls[0]!;
    // Priority defaults to env value (cache empty in this test).
    expect((opts as { priority: number }).priority).toBe(Env.DAILY_REFRESH_PRIORITY);
  });

  it("returns no-op shape and skips dispatch when boss is null (memory backend)", async () => {
    const persistence = {
      listAuCatalogBarsBackfillCandidates: vi.fn().mockResolvedValue([
        { ticker: "AUWARM01", marketCode: "AU" as const },
        { ticker: "AUWARM02", marketCode: "AU" as const },
      ]),
      createRefreshBatch: vi.fn().mockResolvedValue("b"),
    };
    const log = { info: vi.fn() };

    const result = await enqueueAuCatalogBarsBackfill(null, persistence, log, {
      trigger: "admin_rerun",
    });

    expect(result).toEqual({ tickerCount: 0, batchId: null });
  });

  it("returns no-op shape when there are zero AU candidates", async () => {
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const persistence = {
      listAuCatalogBarsBackfillCandidates: vi.fn().mockResolvedValue([]),
      createRefreshBatch: vi.fn().mockResolvedValue("b"),
    };
    const log = { info: vi.fn() };

    const result = await enqueueAuCatalogBarsBackfill(boss, persistence, log, {
      trigger: "admin_rerun",
    });

    expect(result).toEqual({ tickerCount: 0, batchId: null });
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("uses the generic market candidate query for KR catalog warm-up", async () => {
    const boss = { send: vi.fn().mockResolvedValue("job-kr-1") };
    const persistence = {
      listAuCatalogBarsBackfillCandidates: vi.fn().mockResolvedValue([
        { ticker: "AUWARM01", marketCode: "AU" as const },
      ]),
      listCatalogBarsBackfillCandidates: vi.fn().mockResolvedValue([
        { ticker: "005930", marketCode: "KR" as const },
      ]),
      createRefreshBatch: vi.fn().mockResolvedValue("batch-kr-001"),
    };
    const log = { info: vi.fn() };

    const result = await enqueueAuCatalogBarsBackfill(boss, persistence, log, {
      trigger: "admin_rerun",
      marketCode: "KR",
      resolverMode: "quote_first",
    });

    expect(result.tickerCount).toBe(1);
    expect(persistence.listAuCatalogBarsBackfillCandidates).not.toHaveBeenCalled();
    expect(persistence.listCatalogBarsBackfillCandidates).toHaveBeenCalledWith("KR");
    expect(boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      expect.objectContaining({
        ticker: "005930",
        marketCode: "KR",
        resolverMode: "quote_first",
        batchId: "batch-kr-001",
      }),
      expect.objectContaining({ singletonKey: "005930:KR" }),
    );
  });

  it("rejects non-AU warm-up when the generic market candidate query is unavailable", async () => {
    const boss = { send: vi.fn().mockResolvedValue("job-kr-1") };
    const persistence = {
      listAuCatalogBarsBackfillCandidates: vi.fn().mockResolvedValue([
        { ticker: "AUWARM01", marketCode: "AU" as const },
      ]),
      createRefreshBatch: vi.fn().mockResolvedValue("batch-kr-001"),
    };
    const log = { info: vi.fn() };

    await expect(
      enqueueAuCatalogBarsBackfill(boss, persistence, log, {
        trigger: "admin_rerun",
        marketCode: "KR",
      }),
    ).rejects.toThrow(/listCatalogBarsBackfillCandidates/);
    expect(persistence.listAuCatalogBarsBackfillCandidates).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("composite singleton key keeps cross-listed AU rows in distinct slots", async () => {
    // KZO-185 — singleton-key collision class. The composite `${ticker}:AU`
    // format prevents accidental collapse if a future ticket adds non-AU
    // pairs into the same warm-up path.
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const persistence = {
      listAuCatalogBarsBackfillCandidates: vi.fn().mockResolvedValue([
        { ticker: "BHP", marketCode: "AU" as const },
        { ticker: "RIO", marketCode: "AU" as const },
      ]),
      createRefreshBatch: vi.fn().mockResolvedValue("b"),
    };
    const log = { info: vi.fn() };

    await enqueueAuCatalogBarsBackfill(boss, persistence, log, {
      trigger: "admin_rerun",
    });

    expect(boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      expect.objectContaining({ ticker: "BHP", marketCode: "AU" }),
      expect.objectContaining({ singletonKey: "BHP:AU" }),
    );
    expect(boss.send).toHaveBeenCalledWith(
      BACKFILL_QUEUE,
      expect.objectContaining({ ticker: "RIO", marketCode: "AU" }),
      expect.objectContaining({ singletonKey: "RIO:AU" }),
    );
  });
});
