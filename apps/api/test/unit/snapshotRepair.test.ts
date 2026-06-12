import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import type { DailyBar } from "@vakwen/domain";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import {
  createSnapshotRepairHandler,
  createSnapshotRepairScanHandler,
  DEFAULT_SNAPSHOT_REPAIR_SCAN_LIMIT,
  SNAPSHOT_REPAIR_QUEUE,
  type SnapshotRepairJobData,
  type SnapshotRepairScanJobData,
} from "../../src/services/snapshotRepair.js";

function createRepairJob(data: SnapshotRepairJobData): JobWithMetadata<SnapshotRepairJobData> {
  return { data } as JobWithMetadata<SnapshotRepairJobData>;
}

function createScanJob(data: SnapshotRepairScanJobData): JobWithMetadata<SnapshotRepairScanJobData> {
  return { data } as JobWithMetadata<SnapshotRepairScanJobData>;
}

function makeBar(date: string, close: number): DailyBar {
  return {
    ticker: "2330",
    barDate: date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
    source: "test",
    ingestedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
  };
}

describe("snapshot repair worker", () => {
  it("recomputes each matched scope from the repair date using the scoped market persistence", async () => {
    const persistence = {
      listHoldingSnapshotRepairScopesForTickerMarket: vi.fn().mockResolvedValue([
        { userId: "user-1", accountId: "acc-1", ticker: "2330", marketCode: "TW" },
      ]),
      listHoldingSnapshotRepairTargets: vi.fn(),
      getSnapshotGenerationInputs: vi.fn().mockResolvedValue({
        trades: [
          {
            id: "trade-1",
            accountId: "acc-1",
            ticker: "2330",
            type: "BUY",
            quantity: 10,
            unitPrice: 100,
            tradeDate: "2026-05-28",
            commissionAmount: 0,
            taxAmount: 0,
            priceCurrency: "TWD",
            marketCode: "TW",
          },
        ],
        postedDividends: [],
      }),
      deleteHoldingSnapshotsForTicker: vi.fn().mockResolvedValue(2),
      getDailyBarsForTickerMarket: vi.fn().mockResolvedValue([
        makeBar("2026-05-28", 100),
        makeBar("2026-05-29", 105),
        makeBar("2026-06-01", 110),
      ]),
      bulkUpsertHoldingSnapshots: vi.fn().mockResolvedValue(undefined),
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const handler = createSnapshotRepairHandler({ persistence, log });

    await handler([createRepairJob({
      ticker: "2330",
      marketCode: "TW",
      fromDate: "2026-05-29",
      trigger: "repair",
    })]);

    expect(persistence.listHoldingSnapshotRepairScopesForTickerMarket).toHaveBeenCalledWith("2330", "TW");
    expect(persistence.getSnapshotGenerationInputs).toHaveBeenCalledWith("user-1", {
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
    });
    expect(persistence.deleteHoldingSnapshotsForTicker).toHaveBeenCalledWith(
      "user-1",
      "acc-1",
      "2330",
      "2026-05-29",
      "TW",
    );
    expect(persistence.getDailyBarsForTickerMarket).toHaveBeenCalledWith(
      "2330",
      "TW",
      "2026-05-28",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(persistence.bulkUpsertHoldingSnapshots).toHaveBeenCalledWith(
      "user-1",
      expect.arrayContaining([
        expect.objectContaining({ snapshotDate: "2026-05-29", marketCode: "TW", marketValue: 1050 }),
        expect.objectContaining({ snapshotDate: "2026-06-01", marketCode: "TW", marketValue: 1100 }),
      ]),
    );
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: "2330", marketCode: "TW", repairedScopes: 1, failedScopes: 0 }),
      "snapshot_repair_complete",
    );
  });

  it("rejects the repair job after logging failed scopes so pg-boss can retry", async () => {
    const persistence = {
      listHoldingSnapshotRepairScopesForTickerMarket: vi.fn().mockResolvedValue([
        { userId: "user-1", accountId: "acc-ok", ticker: "2330", marketCode: "TW" },
        { userId: "user-1", accountId: "acc-fail", ticker: "2330", marketCode: "TW" },
      ]),
      listHoldingSnapshotRepairTargets: vi.fn(),
      getSnapshotGenerationInputs: vi.fn().mockImplementation((_userId: string, options: { accountId: string }) => {
        if (options.accountId === "acc-fail") {
          return Promise.reject(new Error("transient snapshot write failure"));
        }
        return Promise.resolve({
          trades: [
            {
              id: "trade-1",
              accountId: "acc-ok",
              ticker: "2330",
              type: "BUY",
              quantity: 10,
              unitPrice: 100,
              tradeDate: "2026-05-28",
              commissionAmount: 0,
              taxAmount: 0,
              priceCurrency: "TWD",
              marketCode: "TW",
            },
          ],
          postedDividends: [],
        });
      }),
      deleteHoldingSnapshotsForTicker: vi.fn().mockResolvedValue(1),
      getDailyBarsForTickerMarket: vi.fn().mockResolvedValue([
        makeBar("2026-05-28", 100),
        makeBar("2026-05-29", 105),
      ]),
      bulkUpsertHoldingSnapshots: vi.fn().mockResolvedValue(undefined),
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const handler = createSnapshotRepairHandler({ persistence, log });

    await expect(handler([createRepairJob({
      ticker: "2330",
      marketCode: "TW",
      fromDate: "2026-05-29",
      trigger: "repair",
    })])).rejects.toThrow("Snapshot repair failed for 1 scope(s) across 1 job(s)");

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc-fail", ticker: "2330", marketCode: "TW" }),
      "snapshot_repair_scope_failed",
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: "2330", marketCode: "TW", repairedScopes: 1, failedScopes: 1 }),
      "snapshot_repair_complete",
    );
  });
});

describe("snapshot repair scan worker", () => {
  it("does not classify zero-quantity null valuation snapshots as repair targets", async () => {
    const persistence = new PostgresPersistence({
      databaseUrl: "postgres://localhost/test",
      redisUrl: "redis://localhost:6379",
    });
    const query = vi.fn().mockResolvedValue({ rows: [] });
    Object.defineProperty(persistence, "pool", {
      configurable: true,
      value: { query },
    });

    await persistence.listHoldingSnapshotRepairTargets({
      fromDate: "2026-05-01",
      toDate: "2026-06-10",
      limit: 10,
    });

    const sql = String(query.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("s.quantity IS NULL");
    expect(sql).toMatch(/s\.quantity > 0\s+AND \(\s+s\.market_value IS NULL\s+OR s\.value_native IS NULL\s+\)/);
  });

  it("discovers repairable snapshot targets and enqueues bounded singleton repair jobs", async () => {
    const persistence = {
      listHoldingSnapshotRepairTargets: vi.fn().mockResolvedValue([
        {
          ticker: "2330",
          marketCode: "TW",
          fromDate: "2026-05-29",
          affectedScopeCount: 2,
          repairableRows: 8,
          missingRows: 6,
          incompleteRows: 2,
        },
      ]),
    };
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const handler = createSnapshotRepairScanHandler({
      persistence,
      boss,
      log,
      now: () => new Date("2026-06-10T12:00:00.000Z"),
    });

    await handler([createScanJob({})]);

    expect(persistence.listHoldingSnapshotRepairTargets).toHaveBeenCalledWith({
      fromDate: "2026-04-26",
      toDate: "2026-06-10",
      limit: DEFAULT_SNAPSHOT_REPAIR_SCAN_LIMIT,
    });
    expect(boss.send).toHaveBeenCalledWith(
      SNAPSHOT_REPAIR_QUEUE,
      {
        ticker: "2330",
        marketCode: "TW",
        fromDate: "2026-05-29",
        trigger: "repair",
      },
      { singletonKey: "2330:TW:2026-05-29" },
    );
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        matchedTargets: 1,
        enqueuedTargets: 1,
        failedTargets: 0,
        repairableRows: 8,
      }),
      "snapshot_repair_scan_complete",
    );
  });

  it("uses the admin rerun trigger when the scan job is operator initiated", async () => {
    const persistence = {
      listHoldingSnapshotRepairTargets: vi.fn().mockResolvedValue([
        {
          ticker: "0050",
          marketCode: "TW",
          fromDate: "2026-06-01",
          affectedScopeCount: 1,
          repairableRows: 1,
          missingRows: 1,
          incompleteRows: 0,
        },
      ]),
    };
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const handler = createSnapshotRepairScanHandler({ persistence, boss, log });

    await handler([createScanJob({
      fromDate: "2026-06-01",
      toDate: "2026-06-10",
      limit: 10,
      trigger: "admin_rerun",
    })]);

    expect(boss.send).toHaveBeenCalledWith(
      SNAPSHOT_REPAIR_QUEUE,
      expect.objectContaining({ ticker: "0050", trigger: "admin_rerun" }),
      { singletonKey: "0050:TW:2026-06-01" },
    );
  });

  it("skips invalid scan windows without querying persistence", async () => {
    const persistence = {
      listHoldingSnapshotRepairTargets: vi.fn(),
    };
    const boss = { send: vi.fn() };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const handler = createSnapshotRepairScanHandler({ persistence, boss, log });

    await handler([createScanJob({
      fromDate: "2026-06-10",
      toDate: "2026-06-01",
      limit: 10,
    })]);

    expect(persistence.listHoldingSnapshotRepairTargets).not.toHaveBeenCalled();
    expect(boss.send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fromDate: "2026-06-10", toDate: "2026-06-01" }),
      "snapshot_repair_scan_invalid_window",
    );
  });
});
