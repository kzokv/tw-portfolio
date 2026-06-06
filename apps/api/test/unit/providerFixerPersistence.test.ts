import { describe, expect, it, vi } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";

describe("Provider Fixer persistence contract", () => {
  it("stores and updates provider operations plus logs on memory backend", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    const created = await persistence.createProviderOperation({
      id: "op-kr-1",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair",
      phase: "preview",
      matchCount: 12,
      scopeQuery: "provider=yahoo-finance-kr",
    });
    await persistence.createProviderOperationLog({
      operationId: created.id,
      phase: "preview",
      level: "info",
      message: "preview prepared",
      context: { matched: 12 },
    });
    const updated = await persistence.updateProviderOperation({
      id: created.id,
      phase: "running",
      startedAt: "2026-06-03T05:00:00.000Z",
    });

    expect(updated.phase).toBe("running");
    expect(await persistence.hasActiveProviderExecution("yahoo-finance-kr", "KR")).toBe(true);

    const operations = await persistence.listProviderOperations({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      page: 1,
      limit: 10,
    });
    const logs = await persistence.listProviderOperationLogs({
      operationId: created.id,
      page: 1,
      limit: 10,
    });

    expect(operations.total).toBe(1);
    expect(operations.items[0]?.id).toBe(created.id);
    expect(logs.items[0]).toMatchObject({
      operationId: created.id,
      phase: "preview",
      level: "info",
      message: "preview prepared",
    });
  });

  it("treats preparing previews as active provider executions", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    await persistence.createProviderOperation({
      id: "op-kr-preparing",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair",
      phase: "preparing_preview",
      matchCount: 24,
      scopeQuery: "provider=yahoo-finance-kr&state=active",
    });

    await expect(
      persistence.hasActiveProviderExecution("yahoo-finance-kr", "KR"),
    ).resolves.toBe(true);
  });

  it("upserts durable provider-resolution mappings and lists unresolved provider errors", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    await persistence.insertProviderErrorTrailEntry({
      providerId: "yahoo-finance-kr",
      errorClass: "other",
      errorMessage: "yahoo_finance_kr_symbol_unresolved: 035900",
      context: { ticker: "035900", marketCode: "KR" },
    });
    await persistence.upsertProviderUnresolvedItem({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      errorCode: "different_unresolved_error",
      sourceSymbol: "035900",
      providerSymbol: "035900",
    });
    const page = await persistence.listProviderErrorTrailPage({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      errorMessageLike: "symbol_unresolved",
      page: 1,
      limit: 10,
    });

    const mapping = await persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "035900",
      resolvedSymbol: "035900.KQ",
      resolverMode: "quote_first",
      evidence: { exchange: "KOSDAQ", micCode: "XKOS" },
      verifiedByUserId: "admin-1",
      verifiedAt: "2026-06-03T06:00:00.000Z",
    });

    expect(page.total).toBe(1);
    expect(page.items[0]?.context).toMatchObject({ ticker: "035900", marketCode: "KR" });
    expect(mapping.resolvedSymbol).toBe("035900.KQ");
    await expect(
      persistence.listProviderErrorTrailPage({
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        errorMessageLike: "symbol_unresolved",
        excludeResolvedMappings: true,
        page: 1,
        limit: 10,
      }),
    ).resolves.toMatchObject({ total: 0, items: [] });
    expect(
      await persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "035900"),
    ).toMatchObject({
      sourceSymbol: "035900",
      resolvedSymbol: "035900.KQ",
      evidence: { exchange: "KOSDAQ", micCode: "XKOS" },
    });
    await expect(
      persistence.resolveProviderUnresolvedItems({
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        items: [
          {
            providerId: "yahoo-finance-kr",
            marketCode: "KR",
            errorCode: "yahoo_finance_kr_symbol_unresolved",
            sourceSymbol: "035900",
          },
        ],
        operationId: "op-kr-1",
      }),
    ).resolves.toBe(1);
    await expect(
      persistence.listProviderUnresolvedItems({
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        page: 1,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      total: 2,
      items: expect.arrayContaining([
        expect.objectContaining({
          errorCode: "yahoo_finance_kr_symbol_unresolved",
          sourceSymbol: "035900",
          state: "resolved",
          resolvedByOperationId: "op-kr-1",
        }),
        expect.objectContaining({
          errorCode: "different_unresolved_error",
          sourceSymbol: "035900",
          state: "active",
        }),
      ]),
    });
  });

  it("supports unresolved all-state queries, mapping evidence search, outcome action filters, and includeOperationId", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-03T01:00:00.000Z"));
    await persistence.createProviderOperation({
      id: "op-kr-older",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: "completed",
      matchCount: 1,
      scopeQuery: "older",
    });
    vi.setSystemTime(new Date("2026-06-03T02:00:00.000Z"));
    await persistence.createProviderOperation({
      id: "op-kr-selected",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      operationType: "rerun_backfill",
      phase: "completed",
      matchCount: 1,
      scopeQuery: "selected",
    });
    vi.useRealTimers();
    await persistence.upsertProviderUnresolvedItem({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      sourceSymbol: "005930",
      providerSymbol: "005930",
    });
    await persistence.updateProviderUnresolvedItemState({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      sourceSymbol: "005930",
      state: "ignored",
      actorUserId: "admin-1",
    });
    await persistence.upsertProviderResolutionMapping({
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      resolvedSymbol: "005930.KS",
      resolverMode: "quote_first",
      evidence: { operationId: "op-linked-123" },
      verifiedByUserId: "admin-1",
    });
    await persistence.upsertProviderOperationOutcome({
      operationId: "op-kr-selected",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "005930",
      providerSymbol: "005930.KS",
      action: "repair_mapping",
      state: "succeeded",
    });
    await persistence.upsertProviderOperationOutcome({
      operationId: "op-kr-selected",
      providerId: "yahoo-finance-kr",
      marketCode: "KR",
      sourceSymbol: "000660",
      providerSymbol: "000660.KS",
      action: "renew_evidence",
      state: "failed",
    });

    await expect(
      persistence.listProviderUnresolvedItems({
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        state: "all",
        page: 1,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "005930", state: "ignored" })],
    });

    await expect(
      persistence.listProviderResolutionMappings({
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        search: "op-linked-123",
        page: 1,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ sourceSymbol: "005930", resolvedSymbol: "005930.KS" })],
    });

    await expect(
      persistence.listProviderOperationOutcomes({
        operationId: "op-kr-selected",
        action: "renew_evidence",
        page: 1,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      total: 1,
      items: [expect.objectContaining({ action: "renew_evidence", sourceSymbol: "000660" })],
    });

    await expect(
      persistence.listProviderOperations({
        providerId: "yahoo-finance-kr",
        marketCode: "KR",
        includeOperationId: "op-kr-older",
        page: 1,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      total: 2,
      items: expect.arrayContaining([
        expect.objectContaining({ id: "op-kr-selected" }),
        expect.objectContaining({ id: "op-kr-older" }),
      ]),
    });
  });
});
