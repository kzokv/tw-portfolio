import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import {
  createSnapshotRepairScanHandler,
  DEFAULT_SNAPSHOT_REPAIR_SCAN_LIMIT,
  SNAPSHOT_REPAIR_QUEUE,
  type SnapshotRepairScanJobData,
} from "../../src/services/snapshotRepair.js";

function createScanJob(data: SnapshotRepairScanJobData): JobWithMetadata<SnapshotRepairScanJobData> {
  return { data } as JobWithMetadata<SnapshotRepairScanJobData>;
}

describe("snapshot repair scan worker", () => {
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
