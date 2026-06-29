import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import type { HoldingSnapshot } from "../../src/persistence/types.js";

let app: AppInstance;
let persistence: MemoryPersistence;

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
  if (body.trim().startsWith("{")) {
    return JSON.parse(body) as T;
  }
  const dataLine = [...body.split("\n")].reverse().find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP response data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
}

function extractAnalysisPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.trim().startsWith("{")) {
      return extractAnalysisPayload(JSON.parse(value));
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractAnalysisPayload(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if ("deepLink" in record && "portfolioSeries" in record && "rankings" in record) {
    return record;
  }
  for (const nested of Object.values(record)) {
    const found = extractAnalysisPayload(nested);
    if (found !== undefined) return found;
  }
  return undefined;
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
        clientInfo: { name: "vitest", version: "1.0.0" },
      },
    },
  });
  expect(initialize.statusCode).toBe(200);
  const sessionId = initialize.headers["mcp-session-id"];
  expect(typeof sessionId).toBe("string");
  return String(sessionId);
}

async function callMcpTool(headers: Record<string, string>, sessionId: string, args: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      ...headers,
      "mcp-session-id": sessionId,
    },
    payload: {
      jsonrpc: "2.0",
      id: "call-1",
      method: "tools/call",
      params: {
        name: "get_unrealized_pnl_report",
        arguments: args,
      },
    },
  });
}

function makeSnapshot(overrides: Partial<HoldingSnapshot> = {}): HoldingSnapshot {
  return {
    id: `snap-${Math.random()}`,
    userId: "user-1",
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
    snapshotDate: "2026-03-01",
    quantity: 10,
    closePrice: 100,
    marketValue: 1000,
    costBasis: 1000,
    unrealizedPnl: 0,
    cumulativeRealizedPnl: 0,
    cumulativeDividends: 0,
    isProvisional: false,
    currency: "TWD",
    valueNative: 1000,
    costBasisNative: 1000,
    unrealizedPnlNative: 0,
    providerSource: "test",
    generatedAt: "2026-03-01T00:00:00.000Z",
    generationRunId: "run-1",
    ...overrides,
  };
}

beforeEach(async () => {
  app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  persistence = app.persistence as MemoryPersistence;
  const memory = persistence as MemoryPersistence & {
    _seedInstrument: (instrument: {
      ticker: string;
      marketCode: string;
      instrumentType: string;
      name: string;
      barsBackfillStatus: "ready";
    }, userId?: string) => void;
  };
  memory._seedInstrument({
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    name: "TSMC",
    barsBackfillStatus: "ready",
  }, "user-1");
  persistence._seedHoldingSnapshots([
    makeSnapshot({ snapshotDate: "2026-03-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
    makeSnapshot({ snapshotDate: "2026-03-31", unrealizedPnl: 120, unrealizedPnlNative: 120, marketValue: 1120, valueNative: 1120 }),
  ]);
});

afterEach(async () => {
  await app.close();
});

describe("unrealized P&L analysis API/MCP parity", () => {
  it("returns the same report shape through HTTP and MCP", async () => {
    const apiResponse = await app.inject({
      method: "GET",
      url: "/analysis/unrealized-pnl?granularity=monthly&fromDate=2026-03-01&toDate=2026-03-31&holdingsState=include_sold_out",
      headers: {
        "x-user-id": "user-1",
      },
    });
    expect(apiResponse.statusCode).toBe(200);
    const apiBody = apiResponse.json();

    const initializeHeaders = {
      accept: "application/json, text/event-stream",
      origin: "https://chatgpt.com",
    };
    const sessionId = await initializeMcpSession(initializeHeaders);
    const toolHeaders = {
      ...initializeHeaders,
      authorization: `Bearer ${devToken({
        userId: "user-1",
        sessionUserId: "user-1",
        clientId: "vakwen-dev-client",
        scopes: ["portfolio:mcp_read"],
      })}`,
    };
    const mcpCall = await callMcpTool(toolHeaders, sessionId, {
      granularity: "monthly",
      fromDate: "2026-03-01",
      toDate: "2026-03-31",
      holdingsState: "include_sold_out",
    });
    expect(mcpCall.statusCode).toBe(200);
    const mcpBody = parseMcpJson<{
      result: {
        structuredContent?: unknown;
        content?: Array<{ text?: string }>;
      };
    }>(mcpCall.body);
    const structuredContent = extractAnalysisPayload(mcpBody);

    expect(structuredContent).toEqual(apiBody);
  });
});
