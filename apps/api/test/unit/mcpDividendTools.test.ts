import { describe, expect, it } from "vitest";
import { listMcpToolDefinitions } from "../../src/mcp/tools.js";

describe("MCP dividend tools", () => {
  it("registers dividend review and operation tools with locked scopes", () => {
    const tools = listMcpToolDefinitions();

    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "get_dividend_review", scope: "portfolio:mcp_read", accessKind: "read" }),
      expect.objectContaining({ name: "preview_post_dividend_receipt", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "post_dividend_receipt", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "preview_amend_dividend_receipt", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "amend_dividend_receipt", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "preview_update_dividend_reconciliation", scope: "transaction:write", accessKind: "write" }),
      expect.objectContaining({ name: "update_dividend_reconciliation", scope: "transaction:write", accessKind: "write" }),
    ]));
  });

  it("requires explicit ticker market identity for dividend review filters", () => {
    const tool = listMcpToolDefinitions().find((item) => item.name === "get_dividend_review");
    expect(tool).toBeDefined();

    expect(tool!.inputSchema.safeParse({
      tickerMarkets: [{ ticker: "2330" }],
    }).success).toBe(false);
    expect(tool!.inputSchema.safeParse({
      tickerMarkets: [{ ticker: "2330", marketCode: "TW" }],
    }).success).toBe(true);
  });

  it("rejects zero-amount dividend deductions", () => {
    const tool = listMcpToolDefinitions().find((item) => item.name === "preview_post_dividend_receipt");
    expect(tool).toBeDefined();

    expect(tool!.inputSchema.safeParse({
      rowId: "row-1",
      deductions: [{ deductionType: "WITHHOLDING_TAX", amount: 0 }],
    }).success).toBe(false);
    expect(tool!.inputSchema.safeParse({
      rowId: "row-1",
      deductions: [{ deductionType: "WITHHOLDING_TAX", amount: 1 }],
    }).success).toBe(true);
  });
});
