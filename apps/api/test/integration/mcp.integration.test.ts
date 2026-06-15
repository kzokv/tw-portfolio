import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAiConnectorConnection } from "../../src/services/mcpConnectorLifecycle.js";
import { createTransactionDraftBatch } from "../../src/services/mcpDrafts.js";
import type { McpRequestContext } from "../../src/mcp/types.js";
import { mcpDevTokenAllowedForRuntime } from "../../src/mcp/auth.js";
import { listMcpToolDefinitions } from "../../src/mcp/tools.js";

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
  if (body.trim().startsWith("{")) {
    return JSON.parse(body) as T;
  }
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP SSE data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
}

function expectChatGptSafeSchema(schema: unknown): void {
  // ChatGPT drops the action list when descriptors contain unsupported schema keywords.
  const serialized = JSON.stringify(schema);
  expect(serialized).not.toContain("\"$ref\"");
  expect(serialized).not.toContain("\"$schema\"");
  expect(serialized).not.toContain("\"default\"");
  expect(serialized).not.toContain("\"exclusiveMinimum\"");
  expect(serialized).not.toContain("\"format\"");
  expect(serialized).not.toContain("\"multipleOf\"");
  expect(serialized).not.toContain("\"pattern\"");
}

function expectedToolOutputTemplate(toolName: string): string {
  if (toolName === "get_account_manager_component") return `${app.appBaseUrl}/connectors/chatgpt/account-manager`;
  if (toolName === "get_transaction_draft_batch_component") return `${app.appBaseUrl}/connectors/chatgpt/transaction-draft`;
  return "ui://widget/vakwen.html";
}

function expectedToolWidgetAccessible(toolName: string): boolean {
  return toolName === "get_account_manager_component" || toolName === "get_transaction_draft_batch_component";
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
    headers: {
      ...headers,
      "mcp-session-id": sessionId,
    },
    payload: {
      jsonrpc: "2.0",
      id: "call-1",
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
  });
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

    const pathScopedMetadata = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource/mcp" });
    expect(pathScopedMetadata.statusCode).toBe(200);
    expect(pathScopedMetadata.json()).toMatchObject(metadata.json());
  });

  it("allows unauthenticated MCP discovery but rejects unauthenticated tool execution", async () => {
    const initialize = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        origin: "https://chatgpt.com",
      },
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
    expect(initialize.headers["content-type"]).toContain("application/json");
    expect(initialize.headers["access-control-allow-origin"]).toBe("https://chatgpt.com");
    expect(initialize.headers["access-control-expose-headers"]).toContain("mcp-session-id");
    const sessionId = initialize.headers["mcp-session-id"];
    expect(typeof sessionId).toBe("string");

    const listTools = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        origin: "https://chatgpt.com",
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "list-1",
        method: "tools/list",
      },
    });

    expect(listTools.statusCode).toBe(200);
    expect(listTools.headers["content-type"]).toContain("application/json");
    expect(listTools.headers["access-control-allow-origin"]).toBe("https://chatgpt.com");
    expect(listTools.headers["access-control-expose-headers"]).toContain("mcp-session-id");
    const body = parseMcpJson<{
      result: {
        tools: Array<{
          name: string;
          title?: string;
          inputSchema?: unknown;
          securitySchemes?: unknown;
          outputSchema?: { type?: string };
          annotations?: unknown;
          execution?: unknown;
          _meta?: {
            securitySchemes?: unknown;
            ui?: { resourceUri?: string; visibility?: string[] };
            "openai/outputTemplate"?: string;
            "openai/widgetAccessible"?: boolean;
          };
        }>;
      };
    }>(listTools.body);
    const overviewTool = body.result.tools.find((tool) => tool.name === "get_portfolio_overview");
    expect(overviewTool?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["portfolio:mcp_read"] },
    ]);
    expect(overviewTool?.execution).toBeUndefined();
    expect(overviewTool?.title).toBe("Get Portfolio Overview");
    expect(overviewTool?.outputSchema).toMatchObject({ type: "object" });
    expectChatGptSafeSchema(overviewTool?.inputSchema);
    expectChatGptSafeSchema(overviewTool?.outputSchema);
    expect(overviewTool?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(overviewTool?._meta?.ui).toEqual({
      resourceUri: "ui://widget/vakwen.html",
      visibility: ["model", "app"],
    });
    expect(overviewTool?._meta?.["openai/outputTemplate"]).toBe("ui://widget/vakwen.html");

    const readWidget = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "resource-1",
        method: "resources/read",
        params: { uri: "ui://widget/vakwen.html" },
      },
    });
    expect(readWidget.statusCode).toBe(200);
    const widgetBody = parseMcpJson<{
      result: {
        contents: Array<{
          uri: string;
          mimeType?: string;
          text?: string;
        }>;
      };
    }>(readWidget.body);
    expect(widgetBody.result.contents[0]).toMatchObject({
      uri: "ui://widget/vakwen.html",
      mimeType: "text/html;profile=mcp-app",
    });
    expect(widgetBody.result.contents[0]?.text).toContain("<title>Vakwen</title>");

    const call = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
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
    const callBody = parseMcpJson<{
      result: {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
        _meta?: { "mcp/www_authenticate"?: string[] };
      };
    }>(call.body);
    expect(callBody.result.isError).toBe(true);
    expect(callBody.result.content?.[0]?.text).toContain("Authentication required");
    expect(callBody.result._meta?.["mcp/www_authenticate"]?.[0]).toContain("/.well-known/oauth-protected-resource/mcp");
    expect(callBody.result._meta?.["mcp/www_authenticate"]?.[0]).toContain("scope=\"portfolio:mcp_read\"");
    expect(callBody.result._meta?.["mcp/www_authenticate"]?.[0]).toContain("error=\"invalid_token\"");
  });

  it("keeps unsigned dev MCP bearer tokens out of production runtime", () => {
    expect(mcpDevTokenAllowedForRuntime("production")).toBe(false);
    expect(mcpDevTokenAllowedForRuntime("development")).toBe(true);
    expect(mcpDevTokenAllowedForRuntime("test")).toBe(true);
  });

  it("advertises OAuth security schemes on MCP tool descriptors", async () => {
    const token = devToken({
      userId: "user-1",
      scopes: [
        "portfolio:mcp_read",
        "transaction_draft:create",
        "transaction_draft:edit",
        "transaction_draft:archive",
        "transaction_draft:delete",
        "transaction:write",
      ],
    });
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

    const listTools = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers,
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "list-1",
        method: "tools/list",
      },
    });
    expect(listTools.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: {
        tools: Array<{
          name: string;
          inputSchema?: unknown;
          securitySchemes?: unknown;
          execution?: unknown;
          outputSchema?: { type?: string };
          annotations?: unknown;
          _meta?: {
            securitySchemes?: unknown;
            ui?: { resourceUri?: string; visibility?: string[] };
            "openai/outputTemplate"?: string;
            "openai/widgetAccessible"?: boolean;
          };
        }>;
      };
    }>(listTools.body);
    const toolsByName = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    for (const tool of listMcpToolDefinitions()) {
      const listedTool = toolsByName.get(tool.name);
      const expectedSecuritySchemes = [{ type: "oauth2", scopes: [tool.scope] }];
      expect(listedTool?.securitySchemes).toEqual(expectedSecuritySchemes);
      expect(listedTool?.execution).toBeUndefined();
      expect(listedTool?._meta?.securitySchemes).toEqual(expectedSecuritySchemes);
      expect(listedTool?.outputSchema).toMatchObject({ type: "object" });
      expectChatGptSafeSchema(listedTool?.inputSchema);
      expectChatGptSafeSchema(listedTool?.outputSchema);
      expect(listedTool?.annotations).toEqual(tool.annotations);
      const expectedOutputTemplate = expectedToolOutputTemplate(tool.name);
      expect(listedTool?._meta?.ui).toEqual({
        resourceUri: expectedOutputTemplate,
        visibility: ["model", "app"],
      });
      expect(listedTool?._meta?.["openai/outputTemplate"]).toBe(expectedOutputTemplate);
      expect(listedTool?._meta?.["openai/widgetAccessible"]).toBe(expectedToolWidgetAccessible(tool.name));
    }

    const readWidget = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers,
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "resource-1",
        method: "resources/read",
        params: { uri: "ui://widget/vakwen.html" },
      },
    });
    expect(readWidget.statusCode).toBe(200);
    const widgetBody = parseMcpJson<{
      result: {
        contents: Array<{
          uri: string;
          mimeType?: string;
          text?: string;
          _meta?: {
            ui?: { csp?: { connectDomains?: string[]; resourceDomains?: string[] } };
            "openai/widgetDescription"?: string;
          };
        }>;
      };
    }>(readWidget.body);
    expect(widgetBody.result.contents[0]).toMatchObject({
      uri: "ui://widget/vakwen.html",
      mimeType: "text/html;profile=mcp-app",
    });
    expect(widgetBody.result.contents[0]?.text).toContain("<title>Vakwen</title>");
    expect(widgetBody.result.contents[0]?._meta?.ui?.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
    });
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

  it("attributes shared-context MCP access logs to the owner context and share record", async () => {
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "shared-mcp-user", {
      email: "shared-mcp@example.com",
      name: "Shared MCP User",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: sharedUserId,
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read"],
      },
      { actorUserId: sharedUserId, ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: sharedUserId, connectionId: connection.id, clientId: "chatgpt" });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);

    const call = await callMcpTool(headers, sessionId, "get_portfolio_overview", {
      portfolioContextUserId: "user-1",
    });

    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("portfolio");

    const logs = await app.persistence.listAiConnectorAccessLogsForUser(sharedUserId);
    expect(logs[0]).toMatchObject({
      connectionId: connection.id,
      userId: sharedUserId,
      portfolioContextUserId: "user-1",
      shareId: share.id,
      toolName: "get_portfolio_overview",
      accessKind: "read",
      result: "ok",
    });
  });

  it("requires shared account:manage for MCP account create, update, soft-delete, and restore", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });

    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "shared-account-manager-user", {
      email: "shared-account-manager@example.com",
      name: "Shared Account Manager",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: sharedUserId,
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "account:manage"],
      },
      { actorUserId: sharedUserId, ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: sharedUserId, connectionId: connection.id, clientId: "chatgpt" });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);

    const denied = await callMcpTool(headers, sessionId, "create_account", {
      portfolioContextUserId: "user-1",
      name: "Delegated MCP Account",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.body).toContain("Shared portfolio capability account:manage is not enabled");

    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "account:manage"],
      grantedByUserId: "user-1",
    });

    const created = await callMcpTool(headers, sessionId, "create_account", {
      portfolioContextUserId: "user-1",
      name: "Delegated MCP Account",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(created.statusCode).toBe(200);
    expect(created.body).toContain("Delegated MCP Account");

    const ownerStore = await app.persistence.loadStore("user-1");
    const account = ownerStore.accounts.find((item) => item.name === "Delegated MCP Account");
    expect(account).toBeDefined();

    const updated = await callMcpTool(headers, sessionId, "update_account", {
      portfolioContextUserId: "user-1",
      accountId: account!.id,
      name: "Delegated MCP Account Updated",
      accountType: "wallet",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.body).toContain("Delegated MCP Account Updated");

    const deleted = await callMcpTool(headers, sessionId, "soft_delete_account", {
      portfolioContextUserId: "user-1",
      accountId: account!.id,
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.body).toContain(account!.id);

    const restored = await callMcpTool(headers, sessionId, "restore_account", {
      portfolioContextUserId: "user-1",
      accountId: account!.id,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.body).toContain(account!.id);

    const auditLog = (app.persistence as unknown as {
      auditLog: Array<{ action: string; actorUserId: string | null; targetUserId: string | null; metadata: Record<string, unknown> }>;
    }).auditLog;
    expect(auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delegated_portfolio_write",
          actorUserId: sharedUserId,
          targetUserId: "user-1",
          metadata: expect.objectContaining({
            source: "mcp_tool",
            shareId: share.id,
            ownerUserId: "user-1",
            mutation: "account_created",
          }),
        }),
        expect.objectContaining({
          action: "account_soft_deleted",
          actorUserId: sharedUserId,
          targetUserId: "user-1",
          metadata: expect.objectContaining({
            source: "mcp_tool",
            shareId: share.id,
          }),
        }),
        expect.objectContaining({
          action: "account_restored",
          actorUserId: sharedUserId,
          targetUserId: "user-1",
          metadata: expect.objectContaining({
            source: "mcp_tool",
            shareId: share.id,
          }),
        }),
      ]),
    );
  });

  it("requires transaction:write for shared-context AI draft posting and allows it once the share enables write", async () => {
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "shared-write-user", {
      email: "shared-write@example.com",
      name: "Shared Write User",
    });
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "shared review",
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-05",
          },
        ],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate?.rows[0];
    expect(row).toBeDefined();

    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "transaction_draft:edit"],
      grantedByUserId: "user-1",
    });

    const denied = await app.inject({
      method: "POST",
      url: `/ai/transaction-drafts/${created.batch.id}/confirm`,
      headers: {
        "x-user-id": sharedUserId,
        "x-context-user-id": "user-1",
      },
      payload: {
        rowIds: [row!.id],
        expectedRowVersions: [{ rowId: row!.id, expectedVersion: row!.version }],
        expectedBatchVersion: created.batch.version,
        idempotencyKey: "shared-denied-post-1",
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "transaction:write",
        routeKey: "POST /ai/transaction-drafts/:batchId/confirm",
      },
    });

    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "transaction_draft:edit", "transaction:write"],
      grantedByUserId: "user-1",
    });

    const allowed = await app.inject({
      method: "POST",
      url: `/ai/transaction-drafts/${created.batch.id}/confirm`,
      headers: {
        "x-user-id": sharedUserId,
        "x-context-user-id": "user-1",
      },
      payload: {
        rowIds: [row!.id],
        expectedRowVersions: [{ rowId: row!.id, expectedVersion: row!.version }],
        expectedBatchVersion: created.batch.version,
        idempotencyKey: "shared-allowed-post-1",
      },
    });
    expect(allowed.statusCode).toBe(200);
    const body = allowed.json<{ rows: Array<{ id: string; state: string; confirmedTradeEventId: string | null }> }>();
    expect(body.rows[0]).toMatchObject({
      id: row!.id,
      state: "confirmed",
    });
    expect(body.rows[0]?.confirmedTradeEventId).toBeTruthy();

    const auditLog = (app.persistence as unknown as {
      auditLog: Array<{ action: string; actorUserId: string | null; targetUserId: string | null; metadata: Record<string, unknown> }>;
    }).auditLog;
    expect(auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delegated_portfolio_write",
          actorUserId: sharedUserId,
          targetUserId: "user-1",
          metadata: expect.objectContaining({
            mutation: "transaction_draft_rows_posted",
            routeKey: "POST /ai/transaction-drafts/:batchId/confirm",
            batchId: created.batch.id,
            rowIds: [row!.id],
            shareId: share.id,
            source: "shared_context",
          }),
        }),
      ]),
    );
  });

  it("omits internal raw and normalized payloads from AI draft detail DTOs", async () => {
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
            tradeDate: "2026-01-06",
            sourceMetadata: { fileId: "file-1", rowRef: "1", snippet: "BUY,2330,1,100" },
          },
          {
            rowNumber: 2,
            recordType: "unsupported",
            sourceSnippet: "cash transfer row",
            sourceMetadata: { fileId: "file-1", rowRef: "2", snippet: "cash transfer details" },
          },
        ],
      },
    );

    const detail = await app.inject({
      method: "GET",
      url: `/ai/transaction-drafts/${created.batch.id}`,
    });

    expect(detail.statusCode).toBe(200);
    const body = detail.json<{
      rows: Array<Record<string, unknown>>;
      unsupportedItems: Array<Record<string, unknown>>;
    }>();
    expect(body.rows[0]).not.toHaveProperty("normalizedPayload");
    expect(body.rows[0]).not.toHaveProperty("rawPayload");
    expect(body.unsupportedItems[0]).not.toHaveProperty("rawPayload");
  });

  it("rejects connector-mediated raw source payloads for draft batch creation", async () => {
    const token = devToken({
      userId: "user-1",
      scopes: ["transaction_draft:create"],
    });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);

    const call = await callMcpTool(headers, sessionId, "create_transaction_draft_batch", {
      provenance: {
        sourceType: "csv",
        files: [{ fileId: "file-1", sourceType: "csv", snippet: "2330,1" }],
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
      }],
    });

    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("Unrecognized key");
    expect(call.body).toContain("rawPayload");
  });

  it("posts draft rows over MCP with compact results and ChatGPT component audit metadata", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        provenance: {
          sourceType: "csv",
          files: [{ fileId: "file-1", sourceType: "csv", displayName: "import.csv", snippet: "2330,BUY,1,100" }],
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
    const row = aggregate?.rows[0];
    expect(row).toBeTruthy();

    const connection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: [
          "transaction_draft:create",
          "transaction_draft:edit",
          "transaction:write",
        ],
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: "user-1", connectionId: connection.id, clientId: "chatgpt" });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);

    const component = await callMcpTool(headers, sessionId, "get_transaction_draft_batch_component", {
      batchId: created.batch.id,
    });
    expect(component.statusCode).toBe(200);
    expect(component.body).toContain("\"widget\"");
    expect(component.body).toContain("\"get_transaction_draft_batch_component\"");
    expect(component.body).toContain("\"openai/outputTemplate\"");
    expect(component.body).toContain("/connectors/chatgpt/transaction-draft");

    const call = await callMcpTool(headers, sessionId, "post_transaction_draft_rows", {
      batchId: created.batch.id,
      rowIds: [row!.id],
      expectedBatchVersion: aggregate!.batch.version,
      expectedRowVersions: [{ rowId: row!.id, expectedVersion: row!.version }],
      idempotencyKey: "chatgpt-post-1",
    });

    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("\"outcome\":\"posted\"");
    expect(call.body).toContain(`"postedRowIds":["${row!.id}"]`);

    const saved = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(saved?.rows[0]).toMatchObject({ state: "confirmed" });
    expect(saved?.events.at(-1)).toMatchObject({
      eventType: "rows_confirmed",
      metadata: expect.objectContaining({
        source: "chatgpt_component",
        postedRowIds: [row!.id],
      }),
    });
    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs[0]?.metadata).toMatchObject({ source: "chatgpt_component" });
  });
});
