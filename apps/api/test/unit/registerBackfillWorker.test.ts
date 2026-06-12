import { describe, expect, it, vi } from "vitest";
import type { AppInstance } from "../../src/app.js";
import { BACKFILL_QUEUE } from "../../src/services/market-data/backfillWorker.js";
import { registerBackfillWorker } from "../../src/services/market-data/registerBackfillWorker.js";
import { SNAPSHOT_REPAIR_QUEUE, SNAPSHOT_REPAIR_SCAN_QUEUE } from "../../src/services/snapshotRepair.js";

describe("registerBackfillWorker", () => {
  it("registers snapshot repair before starting the backfill worker", async () => {
    const calls: string[] = [];
    const boss = {
      createQueue: vi.fn(async (queue: string) => {
        calls.push(`create:${queue}`);
      }),
      work: vi.fn(async (queue: string) => {
        calls.push(`work:${queue}`);
      }),
      schedule: vi.fn(async (queue: string) => {
        calls.push(`schedule:${queue}`);
      }),
      send: vi.fn(async (queue: string) => {
        calls.push(`send:${queue}`);
      }),
    };
    const app = {
      log: {
        info: vi.fn(),
      },
      persistence: {},
    } as unknown as AppInstance;

    await registerBackfillWorker(app, boss as never, {
      persistence: {},
      eventBus: {},
      log: app.log,
    } as never);

    expect(calls).toEqual([
      `create:${BACKFILL_QUEUE}`,
      `create:${SNAPSHOT_REPAIR_QUEUE}`,
      `work:${SNAPSHOT_REPAIR_QUEUE}`,
      `create:${SNAPSHOT_REPAIR_SCAN_QUEUE}`,
      `work:${SNAPSHOT_REPAIR_SCAN_QUEUE}`,
      `schedule:${SNAPSHOT_REPAIR_SCAN_QUEUE}`,
      `send:${SNAPSHOT_REPAIR_SCAN_QUEUE}`,
      `work:${BACKFILL_QUEUE}`,
    ]);
  });
});
