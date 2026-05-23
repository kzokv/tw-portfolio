import { createHmac, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  AiConnectorPolicySettingsDto,
  AiConnectorProvider,
  AiConnectorScope,
} from "@vakwen/shared-types";
import { Env } from "@vakwen/config";
import { routeError } from "../lib/routeError.js";
import type {
  AiConnectorConnectionRecord,
  AuditLogInput,
  SaveAiConnectorConnectionInput,
  SaveAiConnectorPolicySettingsInput,
} from "../persistence/types.js";

const FRESH_AUTH_HEADER = "x-vakwen-fresh-auth-at";
const FRESH_AUTH_TOKEN_VERSION = 1;

interface McpFreshAuthTokenPayload {
  v: typeof FRESH_AUTH_TOKEN_VERSION;
  sub: string;
  sv: number;
  iat: number;
  nonce: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sessionSecretForApp(app: FastifyInstance): string {
  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET;
  if (!sessionSecret) {
    throw routeError(500, "missing_secret", "SESSION_SECRET is required for MCP fresh-auth token verification");
  }
  return sessionSecret;
}

function signFreshAuthPayload(payload: string, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret).update(payload).digest("hex");
}

function verifyFreshAuthSignature(payload: string, receivedSignature: string, sessionSecret: string): boolean {
  const expectedSignature = signFreshAuthPayload(payload, sessionSecret);
  try {
    const expected = Buffer.from(expectedSignature, "hex");
    const received = Buffer.from(receivedSignature, "hex");
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

function parseFreshAuthToken(token: string, sessionSecret: string): McpFreshAuthTokenPayload | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || token.split(".").length !== 2) return null;
  if (!verifyFreshAuthSignature(payload, signature, sessionSecret)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<McpFreshAuthTokenPayload>;
    if (
      parsed.v !== FRESH_AUTH_TOKEN_VERSION ||
      typeof parsed.sub !== "string" ||
      !Number.isInteger(parsed.sv) ||
      !Number.isInteger(parsed.iat) ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 16
    ) {
      return null;
    }
    return parsed as McpFreshAuthTokenPayload;
  } catch {
    return null;
  }
}

function activeConnection(record: AiConnectorConnectionRecord, nowMs = Date.now()): boolean {
  return record.status === "active" && (!record.expiresAt || Date.parse(record.expiresAt) > nowMs);
}

function notificationTitle(status: "expiring" | "expired" | "revoked"): string {
  if (status === "expiring") return "AI connector expiring soon";
  if (status === "revoked") return "AI connector revoked";
  return "AI connector expired";
}

async function createConnectorNotification(
  app: FastifyInstance,
  connection: AiConnectorConnectionRecord,
  status: "expiring" | "expired" | "revoked",
  detail?: Record<string, unknown>,
): Promise<void> {
  const notificationId = await app.persistence.createNotification({
    userId: connection.userId,
    severity: status === "expiring" ? "warning" : "info",
    source: "ai_connector",
    sourceRef: connection.id,
    title: notificationTitle(status),
    body: `${connection.displayName} (${connection.provider}) ${status === "expiring" ? "expires soon" : `was ${status}`}.`,
    detail: {
      connectionId: connection.id,
      provider: connection.provider,
      status,
      ...detail,
    },
  });
  await app.eventBus.publishEvent(connection.userId, "ai_connector_notification", {
    connectionId: connection.id,
    provider: connection.provider,
    status,
    notificationId,
  });
}

export function connectorGroupForScope(scope: AiConnectorScope): "read" | "drafts" | "write" {
  if (scope === "portfolio:mcp_read") return "read";
  if (scope === "transaction:write") return "write";
  return "drafts";
}

export function createMcpFreshAuthToken(app: FastifyInstance, req: FastifyRequest, nowMs = Date.now()): string {
  if (!req.authContext) {
    throw routeError(401, "auth_required", "authentication required");
  }
  const payload: McpFreshAuthTokenPayload = {
    v: FRESH_AUTH_TOKEN_VERSION,
    sub: req.authContext.sessionUserId,
    sv: req.authContext.sessionVersion,
    iat: nowMs,
    nonce: randomBytes(12).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signFreshAuthPayload(encodedPayload, sessionSecretForApp(app))}`;
}

export function assertFreshAuth(
  app: FastifyInstance,
  req: FastifyRequest,
  settings: Pick<AiConnectorPolicySettingsDto, "freshAuthMaxAgeMs">,
): void {
  if (!req.authContext) {
    throw routeError(401, "auth_required", "authentication required");
  }
  const raw = req.headers[FRESH_AUTH_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    throw routeError(403, "mcp_fresh_auth_required", "Fresh authentication is required for AI connector policy changes");
  }
  const parsed = parseFreshAuthToken(value, sessionSecretForApp(app));
  if (!parsed) {
    throw routeError(400, "mcp_fresh_auth_invalid", "Fresh authentication token is invalid");
  }
  if (parsed.sub !== req.authContext.sessionUserId || parsed.sv !== req.authContext.sessionVersion) {
    throw routeError(403, "mcp_fresh_auth_required", "Fresh authentication is required for AI connector policy changes");
  }
  const ageMs = Date.now() - parsed.iat;
  if (ageMs < 0 || ageMs > settings.freshAuthMaxAgeMs) {
    throw routeError(403, "mcp_fresh_auth_required", "Fresh authentication is required for AI connector policy changes");
  }
}

export async function updateAiConnectorPolicySettings(
  app: FastifyInstance,
  input: SaveAiConnectorPolicySettingsInput,
  audit: Omit<AuditLogInput, "action">,
): Promise<AiConnectorPolicySettingsDto> {
  const before = await app.persistence.getAiConnectorPolicySettings();
  const after = await app.persistence.saveAiConnectorPolicySettings(input);
  await app.persistence.appendAuditLog({
    ...audit,
    action: "app_config_updated",
    metadata: {
      type: "ai_connector_policy",
      before,
      after,
    },
  });
  return after;
}

export async function createAiConnectorConnection(
  app: FastifyInstance,
  input: Omit<SaveAiConnectorConnectionInput, "id" | "status"> & {
    id?: string;
    provider: AiConnectorProvider;
  },
  audit: Omit<AuditLogInput, "action" | "targetUserId">,
): Promise<AiConnectorConnectionRecord> {
  const settings = await app.persistence.getAiConnectorPolicySettings();
  if (!settings.enabled) {
    throw routeError(403, "mcp_deployment_disabled", "AI connector deployment is disabled");
  }
  if (!settings.allowedProviders[input.provider]) {
    throw routeError(403, "mcp_provider_disabled", `AI connector provider ${input.provider} is disabled`);
  }
  const existing = await app.persistence.listAiConnectorConnectionsForUser(input.userId);
  for (const connection of existing) {
    if (
      connection.provider === input.provider
      && connection.status === "active"
      && connection.expiresAt
      && Date.parse(connection.expiresAt) <= Date.now()
    ) {
      await expireAiConnectorConnection(app, connection, "absolute_expiry");
    }
  }
  const refreshedExisting = await app.persistence.listAiConnectorConnectionsForUser(input.userId);
  const activeCount = refreshedExisting.filter((connection) => activeConnection(connection)).length;
  if (activeCount >= settings.maxActiveConnectionsPerUser) {
    throw routeError(409, "mcp_connection_limit_exceeded", "AI connector connection limit exceeded");
  }

  const scopes = [...new Set(input.scopes)].filter((scope) => settings.groupToggles[connectorGroupForScope(scope)]);
  if (scopes.length === 0) {
    throw routeError(403, "mcp_all_requested_scopes_disabled", "All requested AI connector scope groups are disabled");
  }

  const record = await app.persistence.saveAiConnectorConnection({
    ...input,
    id: input.id ?? randomUUID(),
    status: "active",
    scopes,
  });
  await app.persistence.appendAuditLog({
    ...audit,
    action: "ai_connector_connected",
    targetUserId: input.userId,
    metadata: {
      connectionId: record.id,
      provider: record.provider,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
    },
  });
  return record;
}

export async function revokeAiConnectorConnection(
  app: FastifyInstance,
  connectionId: string,
  input: {
    revokedByUserId: string | null;
    reason?: string | null;
    ipAddress?: string | null;
  },
): Promise<AiConnectorConnectionRecord> {
  const connection = await app.persistence.getAiConnectorConnection(connectionId);
  if (!connection) throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
  if (connection.status === "revoked") return connection;

  const now = nowIso();
  const next = await app.persistence.saveAiConnectorConnection({
    ...connection,
    status: "revoked",
    revokedAt: now,
    revokedByUserId: input.revokedByUserId,
    revocationReason: input.reason ?? "manual",
    updatedAt: now,
  });
  await app.persistence.revokeAiConnectorCredentialsForConnection(connection.id);
  await app.persistence.appendAuditLog({
    actorUserId: input.revokedByUserId,
    action: "ai_connector_revoked",
    targetUserId: connection.userId,
    ipAddress: input.ipAddress,
    metadata: {
      connectionId,
      provider: connection.provider,
      reason: input.reason ?? "manual",
    },
  });
  await createConnectorNotification(app, next, "revoked", { reason: input.reason ?? "manual" });
  return next;
}

export async function expireAiConnectorConnection(
  app: FastifyInstance,
  connection: AiConnectorConnectionRecord,
  reason: "absolute_expiry" | "inactivity_expiry",
): Promise<AiConnectorConnectionRecord> {
  if (connection.status === "expired") return connection;
  const now = nowIso();
  const next = await app.persistence.saveAiConnectorConnection({
    ...connection,
    status: "expired",
    expiryNotifiedAt: connection.expiryNotifiedAt ?? now,
    updatedAt: now,
  });
  await app.persistence.revokeAiConnectorCredentialsForConnection(connection.id);
  await app.persistence.appendAuditLog({
    actorUserId: null,
    action: "ai_connector_expired",
    targetUserId: connection.userId,
    metadata: {
      connectionId: connection.id,
      provider: connection.provider,
      reason,
    },
  });
  await createConnectorNotification(app, next, "expired", { reason });
  return next;
}

export async function maybeNotifyAiConnectorExpiringSoon(
  app: FastifyInstance,
  connection: AiConnectorConnectionRecord,
  settings: Pick<AiConnectorPolicySettingsDto, "expirationWarningDays">,
): Promise<AiConnectorConnectionRecord> {
  if (!connection.expiresAt || connection.expiryNotifiedAt) return connection;
  const warningMs = settings.expirationWarningDays * 24 * 60 * 60 * 1000;
  const expiresInMs = Date.parse(connection.expiresAt) - Date.now();
  if (expiresInMs < 0 || expiresInMs > warningMs) return connection;
  const notifiedAt = nowIso();
  const next = await app.persistence.saveAiConnectorConnection({
    ...connection,
    expiryNotifiedAt: notifiedAt,
    updatedAt: notifiedAt,
  });
  await createConnectorNotification(app, next, "expiring", { expiresAt: connection.expiresAt });
  return next;
}

export async function touchAiConnectorConnection(app: FastifyInstance, connection: AiConnectorConnectionRecord): Promise<void> {
  await app.persistence.saveAiConnectorConnection({
    ...connection,
    lastUsedAt: nowIso(),
  });
}
