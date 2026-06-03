import { describe, expect, it } from "vitest";
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

  it("upserts durable provider-resolution mappings and lists unresolved provider errors", async () => {
    const persistence = new MemoryPersistence();
    await persistence.init();

    await persistence.insertProviderErrorTrailEntry({
      providerId: "yahoo-finance-kr",
      errorClass: "other",
      errorMessage: "yahoo_finance_kr_symbol_unresolved: 035900",
      context: { ticker: "035900", marketCode: "KR" },
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
    expect(
      await persistence.getProviderResolutionMapping("yahoo-finance-kr", "KR", "035900"),
    ).toMatchObject({
      sourceSymbol: "035900",
      resolvedSymbol: "035900.KQ",
      evidence: { exchange: "KOSDAQ", micCode: "XKOS" },
    });
  });
});
