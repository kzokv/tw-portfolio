import { Buffer } from "node:buffer";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Env } from "@vakwen/config";
import { routeError } from "../lib/routeError.js";
import type { McpAuthContext, McpAuthService, McpProtectedResourceMetadata } from "./types.js";
import { ALL_MCP_SCOPES } from "./tools.js";
import {
  expireAiConnectorConnection,
  maybeNotifyAiConnectorExpiringSoon,
  revokeAiConnectorConnection,
  touchAiConnectorConnection,
} from "../services/mcpConnectorLifecycle.js";
import {
  getMcpOAuthIssuer,
  getMcpProtectedResourceMetadata,
  getMcpResourceUrl,
  getMcpOAuthTokenSecret,
  verifyMcpOAuthAccessToken,
} from "./oauth.js";

const devTokenPayloadSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  connectionId: z.string().trim().min(1).max(200).optional(),
  clientId: z.string().trim().min(1).max(200).optional(),
  scopes: z.array(z.enum(ALL_MCP_SCOPES as [typeof ALL_MCP_SCOPES[0], ...typeof ALL_MCP_SCOPES])).optional(),
});
const scopeSchema = z.enum(ALL_MCP_SCOPES as [typeof ALL_MCP_SCOPES[0], ...typeof ALL_MCP_SCOPES]);

function readBearerToken(req: FastifyRequest): string {
  const raw = req.headers.authorization;
  if (!raw || Array.isArray(raw)) {
    throw routeError(401, "mcp_auth_required", "Authorization bearer token required");
  }
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw routeError(401, "mcp_auth_required", "Authorization bearer token required");
  }
  return match[1]!.trim();
}

function decodeDevToken(token: string) {
  const [, encoded] = token.split(".", 2);
  if (!encoded || !token.startsWith("vakwen-dev.")) {
    throw routeError(401, "mcp_auth_unconfigured", "MCP bearer token verification is not configured");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  return devTokenPayloadSchema.parse(decoded);
}

export function mcpDevTokenAllowedForRuntime(nodeEnv: string = Env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

function assertDevTokenAllowed(): void {
  if (!mcpDevTokenAllowedForRuntime()) {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
}

function parseOAuthScopeClaim(scope: string) {
  try {
    const parsed = scope
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return [...new Set(parsed.map((item) => scopeSchema.parse(item)))];
  } catch {
    throw routeError(401, "mcp_auth_invalid_scope", "MCP bearer token scope is invalid");
  }
}

export class DefaultMcpAuthService implements McpAuthService {
  async authenticateRequest(app: FastifyInstance, req: FastifyRequest): Promise<McpAuthContext> {
    const token = readBearerToken(req);
    if (!token.startsWith("vakwen-dev.")) {
      return this.authenticateOAuthRequest(app, req, token);
    }
    assertDevTokenAllowed();
    const payload = decodeDevToken(token);
    const authUser = await app.persistence.getAuthUserById(payload.userId);
    if (!authUser || authUser.deactivatedAt || authUser.deletedAt) {
      throw routeError(401, "mcp_auth_invalid_user", "MCP bearer token user is not active");
    }
    const policySettings = await app.persistence.getAiConnectorPolicySettings();
    if (!policySettings.enabled) {
      throw routeError(403, "mcp_deployment_disabled", "AI connector deployment is disabled");
    }

    if (payload.connectionId) {
      let connection = await app.persistence.getAiConnectorConnection(payload.connectionId);
      if (!connection || connection.userId !== authUser.userId) {
        throw routeError(401, "mcp_auth_invalid_connection", "MCP bearer token connection is not valid");
      }
      if (!policySettings.allowedProviders[connection.provider]) {
        throw routeError(403, "mcp_provider_disabled", `AI connector provider ${connection.provider} is disabled`);
      }
      if (connection.status !== "active") {
        throw routeError(403, "mcp_connection_inactive", "MCP connector connection is not active");
      }
      if (connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now()) {
        await expireAiConnectorConnection(app, connection, "absolute_expiry");
        throw routeError(403, "mcp_connection_expired", "MCP connector connection has expired");
      }
      const inactiveSince = Date.parse(connection.lastUsedAt ?? connection.createdAt);
      const inactivityMs = policySettings.inactivityExpiryDays * 24 * 60 * 60 * 1000;
      if (Number.isFinite(inactiveSince) && Date.now() - inactiveSince > inactivityMs) {
        await expireAiConnectorConnection(app, connection, "inactivity_expiry");
        throw routeError(403, "mcp_connection_expired", "MCP connector connection has expired due to inactivity");
      }
      connection = await maybeNotifyAiConnectorExpiringSoon(app, connection, policySettings);
      await touchAiConnectorConnection(app, connection);
      return {
        token,
        clientId: payload.clientId ?? connection.oauthClientId ?? connection.id,
        sessionUserId: authUser.userId,
        connection,
        scopes: [...connection.scopes],
        toolToggles: { ...connection.toolToggles },
        expiresAt: connection.expiresAt,
        authMode: "dev_token",
      };
    }

    return {
      token,
      clientId: payload.clientId ?? "vakwen-dev-client",
      sessionUserId: authUser.userId,
      connection: null,
      scopes: [...(payload.scopes ?? ALL_MCP_SCOPES)],
      toolToggles: {},
      expiresAt: null,
      authMode: "dev_token",
    };
  }

  private async authenticateOAuthRequest(
    app: FastifyInstance,
    req: FastifyRequest,
    token: string,
  ): Promise<McpAuthContext> {
    let payload;
    try {
      payload = verifyMcpOAuthAccessToken(await getMcpOAuthTokenSecret(app), token);
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) throw error;
      throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
    }

    const issuer = await getMcpOAuthIssuer(app, req);
    const resource = await getMcpResourceUrl(app, req);
    if (payload.iss !== issuer || payload.aud !== resource || payload.resource !== resource) {
      throw routeError(401, "mcp_auth_invalid_audience", "MCP bearer token audience is invalid");
    }

    const authUser = await app.persistence.getAuthUserById(payload.sub);
    if (!authUser || authUser.deactivatedAt || authUser.deletedAt) {
      throw routeError(401, "mcp_auth_invalid_user", "MCP bearer token user is not active");
    }
    const connection = await app.persistence.getAiConnectorConnection(payload.connectionId);
    if (!connection || connection.userId !== authUser.userId) {
      throw routeError(401, "mcp_auth_invalid_connection", "MCP bearer token connection is not valid");
    }
    if (authUser.sessionVersion !== payload.sv) {
      await revokeAiConnectorConnection(app, connection.id, {
        revokedByUserId: null,
        reason: "session_version_changed",
        ipAddress: req.ip ?? null,
      });
      throw routeError(401, "mcp_auth_invalid_session", "MCP bearer token session is no longer valid");
    }

    const policySettings = await app.persistence.getAiConnectorPolicySettings();
    if (!policySettings.enabled) {
      throw routeError(403, "mcp_deployment_disabled", "AI connector deployment is disabled");
    }
    if (!policySettings.allowedProviders[connection.provider]) {
      throw routeError(403, "mcp_provider_disabled", `AI connector provider ${connection.provider} is disabled`);
    }
    if (connection.status !== "active") {
      throw routeError(403, "mcp_connection_inactive", "MCP connector connection is not active");
    }
    if (connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now()) {
      await expireAiConnectorConnection(app, connection, "absolute_expiry");
      throw routeError(403, "mcp_connection_expired", "MCP connector connection has expired");
    }
    const inactiveSince = Date.parse(connection.lastUsedAt ?? connection.createdAt);
    const inactivityMs = policySettings.inactivityExpiryDays * 24 * 60 * 60 * 1000;
    if (Number.isFinite(inactiveSince) && Date.now() - inactiveSince > inactivityMs) {
      await expireAiConnectorConnection(app, connection, "inactivity_expiry");
      throw routeError(403, "mcp_connection_expired", "MCP connector connection has expired due to inactivity");
    }
    const tokenScopes = parseOAuthScopeClaim(payload.scope);
    const effectiveScopes = tokenScopes.filter((scope) => connection.scopes.includes(scope));
    const notified = await maybeNotifyAiConnectorExpiringSoon(app, connection, policySettings);
    await touchAiConnectorConnection(app, notified);
    return {
      token,
      clientId: payload.client_id,
      sessionUserId: authUser.userId,
      connection: notified,
      scopes: effectiveScopes,
      toolToggles: { ...notified.toolToggles },
      expiresAt: notified.expiresAt,
      authMode: "oauth",
    };
  }

  getProtectedResourceMetadata(app: FastifyInstance, req: FastifyRequest): Promise<McpProtectedResourceMetadata> {
    return getMcpProtectedResourceMetadata(app, req);
  }
}
