import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createTransactionDraftBatch, preflightTransactionDraftCandidates } from "../../src/services/mcpDrafts.js";
import type { McpRequestContext } from "../../src/mcp/types.js";

let app: Awaited<ReturnType<typeof buildApp>>;

function createRequestContext(): McpRequestContext {
  return {
    auth: {
      token: "vakwen-dev.test",
      clientId: "vakwen-dev-client",
      sessionUserId: "user-1",
      connection: null,
      scopes: [
        "portfolio:mcp_read",
        "transaction_draft:create",
        "transaction_draft:edit",
        "transaction_draft:archive",
        "transaction_draft:delete",
      ],
      toolToggles: {},
      expiresAt: null,
      authMode: "dev_token",
    },
    resolvedContext: {
      sessionUserId: "user-1",
      portfolioContextUserId: "user-1",
      shareId: null,
      shareCapabilities: [],
    },
    requestId: "test-request",
    sourceIp: "127.0.0.1",
    userAgent: "vitest",
    logger: app.log,
  };
}

describe("mcp draft services", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", seedMemoryCatalog: true });
  });

  afterEach(async () => {
    await app.close();
  });

  it("preflights trade rows and preserves unsupported rows as audit-only items", async () => {
    const result = await preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 2,
            unitPrice: 100,
            tradeDate: "2026-01-02",
          },
          {
            rowNumber: 2,
            recordType: "unsupported",
            sourceSnippet: "cash transfer row",
          },
        ],
      },
    );

    expect(result.summary.blockingRowCount).toBe(0);
    expect(result.summary.readyRowCount).toBe(1);
    expect(result.summary.unsupportedCount).toBe(1);
    expect(result.rows[0]?.state).toBe("ready");
    expect(result.unsupportedItems[0]?.category).toBe("non_trade");
  });

  it("blocks same-day collisions against posted transactions when ordering data is missing", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push({
      id: "posted-same-day",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 1,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-04",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    });
    await app.persistence.saveStore(store);

    const result = await preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 101,
            tradeDate: "2026-01-04",
          },
        ],
      },
    );

    expect(result.summary.blockingRowCount).toBe(1);
    expect(result.rows[0]?.issues).toContainEqual(
      expect.objectContaining({ code: "same_day_collision" }),
    );
  });

  it("creates an MCP draft batch with persisted rows and unsupported items", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        provenance: { source: "unit-test" },
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
          },
          {
            rowNumber: 2,
            recordType: "unsupported",
            sourceSnippet: "dividend row",
          },
        ],
      },
    );

    expect(created.batch.status).toBe("open");
    expect(created.batch.unsupportedCount).toBe(1);
    expect(created.deepLinkUrl).toContain(`/transactions?tab=ai-inbox&batch=${created.batch.id}`);

    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(aggregate?.rows).toHaveLength(2);
    expect(aggregate?.unsupportedItems).toHaveLength(1);
    expect(aggregate?.events.map((event) => event.eventType)).toEqual(["batch_created", "preflight_run"]);
  });
});
