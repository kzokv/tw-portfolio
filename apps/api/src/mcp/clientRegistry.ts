import type {
  AiConnectorAuthMode,
  AiConnectorCapability,
  AiConnectorClientKind,
  AiConnectorProvider,
  AiConnectorVendor,
} from "@vakwen/shared-types";

export interface McpClientRegistryEntry {
  vendor: AiConnectorVendor;
  clientKind: AiConnectorClientKind;
  label: string;
  tier: 1 | 2;
  legacyProvider: AiConnectorProvider;
  supportedAuthModes: AiConnectorAuthMode[];
  defaultAuthMode: AiConnectorAuthMode;
  capabilities: AiConnectorCapability[];
  defaultDisplayName: string;
  docsUrl: string;
}

export const MCP_CLIENT_REGISTRY: readonly McpClientRegistryEntry[] = [
  {
    vendor: "openai",
    clientKind: "chatgpt_app",
    label: "ChatGPT / OpenAI Apps",
    tier: 1,
    legacyProvider: "chatgpt",
    supportedAuthModes: ["oauth"],
    defaultAuthMode: "oauth",
    capabilities: ["oauth", "widgets", "interactive_ops", "deep_link_fallback"],
    defaultDisplayName: "ChatGPT",
    docsUrl: "https://developers.openai.com/apps-sdk/",
  },
  {
    vendor: "anthropic",
    clientKind: "claude_ai_connector",
    label: "Claude.ai",
    tier: 1,
    legacyProvider: "chatgpt",
    supportedAuthModes: ["oauth"],
    defaultAuthMode: "oauth",
    capabilities: ["oauth", "interactive_ops", "deep_link_fallback"],
    defaultDisplayName: "Claude.ai",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
  },
  {
    vendor: "anthropic",
    clientKind: "claude_code",
    label: "Claude Code",
    tier: 1,
    legacyProvider: "self_hosted",
    supportedAuthModes: ["bearer"],
    defaultAuthMode: "bearer",
    capabilities: ["bearer_fallback", "deep_link_fallback"],
    defaultDisplayName: "Claude Code",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
  },
  {
    vendor: "openai_codex",
    clientKind: "codex_cli",
    label: "Codex CLI / IDE",
    tier: 1,
    legacyProvider: "self_hosted",
    supportedAuthModes: ["bearer"],
    defaultAuthMode: "bearer",
    capabilities: ["bearer_fallback", "deep_link_fallback"],
    defaultDisplayName: "Codex",
    docsUrl: "https://developers.openai.com/codex/",
  },
  {
    vendor: "google",
    clientKind: "gemini_cli",
    label: "Gemini CLI",
    tier: 2,
    legacyProvider: "self_hosted",
    supportedAuthModes: ["bearer"],
    defaultAuthMode: "bearer",
    capabilities: ["bearer_fallback", "deep_link_fallback"],
    defaultDisplayName: "Gemini CLI",
    docsUrl: "https://ai.google.dev/gemini-api/docs/cli",
  },
  {
    vendor: "microsoft",
    clientKind: "copilot_mcp",
    label: "VS Code / Copilot MCP",
    tier: 2,
    legacyProvider: "self_hosted",
    supportedAuthModes: ["bearer"],
    defaultAuthMode: "bearer",
    capabilities: ["bearer_fallback", "deep_link_fallback"],
    defaultDisplayName: "VS Code MCP",
    docsUrl: "https://code.visualstudio.com/docs/copilot/chat/mcp-servers",
  },
  {
    vendor: "generic",
    clientKind: "generic_mcp",
    label: "Generic MCP Client",
    tier: 2,
    legacyProvider: "self_hosted",
    supportedAuthModes: ["bearer", "dev_token"],
    defaultAuthMode: "bearer",
    capabilities: ["bearer_fallback", "deep_link_fallback"],
    defaultDisplayName: "Generic MCP",
    docsUrl: "https://modelcontextprotocol.io/",
  },
] as const;

export function getMcpClientByKind(clientKind: AiConnectorClientKind): McpClientRegistryEntry {
  const entry = MCP_CLIENT_REGISTRY.find((client) => client.clientKind === clientKind);
  if (!entry) {
    throw new Error(`Unknown MCP client kind: ${clientKind}`);
  }
  return entry;
}

export function getMcpClientByLegacyProvider(provider: AiConnectorProvider): McpClientRegistryEntry {
  return provider === "chatgpt"
    ? getMcpClientByKind("chatgpt_app")
    : getMcpClientByKind("generic_mcp");
}

export function legacyProviderForClientKind(clientKind: AiConnectorClientKind): AiConnectorProvider {
  return getMcpClientByKind(clientKind).legacyProvider;
}

export function defaultClientCapabilities(clientKind: AiConnectorClientKind): AiConnectorCapability[] {
  return [...getMcpClientByKind(clientKind).capabilities];
}
