import { Buffer } from "node:buffer";
import type { APIRequestContext } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const mcpUrl = new URL("/mcp", TestEnv.apiBaseUrl).href;

function devToken(payload: Record<string, unknown>): string {
  return `vakwen-dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function parseMcpJson<T>(body: string): T {
  if (body.trim().startsWith("{")) return JSON.parse(body) as T;
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP SSE data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
}

async function initializeMcpSession(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<string> {
  const response = await request.post(mcpUrl, {
    headers,
    data: {
      jsonrpc: "2.0",
      id: "init-mcp-maintenance-aaa",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "Playwright", version: "1.0.0" },
      },
    },
  });
  if (response.status() !== 200) {
    throw new Error(`MCP initialize failed: ${response.status()} ${await response.text()}`);
  }
  const sessionId = response.headers()["mcp-session-id"];
  if (!sessionId) throw new Error("MCP initialize did not return mcp-session-id");
  return sessionId;
}

async function callMcpTool(
  request: APIRequestContext,
  headers: Record<string, string>,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await request.post(mcpUrl, {
    headers: {
      ...headers,
      "mcp-session-id": sessionId,
    },
    data: {
      jsonrpc: "2.0",
      id: `call-${name}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  if (response.status() !== 200) {
    throw new Error(`MCP ${name} failed: ${response.status()} ${await response.text()}`);
  }
  return response.text();
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertFieldEquals<T extends Record<string, unknown>>(
  value: T,
  field: keyof T,
  expected: unknown,
  label: string,
): void {
  if (value[field] !== expected) {
    throw new Error(`${label}: expected ${String(field)}=${String(expected)}, received ${String(value[field])}`);
  }
}

test.describe("MCP portfolio maintenance", () => {
  test("[mcp maintenance]: reads daily snapshots and gates write tools by portfolio selector", async ({ request }) => {
    const session = await createOauthSession(request, {
      sub: "mcp-maintenance-owner-sub",
      email: "mcp-maintenance-owner@example.com",
      name: "MCP Maintenance Owner",
      role: "admin",
    });
    const headers = {
      authorization: `Bearer ${devToken({ userId: session.userId, scopes: ["portfolio:mcp_read", "transaction:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(request, headers);

    const snapshotsText = await callMcpTool(request, headers, sessionId, "get_daily_snapshots", {
      limit: 5,
      offset: 0,
    });
    const snapshots = parseMcpJson<{
      result: {
        structuredContent: {
          rows: unknown[];
          summary: { total: number; limit: number; offset: number; hasMore: boolean };
        };
      };
    }>(snapshotsText);
    assertCondition(Array.isArray(snapshots.result.structuredContent.rows), "daily snapshots rows must be an array");
    assertCondition(typeof snapshots.result.structuredContent.summary.total === "number", "daily snapshots total must be numeric");
    assertCondition(typeof snapshots.result.structuredContent.summary.hasMore === "boolean", "daily snapshots hasMore must be boolean");
    assertFieldEquals(snapshots.result.structuredContent.summary, "limit", 5, "daily snapshots summary");
    assertFieldEquals(snapshots.result.structuredContent.summary, "offset", 0, "daily snapshots summary");

    const refreshText = await callMcpTool(request, headers, sessionId, "refresh_portfolio_prices", {});
    const refresh = parseMcpJson<{
      result: { structuredContent: { code: string; statusCode: number } };
    }>(refreshText);
    assertFieldEquals(refresh.result.structuredContent, "code", "mcp_portfolio_required", "refresh_portfolio_prices error");
    assertFieldEquals(refresh.result.structuredContent, "statusCode", 400, "refresh_portfolio_prices error");
  });
});
