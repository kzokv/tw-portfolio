import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAiConnectorConnection } from "../../src/services/mcpConnectorLifecycle.js";
import { createTransactionDraftBatch } from "../../src/services/mcpDrafts.js";
import type { McpRequestContext } from "../../src/mcp/types.js";
import { mcpDevTokenAllowedForRuntime } from "../../src/mcp/auth.js";

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
        "transaction:write",
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
    expect(response.headers["www-authenticate"]).toContain("resource_metadata=");
  });

  it("keeps unsigned dev MCP bearer tokens out of production runtime", () => {
    expect(mcpDevTokenAllowedForRuntime("production")).toBe(false);
    expect(mcpDevTokenAllowedForRuntime("development")).toBe(true);
    expect(mcpDevTokenAllowedForRuntime("test")).toBe(true);
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
      payload: {
        groupToggles: { read: false },
        maxActiveConnectionsPerUser: 2,
        oauthRedirectUriAllowlist: ["https://connector.example.com/oauth/callback"],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      maxActiveConnectionsPerUser: 2,
      groupToggles: { read: false, drafts: true, write: false },
      oauthRedirectUriAllowlist: ["https://connector.example.com/oauth/callback"],
    });
  });

  it("revokes existing ChatGPT OAuth connectors when the MCP OAuth token secret changes", async () => {
    await app.persistence.saveAiConnectorConnection({
      id: "chatgpt-connection-1",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      scopes: ["portfolio:mcp_read"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await app.persistence.saveAiConnectorCredential({
      id: "refresh-credential-1",
      connectionId: "chatgpt-connection-1",
      credentialType: "oauth_refresh_token",
      tokenHash: "token-hash-1",
      tokenFamilyId: "family-1",
      oauthClientId: "chatgpt",
      resource: "http://localhost:4000/mcp",
      scopes: ["portfolio:mcp_read"],
      sessionVersion: 1,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const freshAuth = await app.inject({ method: "POST", url: "/admin/mcp/fresh-auth" });
    const { freshAuthToken } = freshAuth.json<{ freshAuthToken: string }>();
    const response = await app.inject({
      method: "PATCH",
      url: "/admin/mcp/settings",
      headers: { "x-vakwen-fresh-auth-at": freshAuthToken },
      payload: { mcpOauthTokenSecret: "rotated-mcp-oauth-token-secret-that-is-long-enough" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ oauthTokenSecretSet: true });

    const connection = await app.persistence.getAiConnectorConnection("chatgpt-connection-1");
    expect(connection).toMatchObject({
      status: "revoked",
      revocationReason: "mcp_oauth_secret_rotated",
    });
    const credential = await app.persistence.getAiConnectorCredentialByHash("token-hash-1");
    expect(credential?.revokedAt).toBeTruthy();
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

  it("authenticates an active ChatGPT connector and records successful MCP tool access", async () => {
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "transaction_draft:create"],
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: "user-1", connectionId: connection.id, clientId: "chatgpt" });
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
          clientInfo: { name: "ChatGPT", version: "1.0.0" },
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
    expect(call.body).toContain("portfolio");
    expect(call.body).not.toContain("mcp_scope_denied");

    const saved = await app.persistence.getAiConnectorConnection(connection.id);
    expect(saved?.lastUsedAt).not.toBeNull();
    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs[0]).toMatchObject({
      connectionId: connection.id,
      userId: "user-1",
      portfolioContextUserId: "user-1",
      toolName: "get_portfolio_overview",
      accessKind: "read",
      result: "ok",
    });
  });

  it("exposes and revokes ChatGPT connector connections through the user API", async () => {
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "transaction_draft:create"],
        toolToggles: { get_portfolio_overview: true },
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );

    const list = await app.inject({ method: "GET", url: "/ai/connectors" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      connections: [
        {
          id: connection.id,
          provider: "chatgpt",
          displayName: "ChatGPT",
          status: "active",
          scopes: ["portfolio:mcp_read", "transaction_draft:create"],
        },
      ],
      policy: {
        enabled: true,
        allowedProviders: { chatgpt: true },
      },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connection.id}`,
      payload: {
        scopes: ["portfolio:mcp_read"],
        toolToggles: { get_portfolio_overview: false },
        expiresAt: null,
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: connection.id,
      scopes: ["portfolio:mcp_read"],
      toolToggles: { get_portfolio_overview: false },
      expiresAt: null,
    });

    const revoked = await app.inject({
      method: "DELETE",
      url: `/ai/connectors/${connection.id}`,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      id: connection.id,
      status: "revoked",
      revocationReason: "user_revoked",
    });
  });

  it("preserves null draft-row patches so optional values can be cleared from the review UI", async () => {
    const created = await createTransactionDraftBatch(
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
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
            commissionAmount: 5,
            taxAmount: 1,
            note: "remove me",
            sourceSnippet: "raw row",
          },
        ],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate?.rows[0];
    expect(row).toBeDefined();

    const patched = await app.inject({
      method: "PATCH",
      url: `/ai/transaction-drafts/${created.batch.id}/rows/${row!.id}`,
      payload: {
        expectedVersion: row!.version,
        patch: {
          commissionAmount: null,
          taxAmount: null,
          note: null,
          sourceSnippet: null,
        },
      },
    });

    expect(patched.statusCode).toBe(200);
    const body = patched.json<{ rows: Array<{ id: string; commissionAmount: number | null; taxAmount: number | null; note: string | null; sourceSnippet: string | null }> }>();
    expect(body.rows[0]).toMatchObject({
      id: row!.id,
      commissionAmount: null,
      taxAmount: null,
      note: null,
      sourceSnippet: null,
    });
  });
});
