import type { McpToolName } from "./tools.js";
import type { McpAuthContext } from "./types.js";

interface WebFallback {
  url: string;
  requiresAuthenticatedSession: true;
  mode: "vakwen_web";
  operation: "transaction_draft_review" | "transaction_draft_posting";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function supportsOpenAiAppWidgets(auth: McpAuthContext): boolean {
  return auth.connection?.clientKind === "chatgpt_app"
    || auth.connection?.capabilities.includes("widgets") === true;
}

function operationForTool(toolName: McpToolName): WebFallback["operation"] | null {
  if (toolName === "get_transaction_draft_batch_component" || toolName === "show_transaction_draft_batch_by_name") {
    return "transaction_draft_review";
  }
  if (toolName === "post_transaction_draft_rows" || toolName === "post_transaction_draft_rows_by_name") {
    return "transaction_draft_posting";
  }
  return null;
}

function webFallbackFor(toolName: McpToolName, url: unknown): WebFallback | null {
  if (typeof url !== "string" || url.length === 0) return null;
  const operation = operationForTool(toolName);
  if (!operation) return null;
  return {
    url,
    requiresAuthenticatedSession: true,
    mode: "vakwen_web",
    operation,
  };
}

function deepLinkUrlFrom(result: Record<string, unknown>): unknown {
  if (typeof result.deepLinkUrl === "string") return result.deepLinkUrl;
  return isRecord(result._meta) ? result._meta.deepLinkUrl : undefined;
}

function stripOpenAiMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!isRecord(meta)) return undefined;
  const next = Object.fromEntries(
    Object.entries(meta).filter(([key]) => !key.startsWith("openai/")),
  );
  return Object.keys(next).length > 0 ? next : undefined;
}

function adaptTransactionDraftWidgetResult(toolName: McpToolName, result: Record<string, unknown>) {
  const widget = isRecord(result.widget) ? result.widget : null;
  const fallback = webFallbackFor(toolName, widget?.deepLinkUrl);
  if (!widget || !fallback) return null;
  return {
    operation: fallback.operation,
    title: typeof widget.title === "string" ? widget.title : "Review transaction draft rows",
    batch: widget.batch,
    rows: widget.rows,
    unsupportedItems: widget.unsupportedItems,
    selectedRowIds: widget.selectedRowIds,
    postingPreview: widget.postingPreview,
    permissions: widget.permissions,
    auditPreview: widget.auditPreview,
    deepLinkUrl: fallback.url,
    webFallback: fallback,
    _meta: {
      ...stripOpenAiMeta(result._meta),
      "vakwen/webFallback": fallback,
    },
  };
}

export function adaptMcpToolResultForHost(input: {
  toolName: McpToolName;
  auth: McpAuthContext;
  result: unknown;
}): unknown {
  if (supportsOpenAiAppWidgets(input.auth)) return input.result;
  if (!isRecord(input.result)) return input.result;

  const widgetResult = adaptTransactionDraftWidgetResult(input.toolName, input.result);
  if (widgetResult) return widgetResult;

  const fallback = webFallbackFor(input.toolName, deepLinkUrlFrom(input.result));
  const cleanMeta = stripOpenAiMeta(input.result._meta);
  if (!fallback && !cleanMeta) return input.result;
  const structured = Object.fromEntries(Object.entries(input.result).filter(([key]) => key !== "_meta"));
  return {
    ...structured,
    ...(fallback ? { webFallback: fallback } : {}),
    ...((fallback || cleanMeta)
      ? {
          _meta: {
            ...cleanMeta,
            ...(fallback ? { "vakwen/webFallback": fallback } : {}),
          },
        }
      : {}),
  };
}
