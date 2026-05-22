import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { DefaultMcpAuthService } from "../../src/mcp/auth.js";
import {
  createAiConnectorConnection,
  revokeAiConnectorConnection,
} from "../../src/services/mcpConnectorLifecycle.js";

let app: Awaited<ReturnType<typeof buildApp>>;

function devToken(payload: Record<string, unknown>): string {
  return `vakwen-dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

describe("MCP connector lifecycle", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    await app.close();
  });

  it("enforces the admin deployment ceiling when creating connector connections", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ maxActiveConnectionsPerUser: 1 });
    await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read"],
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );

    await expect(createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "self_hosted",
        displayName: "Self hosted",
        scopes: ["portfolio:mcp_read"],
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    )).rejects.toMatchObject({ code: "mcp_connection_limit_exceeded" });
  });

  it("revokes connector connections with audit and in-app notification", async () => {
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read"],
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );

    await revokeAiConnectorConnection(app, connection.id, {
      revokedByUserId: "user-1",
      reason: "user_requested",
      ipAddress: "127.0.0.1",
    });

    const saved = await app.persistence.getAiConnectorConnection(connection.id);
    expect(saved).toMatchObject({ status: "revoked", revocationReason: "user_requested" });
    const notifications = await app.persistence.getNotificationsForUser("user-1", { page: 1, limit: 10 });
    expect(notifications.notifications[0]).toMatchObject({
      source: "ai_connector",
      sourceRef: connection.id,
      title: "AI connector revoked",
    });
  });

  it("expires inactive connector connections during MCP auth and notifies the user", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ inactivityExpiryDays: 1 });
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const connection = await app.persistence.saveAiConnectorConnection({
      id: "conn-inactive",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      scopes: ["portfolio:mcp_read"],
      lastUsedAt: old,
      createdAt: old,
      updatedAt: old,
    });

    const auth = new DefaultMcpAuthService();
    await expect(auth.authenticateRequest(app, {
      headers: {
        authorization: `Bearer ${devToken({ userId: "user-1", connectionId: connection.id })}`,
      },
    } as never)).rejects.toMatchObject({ code: "mcp_connection_expired" });

    const saved = await app.persistence.getAiConnectorConnection(connection.id);
    expect(saved).toMatchObject({ status: "expired" });
    const notifications = await app.persistence.getNotificationsForUser("user-1", { page: 1, limit: 10 });
    expect(notifications.notifications[0]).toMatchObject({
      source: "ai_connector",
      title: "AI connector expired",
    });
  });
});
