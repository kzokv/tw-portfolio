import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { DefaultMcpAuthService } from "./auth.js";
import { DefaultMcpPolicyService } from "./policy.js";
import { getMcpToolDefinition, listMcpToolDefinitions, type McpToolName } from "./tools.js";
import type { McpAuthService, McpPolicyService, McpRequestContext, McpResolvedContext } from "./types.js";
import {
  archiveTransactionDraftBatch,
  createTransactionDraftBatch,
  deleteUnconfirmedTransactionDraftBatch,
  excludeTransactionDraftRows,
  getTransactionDraftBatch,
  getTransactionDraftTemplate,
  listTransactionDraftBatches,
  preflightTransactionDraftCandidates,
  rejectTransactionDraftRows,
  reincludeTransactionDraftRows,
  updateTransactionDraftRows,
} from "../services/mcpDrafts.js";
import {
  getCashBalanceSummary,
  getDividendsOverview,
  getHoldings,
  getPerformance,
  getPortfolioOverview,
  getQuoteFreshness,
  getRecentTransactions,
  searchInstruments,
} from "../services/mcpPortfolioRead.js";

interface RegisterMcpRoutesOptions {
  authService?: McpAuthService;
  policyService?: McpPolicyService;
}

interface PendingToolRequestContext {
  auth: Awaited<ReturnType<McpAuthService["authenticateRequest"]>>;
  requestId: string;
  sourceIp: string | null;
  userAgent: string | null;
  req: FastifyRequest;
}

function getRequestId(req: FastifyRequest): string {
  const header = req.headers["x-request-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return req.id;
}

function asStructuredContent(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function buildToolResult(value: unknown) {
  const structuredContent = asStructuredContent(value);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function extractRequestedContextUserId(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const value = (args as Record<string, unknown>).portfolioContextUserId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractPendingContext(extra: unknown): PendingToolRequestContext | undefined {
  if (!extra || typeof extra !== "object") return undefined;
  const authInfo = (extra as { authInfo?: unknown }).authInfo;
  if (!authInfo || typeof authInfo !== "object") return undefined;
  const extraPayload = (authInfo as { extra?: unknown }).extra;
  if (!extraPayload || typeof extraPayload !== "object") return undefined;
  return (extraPayload as { pendingContext?: PendingToolRequestContext }).pendingContext;
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  options: RegisterMcpRoutesOptions = {},
): Promise<void> {
  const authService = options.authService ?? new DefaultMcpAuthService();
  const policyService = options.policyService ?? new DefaultMcpPolicyService(
    Object.fromEntries(listMcpToolDefinitions().map((tool) => [tool.name, tool.scope])),
  );
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const executeTool = async (toolName: McpToolName, args: unknown, extra: unknown) => {
    const pending = extractPendingContext(extra);
    if (!pending) throw new Error("Missing MCP request context");
    const tool = getMcpToolDefinition(toolName);
    const requestedContextUserId = extractRequestedContextUserId(args);
    let resolvedContext: McpResolvedContext | undefined;

    const logAccess = async (result: "ok" | "denied" | "error", denialReason?: string) => {
      await app.persistence.appendAiConnectorAccessLog({
        connectionId: pending.auth.connection?.id ?? null,
        userId: pending.auth.sessionUserId,
        portfolioContextUserId: resolvedContext?.portfolioContextUserId ?? pending.auth.sessionUserId,
        shareId: resolvedContext?.shareId ?? null,
        toolName,
        accessKind: tool.accessKind,
        result,
        denialReason: denialReason ?? null,
        requestId: pending.requestId,
        sourceIp: pending.sourceIp,
        userAgent: pending.userAgent,
        metadata: requestedContextUserId ? { requestedPortfolioContextUserId: requestedContextUserId } : {},
      });
    };

    try {
      resolvedContext = await policyService.assertToolAccess(
        app,
        pending.req,
        pending.auth,
        toolName,
        tool.accessKind,
        requestedContextUserId,
      );
      const requestContext: McpRequestContext = {
        auth: pending.auth,
        resolvedContext,
        requestId: pending.requestId,
        sourceIp: pending.sourceIp,
        userAgent: pending.userAgent,
        logger: pending.req.log,
      };
      let result: unknown;
      switch (toolName) {
        case "get_portfolio_overview":
          result = await getPortfolioOverview(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { reportingCurrency?: never; locale?: string },
          );
          break;
        case "get_holdings":
          result = await getHoldings(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { tickers?: string[]; reportingCurrency?: never; locale?: string },
          );
          break;
        case "get_performance":
          result = await getPerformance(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { range?: string; reportingCurrency?: never; locale?: string },
          );
          break;
        case "get_recent_transactions":
          result = await getRecentTransactions(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as {
              fromDate?: string;
              toDate?: string;
              limit: number;
              offset: number;
              tickers?: string[];
              accountIds?: string[];
            },
          );
          break;
        case "get_dividends_overview":
          result = await getDividendsOverview(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { reportingCurrency?: never; locale?: string },
          );
          break;
        case "get_quote_freshness":
          result = await getQuoteFreshness(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { tickers?: string[]; reportingCurrency?: never; locale?: string },
          );
          break;
        case "get_cash_balance_summary":
          result = await getCashBalanceSummary(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { accountIds?: string[]; locale?: string },
          );
          break;
        case "search_instruments":
          result = await searchInstruments(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { query: string; markets?: Array<"TW" | "US" | "AU">; limit: number },
          );
          break;
        case "get_transaction_draft_template":
          result = await getTransactionDraftTemplate();
          break;
        case "preflight_transaction_draft_candidates":
          result = await preflightTransactionDraftCandidates(
            { app, requestContext },
            args as Parameters<typeof preflightTransactionDraftCandidates>[1],
          );
          break;
        case "create_transaction_draft_batch":
          result = await createTransactionDraftBatch(
            { app, requestContext },
            args as Parameters<typeof createTransactionDraftBatch>[1],
          );
          break;
        case "list_transaction_draft_batches":
          result = await listTransactionDraftBatches(
            { app, requestContext },
            args as Parameters<typeof listTransactionDraftBatches>[1],
          );
          break;
        case "get_transaction_draft_batch": {
          const { batchId } = args as { batchId: string };
          result = await getTransactionDraftBatch({ app, requestContext }, batchId);
          break;
        }
        case "update_transaction_draft_rows":
          result = await updateTransactionDraftRows(
            { app, requestContext },
            args as Parameters<typeof updateTransactionDraftRows>[1],
          );
          break;
        case "exclude_transaction_draft_rows":
          result = await excludeTransactionDraftRows(
            { app, requestContext },
            args as Parameters<typeof excludeTransactionDraftRows>[1],
          );
          break;
        case "reinclude_transaction_draft_rows":
          result = await reincludeTransactionDraftRows(
            { app, requestContext },
            args as Parameters<typeof reincludeTransactionDraftRows>[1],
          );
          break;
        case "reject_transaction_draft_rows":
          result = await rejectTransactionDraftRows(
            { app, requestContext },
            args as Parameters<typeof rejectTransactionDraftRows>[1],
          );
          break;
        case "archive_transaction_draft_batch":
          result = await archiveTransactionDraftBatch(
            { app, requestContext },
            args as Parameters<typeof archiveTransactionDraftBatch>[1],
          );
          break;
        case "delete_unconfirmed_transaction_draft_batch":
          result = await deleteUnconfirmedTransactionDraftBatch(
            { app, requestContext },
            args as Parameters<typeof deleteUnconfirmedTransactionDraftBatch>[1],
          );
          break;
      }
      await logAccess("ok");
      return buildToolResult(result as Record<string, unknown>);
    } catch (error) {
      const denialReason = error instanceof Error && "code" in error
        ? String((error as { code?: unknown }).code)
        : error instanceof Error
          ? error.message
          : String(error);
      const result = error instanceof Error && "statusCode" in error && Number((error as { statusCode?: unknown }).statusCode) < 500
        ? "denied"
        : "error";
      await logAccess(result, denialReason);
      throw error;
    }
  };

  const createServer = () => {
    const server = new McpServer(
      {
        name: "vakwen-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          logging: {},
        },
      },
    );

    for (const tool of listMcpToolDefinitions()) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema.shape,
        },
        async (args: unknown, extra: unknown) => executeTool(tool.name, args, extra),
      );
    }
    return server;
  };

  const handleMcpRequest = async (req: FastifyRequest, reply: FastifyReply) => {
    const tokenContext = await authService.authenticateRequest(app, req);

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : undefined;
    let transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      const initializeBody = req.body;
      if (!initializeBody || !isInitializeRequest(initializeBody)) {
        return reply.code(400).send({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid MCP session ID provided" },
          id: null,
        });
      }
      const server = createServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, transport!);
        },
      });
      transport.onclose = () => {
        const currentSessionId = transport?.sessionId;
        if (currentSessionId) {
          sessions.delete(currentSessionId);
        }
      };
      await server.connect(transport);
    }

    (req.raw as typeof req.raw & { auth?: { token: string; clientId: string; scopes: string[]; extra: Record<string, unknown> } }).auth = {
      token: tokenContext.token,
      clientId: tokenContext.clientId,
      scopes: [...tokenContext.scopes],
      extra: {
        pendingContext: {
          auth: tokenContext,
          requestId: getRequestId(req),
          sourceIp: req.ip ?? null,
          userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
          req,
        } satisfies PendingToolRequestContext,
      },
    };
    const socket = req.raw.socket as typeof req.raw.socket & { destroySoon?: () => void };
    if (typeof socket.destroySoon !== "function") {
      socket.destroySoon = () => socket.destroy();
    }
    await transport.handleRequest(req.raw, reply.raw, req.body);
    reply.hijack();
  };

  app.addHook("onClose", async () => {
    const activeTransports = [...new Set(sessions.values())];
    sessions.clear();
    await Promise.all(activeTransports.map((transport) => transport.close()));
  });

  app.get("/mcp/health", async (req) => ({
    status: "ok",
    transport: "streamable_http",
    sessionCount: sessions.size,
    protectedResourceMetadata: authService.getProtectedResourceMetadata(req),
    tools: listMcpToolDefinitions().map((tool) => ({
      name: tool.name,
      scope: tool.scope,
      accessKind: tool.accessKind,
    })),
  }));

  app.get("/.well-known/oauth-protected-resource", async (req) => authService.getProtectedResourceMetadata(req));

  app.post("/mcp", async (req, reply) => handleMcpRequest(req, reply));
  app.get("/mcp", async (req, reply) => handleMcpRequest(req, reply));
  app.delete("/mcp", async (req, reply) => handleMcpRequest(req, reply));
}
