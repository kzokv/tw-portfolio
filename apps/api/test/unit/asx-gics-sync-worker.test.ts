import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import { createAsxGicsSyncHandler } from "../../src/services/market-data/asxGicsSyncWorker.js";

function job(data: Record<string, unknown> = {}): JobWithMetadata<unknown> {
  return {
    data,
    retryCount: 0,
    retryLimit: 3,
  } as JobWithMetadata<unknown>;
}

function createDeps() {
  const provider = {
    fetchGicsCatalog: vi.fn().mockResolvedValue([
      { ticker: "BHP", gicsIndustryGroup: "Materials" },
    ]),
  };
  const client = {
    query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
    release: vi.fn(),
  };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [{ ticker: "BHP" }] }),
    connect: vi.fn().mockResolvedValue(client),
  };
  const persistence = {
    getProviderOperation: vi.fn().mockResolvedValue({
      id: "op-asx-1",
      providerId: "asx-gics-csv",
      marketCode: "AU",
      phase: "queued",
      metadata: { marketDataBff: true },
    }),
    updateProviderOperation: vi.fn().mockResolvedValue({}),
    createProviderOperationLog: vi.fn().mockResolvedValue({}),
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const providerHealth = { recordOutcome: vi.fn().mockResolvedValue(undefined) };
  return { provider, pool, client, persistence, log, providerHealth };
}

describe("asx gics sync worker provider-operation correlation", () => {
  it("updates and logs a correlated provider operation on success", async () => {
    const deps = createDeps();
    const handler = createAsxGicsSyncHandler(deps as never);

    const metrics = await handler([job({ providerOperationId: "op-asx-1" })]);

    expect(metrics.rowsParsed).toBe(1);
    expect(deps.persistence.updateProviderOperation).toHaveBeenCalledWith(expect.objectContaining({
      id: "op-asx-1",
      phase: "running",
    }));
    expect(deps.persistence.updateProviderOperation).toHaveBeenCalledWith(expect.objectContaining({
      id: "op-asx-1",
      phase: "completed",
      metadata: expect.objectContaining({ rowsParsed: 1, progressPercent: 100 }),
    }));
    expect(deps.persistence.createProviderOperationLog).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "op-asx-1",
      phase: "completed",
      message: expect.stringContaining("gics_sync_completed"),
    }));
  });

  it("skips provider fetch when the correlated operation is cancelled", async () => {
    const deps = createDeps();
    deps.persistence.getProviderOperation.mockResolvedValue({
      id: "op-asx-cancelled",
      providerId: "asx-gics-csv",
      marketCode: "AU",
      phase: "cancelled",
      metadata: { marketDataBff: true },
    });
    const handler = createAsxGicsSyncHandler(deps as never);

    const metrics = await handler([job({ providerOperationId: "op-asx-cancelled" })]);

    expect(metrics.rowsParsed).toBe(0);
    expect(deps.provider.fetchGicsCatalog).not.toHaveBeenCalled();
    expect(deps.persistence.createProviderOperationLog).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "op-asx-cancelled",
      phase: "cancelled",
      message: expect.stringContaining("gics_sync_skipped"),
    }));
  });
});
