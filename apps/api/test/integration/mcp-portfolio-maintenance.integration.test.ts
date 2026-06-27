import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";

let app: Awaited<ReturnType<typeof buildApp>>;

const testOAuthConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-at-least-32-chars",
};

function devToken(payload: Record<string, unknown>): string {
  return `vakwen-dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function parseMcpJson<T>(body: string): T {
  if (body.trim().startsWith("{")) return JSON.parse(body) as T;
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP SSE data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
}

async function initializeMcpSession(headers: Record<string, string>) {
  const initialize = await app.inject({
    method: "POST",
    url: "/mcp",
    headers,
    payload: {
      jsonrpc: "2.0",
      id: "init-1",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "ChatGPT", version: "1.0.0" },
      },
    },
  });
  expect(initialize.statusCode).toBe(200);
  const sessionId = initialize.headers["mcp-session-id"];
  expect(typeof sessionId).toBe("string");
  return String(sessionId);
}

async function callMcpTool(
  headers: Record<string, string>,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: { ...headers, "mcp-session-id": sessionId },
    payload: {
      jsonrpc: "2.0",
      id: `call-${name}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
}

async function getSelfPortfolio(headers: Record<string, string>, sessionId: string) {
  const response = await callMcpTool(headers, sessionId, "list_portfolio_contexts", {});
  expect(response.statusCode).toBe(200);
  const body = parseMcpJson<{
    result: {
      structuredContent: {
        portfolios: Array<{ label: string; email: string | null; isSelf: boolean }>;
      };
    };
  }>(response.body);
  const self = body.result.structuredContent.portfolios.find((portfolio) => portfolio.isSelf);
  expect(self).toBeDefined();
  return { label: self!.label, ...(self!.email ? { email: self!.email } : {}) };
}

describe("mcp portfolio maintenance tools", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    await app.close();
  });

  it("[catalog]: advertises maintenance tools with OAuth scopes through MCP discovery", async () => {
    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["portfolio:mcp_read", "transaction:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...headers, "mcp-session-id": sessionId },
      payload: { jsonrpc: "2.0", id: "list-1", method: "tools/list" },
    });
    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: {
        tools: Array<{ name: string; securitySchemes?: unknown; annotations?: { readOnlyHint?: boolean } }>;
      };
    }>(response.body);
    const tools = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    expect(tools.get("refresh_portfolio_prices")?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["transaction:write"] }]);
    expect(tools.get("replay_portfolio_positions")?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["transaction:write"] }]);
    expect(tools.get("get_daily_snapshots")?.securitySchemes).toEqual([{ type: "oauth2", scopes: ["portfolio:mcp_read"] }]);
    expect(tools.get("get_replay_portfolio_positions_run")?.annotations?.readOnlyHint).toBe(true);
  });

  it("[write gate]: requires portfolio selector before policy evaluation", async () => {
    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["portfolio:mcp_read", "transaction:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const response = await callMcpTool(headers, sessionId, "refresh_portfolio_prices", {});
    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{ result: { structuredContent: { code: string; statusCode: number } } }>(response.body);
    expect(body.result.structuredContent).toMatchObject({
      code: "mcp_portfolio_required",
      statusCode: 400,
    });
  });

  it("[auth]: denies maintenance mutations without transaction:write", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["portfolio:mcp_read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const portfolio = await getSelfPortfolio(headers, sessionId);
    const response = await callMcpTool(headers, sessionId, "refresh_portfolio_prices", { portfolio });
    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: {
        isError?: boolean;
        content?: Array<{ text?: string }>;
        _meta?: { "mcp/www_authenticate"?: string[] };
      };
    }>(response.body);
    expect(body.result.isError).toBe(true);
    expect(body.result.content?.[0]?.text).toContain("Authorization required");
    expect(body.result._meta?.["mcp/www_authenticate"]?.[0]).toContain("scope=\"transaction:write\"");
  });

  it("[snapshots]: returns holding snapshots through the read MCP tool", async () => {
    (app.persistence as MemoryPersistence)._seedHoldingSnapshots([{
      id: "mcp-snapshot-1",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      snapshotDate: "2026-06-25",
      quantity: 1,
      closePrice: 100,
      marketValue: 100,
      costBasis: 90,
      unrealizedPnl: 10,
      cumulativeRealizedPnl: 0,
      cumulativeDividends: 0,
      isProvisional: false,
      currency: "TWD",
      valueNative: 100,
      costBasisNative: 90,
      unrealizedPnlNative: 10,
      providerSource: "test",
      generatedAt: "2026-06-25T00:00:00.000Z",
      generationRunId: "mcp-snapshot-run",
    }]);
    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["portfolio:mcp_read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const response = await callMcpTool(headers, sessionId, "get_daily_snapshots", {
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      limit: 10,
    });
    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: {
        structuredContent: {
          rows: Array<{ id: string; ticker: string; marketCode: string; accountName: string | null }>;
          summary: { total: number; provisionalCount: number; hasMore: boolean };
        };
      };
    }>(response.body);
    expect(body.result.structuredContent.rows).toEqual([
      expect.objectContaining({
        id: "mcp-snapshot-1",
        ticker: "2330",
        marketCode: "TW",
        accountName: "Main",
      }),
    ]);
    expect(body.result.structuredContent.summary).toEqual(expect.objectContaining({
      total: 1,
      provisionalCount: 0,
      hasMore: false,
    }));
  });
});
