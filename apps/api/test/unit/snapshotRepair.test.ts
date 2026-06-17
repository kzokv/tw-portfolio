import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import type { DailyBar } from "@vakwen/domain";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { rebuildHoldingProjection } from "../../src/services/accountingStore.js";
import { createStore } from "../../src/services/store.js";
import {
  createSnapshotRepairHandler,
  createSnapshotRepairScanHandler,
  DEFAULT_SNAPSHOT_REPAIR_SCAN_LIMIT,
  enqueueSnapshotRepairIfActiveHeld,
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
    quality: "full_bar",
    source: "test",
    ingestedAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
  };
}

function addOpenTradeAndLot(store: ReturnType<typeof createStore>, ticker = "2330", marketCode: "TW" = "TW") {
  store.accounting.facts.tradeEvents.push({
    id: `trade-${store.userId}-${ticker}-${marketCode}`,
    userId: store.userId,
    accountId: "acc-1",
    ticker,
    marketCode,
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2026-05-28",
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: store.feeProfiles[0]!,
  });
  store.accounting.projections.lots.push({
    id: `lot-${store.userId}-${ticker}-${marketCode}`,
    accountId: "acc-1",
    ticker,
    openQuantity: 10,
    totalCostAmount: 1000,
    costCurrency: "TWD",
    openedAt: "2026-05-28",
  });
  rebuildHoldingProjection(store);
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

describe("enqueueSnapshotRepairIfActiveHeld", () => {
  it("uses the existing singleton enqueue path only when an active-held scope exists", async () => {
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const persistence = {
      listHoldingSnapshotRepairScopesForTickerMarket: vi.fn().mockResolvedValue([
        { userId: "user-1", accountId: "acc-1", ticker: "2330", marketCode: "TW" },
      ]),
    };

    await expect(enqueueSnapshotRepairIfActiveHeld({
      boss,
      persistence: persistence as never,
      ticker: "2330",
      marketCode: "TW",
      fromDate: "2026-06-01",
      trigger: "admin_rerun",
    })).resolves.toBe(true);

    expect(persistence.listHoldingSnapshotRepairScopesForTickerMarket).toHaveBeenCalledWith("2330", "TW");
    expect(boss.send).toHaveBeenCalledWith(
      SNAPSHOT_REPAIR_QUEUE,
      {
        ticker: "2330",
        marketCode: "TW",
        fromDate: "2026-06-01",
        trigger: "admin_rerun",
      },
      { singletonKey: "2330:TW:2026-06-01" },
    );
  });

  it("skips enqueue when there is no fromDate or no active-held scope", async () => {
    const boss = { send: vi.fn() };
    const persistence = {
      listHoldingSnapshotRepairScopesForTickerMarket: vi.fn().mockResolvedValue([]),
    };

    await expect(enqueueSnapshotRepairIfActiveHeld({
      boss,
      persistence: persistence as never,
      ticker: "2330",
      marketCode: "TW",
      fromDate: null,
      trigger: "repair",
    })).resolves.toBe(false);
    await expect(enqueueSnapshotRepairIfActiveHeld({
      boss,
      persistence: persistence as never,
      ticker: "2330",
      marketCode: "TW",
      fromDate: "2026-06-01",
      trigger: "repair",
    })).resolves.toBe(false);

    expect(boss.send).not.toHaveBeenCalled();
  });

  it("enqueues repair for an active holding even when snapshot rows are still missing", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();
    const store = createStore();
    addOpenTradeAndLot(store);
    await persistence.saveStore(store);

    const boss = { send: vi.fn().mockResolvedValue("job-1") };

    await expect(enqueueSnapshotRepairIfActiveHeld({
      boss,
      persistence,
      ticker: "2330",
      marketCode: "TW",
      fromDate: "2026-06-01",
      trigger: "repair",
    })).resolves.toBe(true);

    expect(await persistence.listHoldingSnapshotRepairScopesForTickerMarket("2330", "TW")).toEqual([
      { userId: "user-1", accountId: "acc-1", ticker: "2330", marketCode: "TW" },
    ]);
    expect(boss.send).toHaveBeenCalledWith(
      SNAPSHOT_REPAIR_QUEUE,
      {
        ticker: "2330",
        marketCode: "TW",
        fromDate: "2026-06-01",
        trigger: "repair",
      },
      { singletonKey: "2330:TW:2026-06-01" },
    );

    await persistence.close();
  });

  it("enqueues repair for sold-out historical holdings that still need performance snapshots", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();
    const store = createStore();
    addOpenTradeAndLot(store);
    store.accounting.projections.lots = store.accounting.projections.lots.map((lot) => ({
      ...lot,
      openQuantity: 0,
    }));
    rebuildHoldingProjection(store);
    await persistence.saveStore(store);

    const boss = { send: vi.fn().mockResolvedValue("job-1") };

    await expect(enqueueSnapshotRepairIfActiveHeld({
      boss,
      persistence,
      ticker: "2330",
      marketCode: "TW",
      fromDate: "2026-06-01",
      trigger: "repair",
    })).resolves.toBe(true);

    expect(await persistence.listHoldingSnapshotRepairScopesForTickerMarket("2330", "TW")).toEqual([
      { userId: "user-1", accountId: "acc-1", ticker: "2330", marketCode: "TW" },
    ]);
    expect(boss.send).toHaveBeenCalledWith(
      SNAPSHOT_REPAIR_QUEUE,
      {
        ticker: "2330",
        marketCode: "TW",
        fromDate: "2026-06-01",
        trigger: "repair",
      },
      { singletonKey: "2330:TW:2026-06-01" },
    );

    await persistence.close();
  });

  it("lists Postgres repair scopes from trade history instead of open lots", async () => {
    const persistence = new PostgresPersistence({
      databaseUrl: "postgres://localhost/test",
      redisUrl: "redis://localhost:6379",
    });
    const query = vi.fn().mockResolvedValue({
      rows: [{ user_id: "user-1", account_id: "acc-1", ticker: "2330", market_code: "TW" }],
    });
    Object.defineProperty(persistence, "pool", {
      configurable: true,
      value: { query },
    });

    await expect(persistence.listHoldingSnapshotRepairScopesForTickerMarket("2330", "TW")).resolves.toEqual([
      { userId: "user-1", accountId: "acc-1", ticker: "2330", marketCode: "TW" },
    ]);

    const sql = String(query.mock.calls[0]?.[0] ?? "");
    expect(sql).toContain("FROM trade_events te");
    expect(sql).not.toContain("open_quantity");
    expect(sql).not.toContain("FROM lots");
    expect(query).toHaveBeenCalledWith(expect.any(String), ["2330", "TW"]);
  });

  it("does not enqueue repair for disabled or deleted users even when they still have open lots", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();
    const disabled = await persistence.resolveOrCreateUser("google", "disabled-sub", {
      email: "disabled@example.com",
      emailVerified: true,
      name: "Disabled User",
    });
    const deleted = await persistence.resolveOrCreateUser("google", "deleted-sub", {
      email: "deleted@example.com",
      emailVerified: true,
      name: "Deleted User",
    });
    const usersByEmail = (persistence as unknown as {
      usersByEmail: Map<string, { deactivatedAt?: string | null; deletedAt?: string | null }>;
    }).usersByEmail;
    usersByEmail.get("disabled@example.com")!.deactivatedAt = "2026-06-01T00:00:00.000Z";
    usersByEmail.get("deleted@example.com")!.deletedAt = "2026-06-01T00:00:00.000Z";

    for (const userId of [disabled.userId, deleted.userId]) {
      const store = createStore();
      store.userId = userId;
      store.settings.userId = userId;
      store.accounts = store.accounts.map((account) => ({ ...account, userId }));
      addOpenTradeAndLot(store);
      await persistence.saveStore(store);
    }

    const boss = { send: vi.fn().mockResolvedValue("job-1") };

    await expect(enqueueSnapshotRepairIfActiveHeld({
      boss,
      persistence,
      ticker: "2330",
      marketCode: "TW",
      fromDate: "2026-06-01",
      trigger: "repair",
    })).resolves.toBe(false);

    expect(await persistence.listHoldingSnapshotRepairScopesForTickerMarket("2330", "TW")).toEqual([]);
    expect(boss.send).not.toHaveBeenCalled();

    await persistence.close();
  });
});
