import { describe, expect, it } from "vitest";
import { listMcpToolDefinitions } from "../../src/mcp/tools.js";

describe("MCP report tools", () => {
  it("registers descriptive report read tools under portfolio:mcp_read", () => {
    const tools = listMcpToolDefinitions();
    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "get_daily_review_report",
        scope: "portfolio:mcp_read",
        accessKind: "read",
      }),
      expect.objectContaining({
        name: "get_portfolio_report",
        scope: "portfolio:mcp_read",
        accessKind: "read",
      }),
      expect.objectContaining({
        name: "get_market_report",
        scope: "portfolio:mcp_read",
        accessKind: "read",
      }),
    ]));

    const descriptions = tools
      .filter((tool) => tool.name === "get_daily_review_report" || tool.name === "get_portfolio_report" || tool.name === "get_market_report")
      .map((tool) => tool.description);
    for (const description of descriptions) {
      expect(description).toContain("Descriptive");
      expect(description).toContain("buy/sell/hold");
      expect(description).toContain("rebalancing advice");
    }

    for (const tool of tools.filter((item) => item.name.startsWith("get_") && item.name.endsWith("_report"))) {
      const parsed = tool.inputSchema.safeParse({
        currencyMode: "specified",
        currency: "AUD",
        reportingCurrency: "AUD",
      });
      expect(parsed.success).toBe(true);
    }
  });
});
