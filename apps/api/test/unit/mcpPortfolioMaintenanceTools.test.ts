import { describe, expect, it } from "vitest";
import { getMcpToolDefinition, listMcpToolDefinitions } from "../../src/mcp/tools.js";

describe("MCP portfolio maintenance tools", () => {
  it("registers the locked tool family with read/write scopes", () => {
    const tools = listMcpToolDefinitions();
    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "refresh_portfolio_prices", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "preview_recompute_portfolio_fees", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "recompute_portfolio_fees", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "preview_replay_portfolio_positions", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "replay_portfolio_positions", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "backfill_tickers", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "get_replay_portfolio_positions_run", scope: "portfolio:mcp_read", accessKind: "read" }),
      expect.objectContaining({ name: "get_daily_snapshots", scope: "portfolio:mcp_read", accessKind: "read" }),
    ]));
  });

  it("requires explicit market identity for ticker filters", () => {
    const refresh = listMcpToolDefinitions().find((tool) => tool.name === "refresh_portfolio_prices");
    expect(refresh).toBeDefined();
    expect(refresh!.inputSchema.safeParse({
      portfolio: { label: "Self" },
      tickerMarkets: [{ ticker: "2330" }],
    }).success).toBe(false);
    expect(refresh!.inputSchema.safeParse({
      portfolio: { label: "Self" },
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    }).success).toBe(true);
  });

  it("does not expose unsupported ticker filters for fee recompute previews", () => {
    const preview = listMcpToolDefinitions().find((tool) => tool.name === "preview_recompute_portfolio_fees");
    expect(preview).toBeDefined();
    expect(preview!.inputSchema.safeParse({
      portfolio: { label: "Self" },
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    }).success).toBe(false);
    expect(preview!.inputSchema.safeParse({
      portfolio: { label: "Self" },
      accountNames: ["Main"],
    }).success).toBe(true);
  });

  it("accepts decimal source-provided booked charges up to 4 decimal places for draft candidates", () => {
    const createDraft = getMcpToolDefinition("create_transaction_draft_batch");

    expect(createDraft.inputSchema.safeParse({
      candidates: [{
        rowNumber: 1,
        recordType: "trade",
        accountId: "acc-1",
        type: "BUY",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-03",
        commissionAmount: 1.2345,
        taxAmount: 0.4321,
      }],
    }).success).toBe(true);

    expect(createDraft.inputSchema.safeParse({
      candidates: [{
        rowNumber: 1,
        recordType: "trade",
        accountId: "acc-1",
        type: "BUY",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-03",
        commissionAmount: 1.23456,
      }],
    }).success).toBe(false);
  });
});
