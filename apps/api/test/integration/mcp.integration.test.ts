import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

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

describe("mcp routes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    await app.close();
  });

  it("exposes MCP health and protected-resource metadata without cookie auth", async () => {
    const health = await app.inject({ method: "GET", url: "/mcp/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().transport).toBe("streamable_http");

    const metadata = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json().resource).toMatch(/\/mcp$/);
    expect(metadata.json().bearer_methods_supported).toEqual(["header"]);
  });

  it("rejects unauthenticated MCP requests before any cookie-based auth path", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/mcp",
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

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "mcp_auth_required" });
  });

  it("requires fresh auth for high-risk MCP admin settings changes", async () => {
    const missingFreshAuth = await app.inject({
      method: "PATCH",
      url: "/admin/mcp/settings",
      payload: { groupToggles: { read: false } },
    });
    expect(missingFreshAuth.statusCode).toBe(403);
    expect(missingFreshAuth.json()).toMatchObject({ error: "mcp_fresh_auth_required" });

    const forgedFreshAuth = await app.inject({
      method: "PATCH",
      url: "/admin/mcp/settings",
      headers: { "x-vakwen-fresh-auth-at": new Date().toISOString() },
      payload: { groupToggles: { read: false } },
    });
    expect(forgedFreshAuth.statusCode).toBe(400);
    expect(forgedFreshAuth.json()).toMatchObject({ error: "mcp_fresh_auth_invalid" });

    const freshAuth = await app.inject({
      method: "POST",
      url: "/admin/mcp/fresh-auth",
    });
    expect(freshAuth.statusCode).toBe(200);
    const { freshAuthToken } = freshAuth.json<{ freshAuthToken: string }>();

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/mcp/settings",
      headers: { "x-vakwen-fresh-auth-at": freshAuthToken },
      payload: { groupToggles: { read: false }, maxActiveConnectionsPerUser: 2 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      maxActiveConnectionsPerUser: 2,
      groupToggles: { read: false, drafts: true, write: false },
    });
  });

  it("records access logs for MCP policy denials", async () => {
    const token = devToken({ userId: "user-1", scopes: [] });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
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

    const call = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers,
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "get_portfolio_overview",
          arguments: {},
        },
      },
    });
    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("MCP scope portfolio:mcp_read is not enabled");

    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs[0]).toMatchObject({
      userId: "user-1",
      portfolioContextUserId: "user-1",
      toolName: "get_portfolio_overview",
      accessKind: "read",
      result: "denied",
      denialReason: "mcp_scope_denied",
    });
  });
});
