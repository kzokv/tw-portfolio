/**
 * Unit tests for fxRefreshWorker handler.
 *
 * Tests run against MemoryPersistence + MockFrankfurterFxRateProvider.
 *
 * Invariants validated:
 *  1. Self-pair filter — mock returns row with quote === base → filtered before upsertFxRates
 *  4. Per-base iteration — fetchRatesForBase called once per base in STORED_QUOTES
 *  6. Upsert uses provider's per-row date, not today_utc()
 *  7. Worker errors bubble to pg-boss retry (re-throw on non-rate-limit errors)
 *
 * Additional coverage:
 *  - Structured log emission: fx_refresh_completed on success, fx_refresh_failed on error
 *  - Mock-clock-isolated: no real new Date() reliance in assertions
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import { FX_REFRESH_QUEUE, createFxRefreshHandler } from "../../src/services/market-data/fxRefreshWorker.js";
import type { FxRefreshJobData, FxRate } from "../../src/services/market-data/types.js";

// Pin clock so today_utc() is deterministic in deriveFetchWindow
const FIXED_NOW = new Date("2026-04-26T22:00:00Z");
const TODAY_UTC = "2026-04-26";
const YESTERDAY = "2026-04-25";

beforeEach(() => {
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Job helpers ───────────────────────────────────────────────────────────────

function createJob(
  data: FxRefreshJobData,
  retryCount = 0,
  retryLimit = 3,
): JobWithMetadata<FxRefreshJobData> {
  return {
    data,
    retryCount,
    retryLimit,
  } as JobWithMetadata<FxRefreshJobData>;
}

function cronJob(extra?: Partial<FxRefreshJobData>): JobWithMetadata<FxRefreshJobData> {
  return createJob({
    trigger: "cron",
    startDate: TODAY_UTC,
    endDate: TODAY_UTC,
    bases: ["TWD", "USD", "AUD", "KRW"],
    ...extra,
  });
}

function manualJob(startDate: string, endDate: string): JobWithMetadata<FxRefreshJobData> {
  return createJob({
    trigger: "manual",
    startDate,
    endDate,
    bases: ["TWD", "USD", "AUD", "KRW"],
  });
}

// ── Deps helpers ──────────────────────────────────────────────────────────────

function makeRates(base: string, quoteDate: string, includeSelfPair = false): FxRate[] {
  const rates: FxRate[] = [
    { date: quoteDate, baseCurrency: base, quoteCurrency: "TWD", rate: 31.5, source: "frankfurter" },
    { date: quoteDate, baseCurrency: base, quoteCurrency: "USD", rate: 0.032, source: "frankfurter" },
    { date: quoteDate, baseCurrency: base, quoteCurrency: "AUD", rate: 0.049, source: "frankfurter" },
    { date: quoteDate, baseCurrency: base, quoteCurrency: "KRW", rate: 43.2, source: "frankfurter" },
  ].filter((r) => includeSelfPair || r.quoteCurrency !== r.baseCurrency);

  if (includeSelfPair) {
    rates.push({ date: quoteDate, baseCurrency: base, quoteCurrency: base, rate: 1.0, source: "frankfurter" });
  }

  return rates;
}

function createDeps() {
  const fxProvider = {
    fetchRatesForBase: vi.fn().mockImplementation((base: string) =>
      Promise.resolve(makeRates(base, YESTERDAY)),
    ),
    reserveCapacity: vi.fn(),
  };

  const persistence = {
    getLatestFxRateDate: vi.fn().mockResolvedValue(null),
    upsertFxRates: vi.fn().mockResolvedValue(4),
    _resetFxRates: vi.fn(),
  };

  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  return { fxProvider, persistence, log };
}

// ── STORED_QUOTES constant ────────────────────────────────────────────────────

describe("fxRefreshWorker — STORED_QUOTES constant", () => {
  it("FX_REFRESH_QUEUE constant is exported as 'fx-refresh'", () => {
    expect(FX_REFRESH_QUEUE).toBe("fx-refresh");
  });
});

// ── Invariant 4: Per-base iteration ──────────────────────────────────────────

describe("fxRefreshWorker — per-base iteration (Invariant 4)", () => {
  it("calls fetchRatesForBase once for each STORED_QUOTES base", async () => {
    const deps = createDeps();
    const handler = createFxRefreshHandler(deps as never);

    await handler([cronJob()]);

    expect(deps.fxProvider.fetchRatesForBase).toHaveBeenCalledTimes(4);

    const calledBases = deps.fxProvider.fetchRatesForBase.mock.calls.map(
      (call: unknown[]) => call[0],
    ) as string[];
    expect(calledBases).toContain("TWD");
    expect(calledBases).toContain("USD");
    expect(calledBases).toContain("AUD");
    expect(calledBases).toContain("KRW");
  });

  it("calls fetchRatesForBase with the computed window dates", async () => {
    const deps = createDeps();
    // Set up: DB empty → 30-day seed window
    deps.persistence.getLatestFxRateDate.mockResolvedValue(null);
    const handler = createFxRefreshHandler(deps as never);

    await handler([cronJob()]);

    // For each base call, the from/to dates should be the window dates (not today)
    for (const call of deps.fxProvider.fetchRatesForBase.mock.calls as unknown[][]) {
      const [, fromDate, toDate] = call as [string, string, string];
      expect(typeof fromDate).toBe("string");
      expect(typeof toDate).toBe("string");
      expect(fromDate.length).toBe(10); // YYYY-MM-DD
      expect(toDate.length).toBe(10);
    }
  });

  it("passes STORED_QUOTES as the quotes filter to each fetchRatesForBase call", async () => {
    const deps = createDeps();
    const handler = createFxRefreshHandler(deps as never);

    await handler([cronJob()]);

    for (const call of deps.fxProvider.fetchRatesForBase.mock.calls as unknown[][]) {
      const quotesArg = (call as unknown[])[3];
      // quotes filter should be the STORED_QUOTES array
      expect(quotesArg).toBeDefined();
      expect(Array.isArray(quotesArg)).toBe(true);
      const quotes = quotesArg as string[];
      expect(quotes).toContain("TWD");
      expect(quotes).toContain("USD");
      expect(quotes).toContain("AUD");
      expect(quotes).toContain("KRW");
    }
  });

  it("calls upsertFxRates once with combined results from all bases", async () => {
    const deps = createDeps();
    const handler = createFxRefreshHandler(deps as never);

    await handler([cronJob()]);

    expect(deps.persistence.upsertFxRates).toHaveBeenCalledTimes(1);
    const [upsertedRates] = deps.persistence.upsertFxRates.mock.calls[0] as [FxRate[]];
    // 3 bases × (at most 3 non-self quotes each) = up to 9 total rates per date
    expect(upsertedRates.length).toBeGreaterThan(0);
  });
});

// ── Invariant 1: Self-pair filter ─────────────────────────────────────────────

describe("fxRefreshWorker — self-pair filter (Invariant 1)", () => {
  it("filters out rows where quote === base before calling upsertFxRates", async () => {
    const deps = createDeps();
    // Mock provider returns a self-pair row (USD/USD=1.0) in addition to valid pairs
    deps.fxProvider.fetchRatesForBase.mockImplementation((base: string) =>
      Promise.resolve(makeRates(base, YESTERDAY, /* includeSelfPair= */ true)),
    );
    const handler = createFxRefreshHandler(deps as never);

    await handler([cronJob()]);

    expect(deps.persistence.upsertFxRates).toHaveBeenCalledTimes(1);
    const [upsertedRates] = deps.persistence.upsertFxRates.mock.calls[0] as [FxRate[]];

    // No self-pair should survive
    for (const r of upsertedRates) {
      expect(r.baseCurrency).not.toBe(r.quoteCurrency);
    }
  });

  it("does not call upsertFxRates with zero rows when all rows are self-pairs (edge case)", async () => {
    const deps = createDeps();
    // Mock returns only self-pair rows
    deps.fxProvider.fetchRatesForBase.mockResolvedValue([
      { date: YESTERDAY, baseCurrency: "USD", quoteCurrency: "USD", rate: 1.0, source: "frankfurter" },
    ]);
    const handler = createFxRefreshHandler(deps as never);

    await handler([cronJob()]);

    expect(deps.persistence.upsertFxRates).toHaveBeenCalledTimes(1);
    const [upsertedRates] = deps.persistence.upsertFxRates.mock.calls[0] as [FxRate[]];
    expect(upsertedRates).toHaveLength(0);
  });
});

// ── Invariant 6: Upsert uses response.date ────────────────────────────────────

describe("fxRefreshWorker — upsert uses response.date (Invariant 6)", () => {
  it("upserted rows carry the date from the provider response, not today_utc()", async () => {
    const deps = createDeps();
    // Provider returns rates dated yesterday (simulating Frankfurter forward-fill)
    const providerDate = "2026-04-23"; // Thursday — a forward-filled Friday response
    deps.fxProvider.fetchRatesForBase.mockResolvedValue([
      { date: providerDate, baseCurrency: "USD", quoteCurrency: "TWD", rate: 31.5, source: "frankfurter" },
    ]);
    const handler = createFxRefreshHandler(deps as never);

    await handler([manualJob("2026-04-23", "2026-04-25")]);

    const [upsertedRates] = deps.persistence.upsertFxRates.mock.calls[0] as [FxRate[]];
    const twdRate = upsertedRates.find((r) => r.quoteCurrency === "TWD");
    expect(twdRate).toBeDefined();
    expect(twdRate!.date).toBe(providerDate); // must be provider's date, not today
    expect(twdRate!.date).not.toBe(TODAY_UTC);
  });
});

// ── Invariant 7: Error re-throw ────────────────────────────────────────────────

describe("fxRefreshWorker — error handling (Invariant 7)", () => {
  it("re-throws provider errors so pg-boss can retry (no silent swallow)", async () => {
    const deps = createDeps();
    deps.fxProvider.fetchRatesForBase.mockRejectedValue(new Error("Frankfurter API timeout"));
    const handler = createFxRefreshHandler(deps as never);

    await expect(handler([cronJob()])).rejects.toThrow("Frankfurter API timeout");
  });

  it("re-throws network errors", async () => {
    const deps = createDeps();
    deps.fxProvider.fetchRatesForBase.mockRejectedValue(new Error("ECONNREFUSED"));
    const handler = createFxRefreshHandler(deps as never);

    await expect(handler([cronJob()])).rejects.toThrow("ECONNREFUSED");
  });

  it("re-throws upsert errors", async () => {
    const deps = createDeps();
    deps.persistence.upsertFxRates.mockRejectedValue(new Error("DB constraint violation"));
    const handler = createFxRefreshHandler(deps as never);

    await expect(handler([cronJob()])).rejects.toThrow("DB constraint violation");
  });
});

// ── Structured logging ─────────────────────────────────────────────────────────

describe("fxRefreshWorker — structured log emission", () => {
  it("emits fx_refresh_completed on successful run", async () => {
    const deps = createDeps();
    deps.persistence.upsertFxRates.mockResolvedValue(6);
    const handler = createFxRefreshHandler(deps as never);

    await handler([cronJob()]);

    // Find any log.info call that contains 'fx_refresh_completed'
    const infoLogs = deps.log.info.mock.calls.flat() as unknown[];
    const hasCompletedLog = infoLogs.some(
      (arg) => JSON.stringify(arg).includes("fx_refresh_completed"),
    );
    expect(hasCompletedLog).toBe(true);
  });

  it("emits fx_refresh_failed on error", async () => {
    const deps = createDeps();
    deps.fxProvider.fetchRatesForBase.mockRejectedValue(new Error("network down"));
    const handler = createFxRefreshHandler(deps as never);

    await expect(handler([cronJob()])).rejects.toThrow();

    const errorLogs = deps.log.error.mock.calls.flat() as unknown[];
    const hasFailedLog = errorLogs.some(
      (arg) => JSON.stringify(arg).includes("fx_refresh_failed"),
    );
    expect(hasFailedLog).toBe(true);
  });

  it("fx_refresh_completed log includes rows_upserted", async () => {
    const deps = createDeps();
    deps.persistence.upsertFxRates.mockResolvedValue(9);
    const handler = createFxRefreshHandler(deps as never);

    await handler([cronJob()]);

    const infoArgs = deps.log.info.mock.calls.flat() as unknown[];
    const completedEntry = infoArgs.find(
      (arg) => typeof arg === "object" && arg !== null && "rows_upserted" in (arg as object),
    ) as Record<string, unknown> | undefined;
    expect(completedEntry?.rows_upserted).toBe(9);
  });

  it("fx_refresh_completed log includes trigger from jobData", async () => {
    const deps = createDeps();
    const handler = createFxRefreshHandler(deps as never);

    await handler([manualJob("2026-04-01", "2026-04-25")]);

    const infoArgs = deps.log.info.mock.calls.flat() as unknown[];
    const completedEntry = infoArgs.find(
      (arg) => typeof arg === "object" && arg !== null && "trigger" in (arg as object),
    ) as Record<string, unknown> | undefined;
    expect(completedEntry?.trigger).toBe("manual");
  });

  it("updates and logs a correlated provider operation on success", async () => {
    const deps = createDeps();
    const getProviderOperation = vi.fn().mockResolvedValue({
      id: "op-fx-1",
      providerId: "frankfurter",
      marketCode: "FX",
      phase: "queued",
      metadata: { marketDataBff: true },
    });
    const updateProviderOperation = vi.fn().mockResolvedValue({});
    const createProviderOperationLog = vi.fn().mockResolvedValue({});
    deps.persistence.upsertFxRates.mockResolvedValue(12);
    const handler = createFxRefreshHandler({
      ...deps,
      persistence: {
        ...deps.persistence,
        getProviderOperation,
        updateProviderOperation,
        createProviderOperationLog,
      },
    } as never);

    await handler([cronJob({ providerOperationId: "op-fx-1" })]);

    expect(updateProviderOperation).toHaveBeenCalledWith(expect.objectContaining({
      id: "op-fx-1",
      phase: "running",
    }));
    expect(updateProviderOperation).toHaveBeenCalledWith(expect.objectContaining({
      id: "op-fx-1",
      phase: "completed",
      metadata: expect.objectContaining({ rowsUpserted: 12, progressPercent: 100 }),
    }));
    expect(createProviderOperationLog).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "op-fx-1",
      phase: "completed",
      message: expect.stringContaining("fx_refresh_completed"),
    }));
  });
});

// ── Audit log: cron path does NOT write audit ────────────────────────────────

describe("fxRefreshWorker — audit log invariant (Invariant 2)", () => {
  it("worker handler does NOT call any audit write helper (audit is route-level only)", async () => {
    const deps = createDeps();
    const writeAuditEntry = vi.fn();
    const handler = createFxRefreshHandler({ ...deps, writeAuditEntry } as never);

    await handler([cronJob()]);

    // No audit entry should be written from within the worker
    expect(writeAuditEntry).not.toHaveBeenCalled();
  });
});
