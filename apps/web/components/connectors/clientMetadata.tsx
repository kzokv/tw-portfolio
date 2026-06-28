"use client";

import {
  AppWindow,
  Bot,
  Braces,
  Code2,
  MessageSquare,
  Sparkles,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import type { AiConnectorClientKind, AiConnectorConnectionDto } from "@vakwen/shared-types";
import { cn } from "../../lib/utils";

export type CompatibleAiClientKind = AiConnectorClientKind | "claude_ai_connector";

export type AiClientMetadata = {
  clientKind: CompatibleAiClientKind;
  label: string;
  shortLabel: string;
  vendor: string;
  tier: "Tier 1" | "Tier 2";
  authModes: string;
  docsUrl: string;
  reconnectUrl?: string;
  snippet: string;
  icon: LucideIcon;
  iconClassName: string;
  badgeClassName: string;
};

const CLIENT_METADATA: Record<CompatibleAiClientKind, AiClientMetadata> = {
  chatgpt_app: {
    clientKind: "chatgpt_app",
    label: "ChatGPT / OpenAI Apps",
    shortLabel: "ChatGPT",
    vendor: "OpenAI",
    tier: "Tier 1",
    authModes: "OAuth",
    docsUrl: "https://chatgpt.com/",
    reconnectUrl: "https://chatgpt.com/",
    snippet: "Use the shared Vakwen MCP URL and complete the OAuth prompt inside ChatGPT.",
    icon: MessageSquare,
    iconClassName: "text-emerald-700",
    badgeClassName: "bg-emerald-100 text-emerald-700",
  },
  claude_ai_connector: {
    clientKind: "claude_ai_connector",
    label: "Claude.ai",
    shortLabel: "Claude.ai",
    vendor: "Anthropic",
    tier: "Tier 1",
    authModes: "OAuth",
    docsUrl: "https://claude.ai/",
    reconnectUrl: "https://claude.ai/",
    snippet: "Use the shared Vakwen MCP URL and complete the OAuth prompt inside Claude.ai.",
    icon: Sparkles,
    iconClassName: "text-orange-700",
    badgeClassName: "bg-orange-100 text-orange-700",
  },
  claude_code: {
    clientKind: "claude_code",
    label: "Claude Code",
    shortLabel: "Claude Code",
    vendor: "Anthropic",
    tier: "Tier 1",
    authModes: "OAuth or bearer fallback",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
    reconnectUrl: "https://claude.ai/",
    snippet: "Point Claude Code at the shared MCP endpoint, then complete OAuth or use scoped bearer fallback if allowed.",
    icon: TerminalSquare,
    iconClassName: "text-orange-700",
    badgeClassName: "bg-orange-100 text-orange-700",
  },
  codex_cli: {
    clientKind: "codex_cli",
    label: "Codex CLI / IDE",
    shortLabel: "Codex",
    vendor: "OpenAI Codex",
    tier: "Tier 1",
    authModes: "OAuth or bearer fallback",
    docsUrl: "https://platform.openai.com/docs/guides/tools-remote-mcp",
    snippet: "Configure the shared MCP endpoint once; OAuth is preferred when available.",
    icon: Code2,
    iconClassName: "text-cyan-700",
    badgeClassName: "bg-cyan-100 text-cyan-700",
  },
  gemini_cli: {
    clientKind: "gemini_cli",
    label: "Gemini CLI",
    shortLabel: "Gemini",
    vendor: "Google",
    tier: "Tier 2",
    authModes: "Bearer fallback",
    docsUrl: "https://ai.google.dev/gemini-api/docs/mcp",
    snippet: "Use the same MCP endpoint with the documented generic MCP client configuration.",
    icon: Bot,
    iconClassName: "text-sky-700",
    badgeClassName: "bg-sky-100 text-sky-700",
  },
  copilot_mcp: {
    clientKind: "copilot_mcp",
    label: "VS Code / Copilot MCP",
    shortLabel: "Copilot MCP",
    vendor: "Microsoft",
    tier: "Tier 2",
    authModes: "Bearer fallback",
    docsUrl: "https://code.visualstudio.com/docs/copilot/chat/mcp-servers",
    snippet: "Add Vakwen as an MCP server using the shared endpoint and allowed bearer fallback settings.",
    icon: AppWindow,
    iconClassName: "text-blue-700",
    badgeClassName: "bg-blue-100 text-blue-700",
  },
  generic_mcp: {
    clientKind: "generic_mcp",
    label: "Generic MCP",
    shortLabel: "Generic MCP",
    vendor: "Generic",
    tier: "Tier 2",
    authModes: "Bearer fallback",
    docsUrl: "https://modelcontextprotocol.io/",
    snippet: "Use the shared MCP URL with the minimum scopes you need; bearer tokens are secondary to OAuth.",
    icon: Braces,
    iconClassName: "text-slate-700",
    badgeClassName: "bg-slate-200 text-slate-700",
  },
};

export function getAiClientMetadata(kind: CompatibleAiClientKind | string): AiClientMetadata {
  return CLIENT_METADATA[kind as CompatibleAiClientKind] ?? CLIENT_METADATA.generic_mcp;
}

export function getAiClientMetadataFromConnection(connection: Pick<AiConnectorConnectionDto, "clientKind" | "vendor" | "authMode">): AiClientMetadata {
  const rawKind = connection.clientKind as CompatibleAiClientKind | string;
  if (rawKind === "claude_ai_connector") return CLIENT_METADATA.claude_ai_connector;
  if (rawKind in CLIENT_METADATA) return CLIENT_METADATA[rawKind as CompatibleAiClientKind];
  if (connection.vendor === "anthropic" && connection.authMode === "oauth") return CLIENT_METADATA.claude_ai_connector;
  if (connection.vendor === "anthropic") return CLIENT_METADATA.claude_code;
  return CLIENT_METADATA.generic_mcp;
}

export function detectConsentClientMetadata(input: { clientId?: string | null; redirectUri?: string | null }) {
  const clientId = input.clientId?.toLowerCase() ?? "";
  const redirectUri = input.redirectUri?.toLowerCase() ?? "";
  if (redirectUri.includes("claude.ai/api/mcp/auth_callback") || clientId.includes("claude.ai")) {
    return CLIENT_METADATA.claude_ai_connector;
  }
  if (clientId.includes("claude_code")) return CLIENT_METADATA.claude_code;
  if (clientId.includes("codex")) return CLIENT_METADATA.codex_cli;
  if (clientId.includes("gemini")) return CLIENT_METADATA.gemini_cli;
  if (clientId.includes("copilot") || clientId.includes("vscode")) return CLIENT_METADATA.copilot_mcp;
  if (clientId.includes("chatgpt") || clientId.includes("openai")) return CLIENT_METADATA.chatgpt_app;
  return CLIENT_METADATA.generic_mcp;
}

export function getConsentClientMetadata(input: {
  clientKind?: CompatibleAiClientKind | string | null;
  clientLabel?: string | null;
  clientId?: string | null;
  redirectUri?: string | null;
}): AiClientMetadata {
  if (input.clientKind) {
    const metadata = getAiClientMetadata(input.clientKind);
    const label = input.clientLabel?.trim();
    return label ? { ...metadata, label, shortLabel: label } : metadata;
  }
  return detectConsentClientMetadata(input);
}

export function AiClientGlyph({
  className,
  clientKind,
  connection,
}: {
  className?: string;
  clientKind?: CompatibleAiClientKind | string;
  connection?: Pick<AiConnectorConnectionDto, "clientKind" | "vendor" | "authMode">;
}) {
  const metadata = connection ? getAiClientMetadataFromConnection(connection) : getAiClientMetadata(clientKind ?? "generic_mcp");
  const Icon = metadata.icon;
  return (
    <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-xl", metadata.badgeClassName, className)}>
      <Icon className={cn("h-4 w-4", metadata.iconClassName)} aria-hidden="true" />
    </span>
  );
}
