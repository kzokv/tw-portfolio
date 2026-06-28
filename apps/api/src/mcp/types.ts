import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import type { FastifyInstance } from "fastify";
import type {
  AiConnectorAccessKind,
  AiConnectorScope,
  ShareCapability,
} from "@vakwen/shared-types";
import type {
  AiConnectorConnectionRecord,
  AiTransactionDraftBatchAggregate,
  AiTransactionDraftBatchRecord,
} from "../persistence/types.js";
import type { TradingCalendarCache } from "../services/market-data/tradingCalendar.js";

export interface McpResolvedContext {
  sessionUserId: string;
  portfolioContextUserId: string;
  shareId: string | null;
  shareCapabilities: ShareCapability[];
}

export interface McpAuthContext {
  token: string;
  clientId: string;
  sessionUserId: string;
  connection: AiConnectorConnectionRecord | null;
  scopes: AiConnectorScope[];
  toolToggles: Record<string, boolean>;
  expiresAt: string | null;
  authMode: "dev_token" | "oauth" | "bearer" | "unconfigured";
}

export interface McpRequestContext {
  auth: McpAuthContext;
  resolvedContext: McpResolvedContext;
  portfolioContextDescriptor?: {
    label: string;
    email: string | null;
    isSelf: boolean;
  };
  requestId: string;
  sourceIp: string | null;
  userAgent: string | null;
  logger: FastifyBaseLogger;
}

export interface McpProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: AiConnectorScope[];
  bearer_methods_supported: ["header"];
  resource_documentation: string;
}

export interface McpAuthService {
  authenticateRequest(app: FastifyInstance, req: FastifyRequest): Promise<McpAuthContext>;
  getProtectedResourceMetadata(app: FastifyInstance, req: FastifyRequest): Promise<McpProtectedResourceMetadata>;
}

export interface McpAuthorizationDecision {
  allowed: boolean;
  reason?: string;
  shareId?: string | null;
  shareCapabilities?: ShareCapability[];
}

export interface McpPolicyService {
  assertToolAccess(
    app: FastifyInstance,
    req: FastifyRequest,
    auth: McpAuthContext,
    toolName: string,
    accessKind: AiConnectorAccessKind,
    requestedContextUserId?: string,
  ): Promise<McpResolvedContext>;
}

export interface McpReadServiceDeps {
  app: FastifyInstance;
  requestContext: McpRequestContext;
  tradingCalendar: TradingCalendarCache;
}

export interface McpDraftServiceDeps {
  app: FastifyInstance;
  requestContext: McpRequestContext;
}

export interface McpToolHandlerContext {
  app: FastifyInstance;
  requestContext: McpRequestContext;
}

export interface McpMutationBatchResult {
  batch: AiTransactionDraftBatchRecord | AiTransactionDraftBatchAggregate["batch"];
  deepLinkUrl: string;
}
