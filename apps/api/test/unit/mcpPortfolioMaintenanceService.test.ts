import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { createDefaultFeeProfile, createStore } from "../../src/services/store.js";
import {
  backfillTickers,
  getDailySnapshots,
  getReplayPortfolioPositionsRun,
  previewRecomputePortfolioFees,
  previewReplayPortfolioPositions,
  recomputePortfolioFees,
  replayPortfolioPositions,
} from "../../src/services/mcpPortfolioMaintenance.js";
import type { McpToolHandlerContext } from "../../src/mcp/types.js";

function buildDeps(
  persistence: MemoryPersistence,
  overrides: Partial<McpToolHandlerContext["app"]> = {},
): McpToolHandlerContext {
  return {
    app: {
      persistence,
      boss: null,
      log: {
        warn: () => undefined,
      },
      ...overrides,
    },
    requestContext: {
      resolvedContext: {
        sessionUserId: "user-1",
        portfolioContextUserId: "user-1",
        shareId: null,
        shareCapabilities: [],
      },
      logger: {
        warn: () => undefined,
      },
    },
  } as unknown as McpToolHandlerContext;
}

async function seedHeldTicker(persistence: MemoryPersistence) {
  const store = createStore();
  store.accounting.projections.holdings.push({
    accountId: "acc-1",
    ticker: "2330",
    quantity: 10,
    costBasisAmount: 1000,
    currency: "TWD",
  });
  store.accounting.facts.tradeEvents.push({
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
  } as never);
  await persistence.saveStore(store);
}

async function seedRecomputableTrade(persistence: MemoryPersistence) {
  const store = createStore();
  const feeProfile = store.feeProfiles[0]!;
  store.accounting.facts.tradeEvents.push({
    id: "trade-1",
    userId: "user-1",
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2026-06-25",
    commissionAmount: 1,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: feeProfile,
  });
  await persistence.saveStore(store);
}

describe("MCP portfolio maintenance service", () => {
  it("requires a matching recompute preview confirmation before applying fee changes", async () => {
    const persistence = new MemoryPersistence();
    await seedRecomputableTrade(persistence);
    const deps = buildDeps(persistence);

    const preview = await previewRecomputePortfolioFees(deps, {});
    expect(preview).toMatchObject({
      mode: "KEEP_RECORDED",
      counts: { total: 1, calculated: 1, preserved: 1, changed: 0 },
    });

    await expect(recomputePortfolioFees(deps, {
      jobId: preview.jobId,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: "0".repeat(64),
      fingerprint: preview.fingerprint,
    })).rejects.toMatchObject({ code: "mcp_recompute_confirmation_mismatch" });

    await expect(recomputePortfolioFees(deps, {
      jobId: preview.jobId,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
      fingerprint: preview.fingerprint,
    })).resolves.toMatchObject({
      jobId: preview.jobId,
      status: "CONFIRMED",
      affectedItemCount: 1,
    });
  });

  it("bounds multi-currency confirmation summaries while retaining every structured impact", async () => {
    const persistence = new MemoryPersistence();
    const store = createStore();
    const profile = store.feeProfiles[0]!;
    for (let index = 0; index < 40; index += 1) {
      const currency = `${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}X`;
      store.accounting.facts.tradeEvents.push({
        id: `trade-currency-${index}`,
        userId: store.userId,
        accountId: "acc-1",
        ticker: `T${index}`,
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: currency,
        tradeDate: "2026-06-25",
        commissionAmount: index,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: profile,
        feesSource: "CALCULATED",
      } as never);
    }
    await persistence.saveStore(store);

    const preview = await previewRecomputePortfolioFees(buildDeps(persistence), {});

    expect(preview.confirmationSummary.length).toBeLessThanOrEqual(500);
    expect(preview.confirmationSummary).toMatch(/more currencies/);
    expect(preview.impactsByCurrency).toHaveLength(40);
    expect(preview.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("creates replay previews only for held ticker-market scopes", async () => {
    const persistence = new MemoryPersistence();
    await seedHeldTicker(persistence);
    const deps = buildDeps(persistence);

    const preview = await previewReplayPortfolioPositions(deps, {
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    });

    expect(preview.scopes).toEqual([
      expect.objectContaining({ accountId: "acc-1", ticker: "2330", marketCode: "TW" }),
    ]);
    expect(preview.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);

    await expect(previewReplayPortfolioPositions(deps, {
      tickerMarkets: [{ ticker: "AAPL", marketCode: "US" }],
    })).rejects.toMatchObject({ code: "mcp_ticker_not_in_portfolio_scope" });
  });

  it("rejects ambiguous held ticker markets instead of guessing from account currency", async () => {
    const persistence = new MemoryPersistence();
    const store = createStore();
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "BHP",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "AUD",
    });
    store.accounting.facts.tradeEvents.push(
      { accountId: "acc-1", ticker: "BHP", marketCode: "AU" } as never,
      { accountId: "acc-1", ticker: "BHP", marketCode: "US" } as never,
    );
    await persistence.saveStore(store);

    await expect(previewReplayPortfolioPositions(buildDeps(persistence), {}))
      .rejects.toMatchObject({ code: "mcp_ambiguous_market_scope" });
  });

  it("ignores unrelated ambiguous holdings when tickerMarkets narrow replay scope", async () => {
    const persistence = new MemoryPersistence();
    const store = createStore();
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
      },
      {
        accountId: "acc-1",
        ticker: "BHP",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "AUD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      { accountId: "acc-1", ticker: "2330", marketCode: "TW" } as never,
      { accountId: "acc-1", ticker: "BHP", marketCode: "AU" } as never,
      { accountId: "acc-1", ticker: "BHP", marketCode: "US" } as never,
    );
    await persistence.saveStore(store);

    await expect(previewReplayPortfolioPositions(buildDeps(persistence), {
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    })).resolves.toMatchObject({
      scopes: [expect.objectContaining({ accountId: "acc-1", ticker: "2330", marketCode: "TW" })],
    });
  });

  it("rejects replay confirmation when the replay queue is unavailable", async () => {
    const persistence = new MemoryPersistence();
    await seedHeldTicker(persistence);
    const deps = buildDeps(persistence);
    const preview = await previewReplayPortfolioPositions(deps, {
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    });

    await expect(replayPortfolioPositions(deps, {
      previewId: preview.id,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
    })).rejects.toMatchObject({ code: "mcp_replay_queue_unavailable" });
  });

  it("consumes replay previews after the first confirmed queue request", async () => {
    const persistence = new MemoryPersistence();
    await seedHeldTicker(persistence);
    const sent: unknown[] = [];
    const deps = buildDeps(persistence, {
      boss: {
        send: async (_queue: string, payload: unknown, options: unknown) => {
          sent.push({ payload, options });
          return `job-${sent.length}`;
        },
      } as never,
    });
    const preview = await previewReplayPortfolioPositions(deps, {
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    });

    await expect(replayPortfolioPositions(deps, {
      previewId: preview.id,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
    })).resolves.toMatchObject({ previewId: preview.id, status: "queued" });
    await expect(replayPortfolioPositions(deps, {
      previewId: preview.id,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
    })).rejects.toMatchObject({ code: "mcp_replay_preview_consumed" });
    expect(sent).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ runId: expect.any(String) }),
        options: expect.objectContaining({ singletonKey: preview.id }),
      }),
    ]);
  });

  it("rejects stale replay confirmations before queueing work", async () => {
    const persistence = new MemoryPersistence();
    await seedHeldTicker(persistence);
    const deps = buildDeps(persistence);
    const preview = await previewReplayPortfolioPositions(deps, {
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    });
    await persistence.saveMcpReplayPreview({
      ...preview,
      expiresAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(replayPortfolioPositions(buildDeps(persistence, {
      boss: { send: async () => "job-1" } as never,
    }), {
      previewId: preview.id,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
    })).rejects.toMatchObject({ code: "mcp_replay_preview_expired" });
  });

  it("marks replay runs failed when queue enqueue fails", async () => {
    const persistence = new MemoryPersistence();
    await seedHeldTicker(persistence);
    const deps = buildDeps(persistence);
    const preview = await previewReplayPortfolioPositions(deps, {
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    });

    await expect(replayPortfolioPositions(buildDeps(persistence, {
      boss: { send: async () => { throw new Error("queue down"); } } as never,
    }), {
      previewId: preview.id,
      confirmationSummary: preview.confirmationSummary,
      confirmationDigest: preview.confirmationDigest,
    })).rejects.toThrow("queue down");

    const runs = [...(persistence as unknown as {
      mcpReplayRuns: Map<string, { id: string; status: string; scopes: Array<{ status: string; errorMessage: string | null }> }>;
    }).mcpReplayRuns.values()];
    expect(runs).toHaveLength(1);
    const storedRun = await persistence.getMcpReplayRun(runs[0]!.id);
    expect(storedRun).toMatchObject({
      status: "failed",
      scopes: [expect.objectContaining({ status: "failed", errorMessage: "queue down" })],
    });
  });

  it("returns replay run status only for the selected portfolio context", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createMcpReplayRun({
      id: "run-1",
      previewId: "preview-1",
      sessionUserId: "user-1",
      portfolioContextUserId: "user-1",
      status: "queued",
      createdAt: "2026-06-26T00:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      scopes: [{
        accountId: "acc-1",
        accountName: "Main",
        ticker: "2330",
        marketCode: "TW",
        status: "pending",
        errorMessage: null,
        replayedTradeCount: null,
        snapshotGenerationRunId: null,
        updatedAt: "2026-06-26T00:00:00.000Z",
      }],
    });

    await expect(getReplayPortfolioPositionsRun(buildDeps(persistence), { runId: "run-1" }))
      .resolves.toMatchObject({ id: "run-1", status: "queued" });
    await expect(getReplayPortfolioPositionsRun({
      ...buildDeps(persistence),
      requestContext: {
        ...buildDeps(persistence).requestContext,
        resolvedContext: {
          sessionUserId: "other-user",
          portfolioContextUserId: "other-user",
          shareId: null,
          shareCapabilities: [],
        },
      },
    }, { runId: "run-1" })).rejects.toMatchObject({ code: "mcp_replay_run_not_found" });
  });

  it("queues backfills only for held or monitored ticker-market pairs", async () => {
    const persistence = new MemoryPersistence();
    await seedHeldTicker(persistence);
    const sent: unknown[] = [];
    const deps = buildDeps(persistence, {
      boss: {
        send: async (_queue: string, payload: unknown) => {
          sent.push(payload);
          return `job-${sent.length}`;
        },
      } as never,
    });
    await persistence.replaceManualSelections("user-1", [{
      ticker: "AAPL",
      marketCode: "US",
      name: "Apple Inc.",
      instrumentType: "STOCK",
    }]);

    await expect(backfillTickers(deps, {
      tickerMarkets: [{ ticker: "TSLA", marketCode: "US" }],
    })).rejects.toMatchObject({ code: "mcp_ticker_not_in_portfolio_scope" });

    await expect(backfillTickers(deps, {
      tickerMarkets: [{ ticker: "AAPL", marketCode: "US" }],
    })).resolves.toMatchObject({
      enqueuedCount: 1,
      enqueued: [expect.objectContaining({ ticker: "AAPL", marketCode: "US", jobId: "job-1" })],
    });

    await expect(backfillTickers(deps, {
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
      includeBars: true,
      includeDividends: false,
    })).resolves.toMatchObject({
      enqueuedCount: 1,
      enqueued: [expect.objectContaining({ ticker: "2330", marketCode: "TW", jobId: "job-2" })],
    });
    expect(sent).toEqual([
      expect.objectContaining({
        ticker: "AAPL",
        marketCode: "US",
        trigger: "repair",
      }),
      expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
        trigger: "repair",
        includeBars: true,
        includeDividends: false,
      }),
    ]);
  });

  it("returns paginated holding snapshots with filtered summary counts", async () => {
    const persistence = new MemoryPersistence();
    await seedHeldTicker(persistence);
    persistence._seedHoldingSnapshots([
      {
        id: "snap-1",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        snapshotDate: "2026-06-25",
        quantity: 10,
        closePrice: 100,
        marketValue: 1000,
        costBasis: 900,
        unrealizedPnl: 100,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1000,
        costBasisNative: 900,
        unrealizedPnlNative: 100,
        providerSource: "test",
        generatedAt: "2026-06-25T00:00:00.000Z",
        generationRunId: "run-1",
      },
      {
        id: "snap-2",
        userId: "user-1",
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        snapshotDate: "2026-06-26",
        quantity: 10,
        closePrice: null,
        marketValue: null,
        costBasis: 900,
        unrealizedPnl: null,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: true,
        currency: "TWD",
        valueNative: null,
        costBasisNative: 900,
        unrealizedPnlNative: null,
        providerSource: null,
        generatedAt: "2026-06-26T00:00:00.000Z",
        generationRunId: "run-2",
      },
    ]);

    const result = await getDailySnapshots(buildDeps(persistence), {
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
      includeProvisional: false,
      limit: 1,
      offset: 0,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(expect.objectContaining({
      id: "snap-1",
      ticker: "2330",
      marketCode: "TW",
      accountName: "Main",
    }));
    expect(result.summary).toEqual({
      total: 1,
      provisionalCount: 0,
      limit: 1,
      offset: 0,
      hasMore: false,
    });
  });

  it("treats empty accountIds as absent when accountNames narrow the scope", async () => {
    const persistence = new MemoryPersistence();
    await seedHeldTicker(persistence);
    const store = await persistence.loadStore("user-1");
    const secondaryProfile = createDefaultFeeProfile("acc-2");
    store.accounts.push({
      id: "acc-2",
      userId: "user-1",
      name: "Secondary",
      feeProfileId: secondaryProfile.id,
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    store.feeProfiles.push(secondaryProfile);
    await persistence.saveStore(store);
    persistence._seedHoldingSnapshots([{
      id: "snap-main",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      snapshotDate: "2026-06-25",
      quantity: 10,
      closePrice: 100,
      marketValue: 1000,
      costBasis: 900,
      unrealizedPnl: 100,
      cumulativeRealizedPnl: 0,
      cumulativeDividends: 0,
      isProvisional: false,
      currency: "TWD",
      valueNative: 1000,
      costBasisNative: 900,
      unrealizedPnlNative: 100,
      providerSource: "test",
      generatedAt: "2026-06-25T00:00:00.000Z",
      generationRunId: "run-main",
    }]);

    const result = await getDailySnapshots(buildDeps(persistence), {
      accountIds: [],
      accountNames: ["Main"],
      limit: 10,
      offset: 0,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({ id: "snap-main", accountId: "acc-1", accountName: "Main" }),
    ]);
    expect(result.summary.total).toBe(1);
  });

  it("returns an empty snapshot page when the active account scope is empty", async () => {
    const persistence = new MemoryPersistence();
    const store = createStore();
    store.accounts = [];
    await persistence.saveStore(store);
    persistence._seedHoldingSnapshots([{
      id: "snap-deleted",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      snapshotDate: "2026-06-25",
      quantity: 10,
      closePrice: 100,
      marketValue: 1000,
      costBasis: 900,
      unrealizedPnl: 100,
      cumulativeRealizedPnl: 0,
      cumulativeDividends: 0,
      isProvisional: false,
      currency: "TWD",
      valueNative: 1000,
      costBasisNative: 900,
      unrealizedPnlNative: 100,
      providerSource: "test",
      generatedAt: "2026-06-25T00:00:00.000Z",
      generationRunId: "run-deleted",
    }]);

    await expect(getDailySnapshots(buildDeps(persistence), {
      limit: 10,
      offset: 0,
    })).resolves.toEqual({
      rows: [],
      summary: {
        total: 0,
        provisionalCount: 0,
        limit: 10,
        offset: 0,
        hasMore: false,
      },
    });
  });

  it("reads historical snapshots for requested ticker-markets without requiring current holdings", async () => {
    const persistence = new MemoryPersistence();
    await seedHeldTicker(persistence);
    persistence._seedHoldingSnapshots([{
      id: "snap-aapl",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "AAPL",
      marketCode: "US",
      snapshotDate: "2026-06-25",
      quantity: 0,
      closePrice: 200,
      marketValue: 0,
      costBasis: 0,
      unrealizedPnl: 0,
      cumulativeRealizedPnl: 50,
      cumulativeDividends: 2,
      isProvisional: false,
      currency: "USD",
      valueNative: 0,
      costBasisNative: 0,
      unrealizedPnlNative: 0,
      providerSource: "test",
      generatedAt: "2026-06-25T00:00:00.000Z",
      generationRunId: "run-aapl",
    }]);

    const result = await getDailySnapshots(buildDeps(persistence), {
      tickerMarkets: [{ ticker: "AAPL", marketCode: "US" }],
      limit: 10,
      offset: 0,
    });

    expect(result.rows).toEqual([
      expect.objectContaining({
        id: "snap-aapl",
        ticker: "AAPL",
        marketCode: "US",
        accountName: "Main",
      }),
    ]);
    expect(result.summary.total).toBe(1);
  });
});
