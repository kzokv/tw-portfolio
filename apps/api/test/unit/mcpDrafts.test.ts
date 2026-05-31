import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import {
  createTransactionDraftBatch,
  postTransactionDraftRows,
  preflightTransactionDraftCandidates,
} from "../../src/services/mcpDrafts.js";
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
        provenance: {
          sourceType: "csv",
          files: [{ fileId: "unit-test-file", sourceType: "csv", displayName: "unit-test.csv" }],
        },
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

  it("infers account metadata from a unique account name and preserves explicit zero fees", async () => {
    const result = await preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountName: "Main",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
            commissionAmount: 0,
            taxAmount: 0,
          },
        ],
      },
    );

    expect(result.summary.blockingRowCount).toBe(0);
    expect(result.rows[0]).toMatchObject({
      state: "ready",
      warnings: expect.arrayContaining([
        "account inferred from unique account name",
        "marketCode inferred from account",
        "priceCurrency inferred from account",
      ]),
      normalized: {
        accountId: "acc-1",
        accountNameInput: "Main",
        marketCode: "TW",
        priceCurrency: "TWD",
        commissionAmount: 0,
        taxAmount: 0,
      },
    });
  });

  it("blocks ambiguous account names before batch creation", async () => {
    const store = await app.persistence.loadStore("user-1");
    const duplicateFeeProfile = {
      ...store.feeProfiles[0]!,
      id: "fp-duplicate-main",
      accountId: "acc-duplicate-main",
    };
    store.feeProfiles.push(duplicateFeeProfile);
    store.accounts.push({
      ...store.accounts[0]!,
      id: "acc-duplicate-main",
      name: "Main",
      defaultCurrency: "USD",
      feeProfileId: duplicateFeeProfile.id,
    });
    await app.persistence.saveStore(store);

    const result = await preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountName: "Main",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
          },
        ],
      },
    );

    expect(result.summary.blockingRowCount).toBe(1);
    expect(result.rows[0]?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ambiguous_account" }),
      ]),
    );
  });

  it("rejects raw source payloads and overlong provenance snippets", async () => {
    await expect(preflightTransactionDraftCandidates(
      { app, requestContext: createRequestContext() },
      {
        provenance: {
          sourceType: "csv",
          files: [{
            fileId: "file-1",
            sourceType: "csv",
            snippet: "2330,1",
          }],
        },
        candidates: [{
          rowNumber: 1,
          recordType: "trade",
          accountId: "acc-1",
          type: "BUY",
          ticker: "2330",
          quantity: 1,
          unitPrice: 100,
          tradeDate: "2026-01-03",
          rawPayload: { csv: "ticker,qty\n2330,1" },
        } as never],
      } as never,
    )).rejects.toMatchObject({
      code: "mcp_raw_source_payload_forbidden",
    });
  });

  it("posts selected ready rows with version checks, idempotency, and compact result", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        provenance: {
          sourceType: "csv",
          files: [{
            fileId: "file-1",
            sourceType: "csv",
            displayName: "import.csv",
            snippet: "2330,BUY,1,100",
          }],
        },
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
            sourceMetadata: { fileId: "file-1", rowRef: "1", snippet: "2330,BUY,1,100" },
          },
          {
            rowNumber: 2,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 2,
            unitPrice: 101,
            tradeDate: "2026-01-04",
            sourceMetadata: { fileId: "file-1", rowRef: "2", snippet: "2330,BUY,2,101" },
          },
        ],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(aggregate).toBeTruthy();

    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });

    const posted = await postTransactionDraftRows(
      { app, requestContext: createRequestContext() },
      {
        batchId: created.batch.id,
        rowIds: [aggregate!.rows[0]!.id],
        expectedBatchVersion: aggregate!.batch.version,
        expectedRowVersions: [{ rowId: aggregate!.rows[0]!.id, expectedVersion: aggregate!.rows[0]!.version }],
        idempotencyKey: "mcp-post-rows-1",
      },
    );

    expect(posted.outcome).toBe("posted");
    expect(posted.postedRowIds).toEqual([aggregate!.rows[0]!.id]);
    expect(posted.createdTransactionIds).toHaveLength(1);
    expect(posted.remainingUnresolvedRowIds).toEqual([]);
    expect(posted.batchVersion).toBeGreaterThan(aggregate!.batch.version);

    const updated = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(updated?.rows.find((row) => row.id === aggregate!.rows[0]!.id)).toMatchObject({
      state: "confirmed",
      confirmedTradeEventId: posted.createdTransactionIds[0],
    });
    expect(updated?.events.at(-1)).toMatchObject({
      eventType: "rows_confirmed",
      metadata: expect.objectContaining({
        source: "mcp_tool",
        postedRowIds: [aggregate!.rows[0]!.id],
      }),
    });
  });

  it("rejects duplicate row IDs before creating canonical transactions", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        provenance: {
          sourceType: "csv",
          files: [{
            fileId: "file-1",
            sourceType: "csv",
            displayName: "import.csv",
            snippet: "2330,BUY,1,100",
          }],
        },
        candidates: [{
          rowNumber: 1,
          recordType: "trade",
          accountId: "acc-1",
          type: "BUY",
          ticker: "2330",
          quantity: 1,
          unitPrice: 100,
          tradeDate: "2026-01-03",
          sourceMetadata: { fileId: "file-1", rowRef: "1", snippet: "2330,BUY,1,100" },
        }],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate!.rows[0]!;
    const before = await app.persistence.loadStore("user-1");

    await expect(postTransactionDraftRows(
      { app, requestContext: createRequestContext() },
      {
        batchId: created.batch.id,
        rowIds: [row.id, row.id],
        expectedBatchVersion: aggregate!.batch.version,
        expectedRowVersions: [{ rowId: row.id, expectedVersion: row.version }],
        idempotencyKey: "mcp-post-duplicate-row",
      },
    )).rejects.toMatchObject({
      code: "mcp_draft_duplicate_row_id",
    });

    const after = await app.persistence.loadStore("user-1");
    expect(after.accounting.facts.tradeEvents).toHaveLength(before.accounting.facts.tradeEvents.length);
    const refreshed = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(refreshed?.rows[0]).toMatchObject({ state: "ready", version: row.version });
  });
});
