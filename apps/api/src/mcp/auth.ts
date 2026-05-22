import { Buffer } from "node:buffer";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { routeError } from "../lib/routeError.js";
import type { McpAuthContext, McpAuthService, McpProtectedResourceMetadata } from "./types.js";
import { ALL_MCP_SCOPES } from "./tools.js";
import {
  expireAiConnectorConnection,
  maybeNotifyAiConnectorExpiringSoon,
  touchAiConnectorConnection,
} from "../services/mcpConnectorLifecycle.js";

const devTokenPayloadSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  connectionId: z.string().trim().min(1).max(200).optional(),
  clientId: z.string().trim().min(1).max(200).optional(),
  scopes: z.array(z.enum(ALL_MCP_SCOPES as [typeof ALL_MCP_SCOPES[0], ...typeof ALL_MCP_SCOPES])).optional(),
});

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

function buildOrigin(req: FastifyRequest): string {
  const protocol = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:3001";
  return `${protocol}://${host}`;
}

export class DefaultMcpAuthService implements McpAuthService {
  async authenticateRequest(app: FastifyInstance, req: FastifyRequest): Promise<McpAuthContext> {
    const token = readBearerToken(req);
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

  getProtectedResourceMetadata(req: FastifyRequest): McpProtectedResourceMetadata {
    const origin = buildOrigin(req);
    return {
      resource: `${origin}/mcp`,
      authorization_servers: [],
      scopes_supported: [...ALL_MCP_SCOPES],
      bearer_methods_supported: ["header"],
      resource_documentation: `${origin}/mcp/health`,
    };
  }
}
