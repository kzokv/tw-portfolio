import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  AiConnectorConnectionDto,
  AiConnectorPolicySettingsDto,
  AiConnectorToolCatalogEntryDto,
} from "@vakwen/shared-types";
import type { AiConnectorSummaryResponse } from "../../../features/ai-inbox/service";

const mockFetchAiConnectorSummary = vi.fn();
const mockFetchAiConnectorLogs = vi.fn();
const mockUpdateAiConnector = vi.fn();
const mockRevokeAiConnector = vi.fn();

vi.mock("../../../features/ai-inbox/service", () => ({
  fetchAiConnectorLogs: (...args: unknown[]) => mockFetchAiConnectorLogs(...args),
  fetchAiConnectorSummary: (...args: unknown[]) => mockFetchAiConnectorSummary(...args),
  updateAiConnector: (...args: unknown[]) => mockUpdateAiConnector(...args),
  revokeAiConnector: (...args: unknown[]) => mockRevokeAiConnector(...args),
}));

import { AiConnectorsSettingsClient } from "../../../components/settings/AiConnectorsSettingsClient";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildPolicy(overrides: Partial<AiConnectorPolicySettingsDto> = {}): AiConnectorPolicySettingsDto {
  return {
    enabled: true,
    maxActiveConnectionsPerUser: 3,
    allowedProviders: { chatgpt: true, self_hosted: true },
    groupToggles: { read: true, drafts: true, write: true },
    inactivityExpiryDays: 90,
    expirationWarningDays: 7,
    freshAuthMaxAgeMs: 600_000,
    maxConnectorLifetimeDays: 90,
    oauthPublicIssuer: "https://api.example.com",
    oauthRedirectUriAllowlist: [],
    oauthTokenSecretSet: true,
    updatedAt: "2026-05-23T12:00:00.000Z",
    ...overrides,
  };
}

function buildConnection(overrides: Partial<AiConnectorConnectionDto> = {}): AiConnectorConnectionDto {
  return {
    id: "conn-1",
    provider: "chatgpt",
    displayName: "ChatGPT",
    status: "active",
    scopes: ["portfolio:mcp_read"],
    toolToggles: {},
    expiresAt: "2026-06-23T12:00:00.000Z",
    expiryNotifiedAt: null,
    lastUsedAt: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: "2026-05-23T12:00:00.000Z",
    updatedAt: "2026-05-23T12:00:00.000Z",
    ...overrides,
  };
}

function buildToolCatalogEntry(overrides: Partial<AiConnectorToolCatalogEntryDto> = {}): AiConnectorToolCatalogEntryDto {
  return {
    name: "get_portfolio_report",
    description: "Return a descriptive portfolio report.",
    scope: "portfolio:mcp_read",
    accessKind: "read",
    group: "read",
    enabledByPolicy: true,
    availability: "available",
    unavailableReason: null,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    ...overrides,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AiConnectorsSettingsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockFetchAiConnectorLogs.mockReset();
    mockFetchAiConnectorSummary.mockReset();
    mockUpdateAiConnector.mockReset();
    mockRevokeAiConnector.mockReset();
    mockFetchAiConnectorLogs.mockResolvedValue({ accessLogs: [] });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("announces policy-disabled scope controls and page-level recovery", async () => {
    const response: AiConnectorSummaryResponse = {
      connections: [buildConnection()],
      policy: buildPolicy({ groupToggles: { read: false, drafts: false, write: false } }),
    };
    mockFetchAiConnectorSummary.mockResolvedValue(response);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("AI settings");
    const alert = document.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("Admin policy has disabled all MCP tool groups");
    const checkbox = document.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    expect(checkbox?.disabled).toBe(true);
    const describedBy = checkbox?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(String(describedBy))?.textContent).toContain("Disabled by MCP policy");
  });

  it("exposes pending connector status through a live status region", async () => {
    const response: AiConnectorSummaryResponse = {
      connections: [buildConnection({ status: "pending", lastUsedAt: null })],
      policy: buildPolicy(),
    };
    mockFetchAiConnectorSummary.mockResolvedValue(response);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    const statusRegions = Array.from(document.querySelectorAll("[role='status']"));
    expect(statusRegions.some((region) => region.textContent?.includes("Waiting for ChatGPT"))).toBe(true);
  });

  it("keeps transaction:write as a reconnect-only advanced scope when it was not granted at consent", async () => {
    const response: AiConnectorSummaryResponse = {
      connections: [buildConnection()],
      policy: buildPolicy(),
    };
    mockFetchAiConnectorSummary.mockResolvedValue(response);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("All tools inherit policy defaults");
    const accountLabel = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("Manage accounts"));
    expect(accountLabel?.textContent).toContain("Reconnect or re-consent in ChatGPT");
    const accountCheckbox = accountLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    expect(accountCheckbox?.checked).toBe(false);
    expect(accountCheckbox?.disabled).toBe(true);

    const postingLabel = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("Post confirmed transactions"));
    expect(postingLabel?.textContent).toContain("Reconnect or re-consent in ChatGPT");
    const postingCheckbox = postingLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    expect(postingCheckbox?.checked).toBe(false);
    expect(postingCheckbox?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Reconnect in ChatGPT");
  });

  it("renders the MCP tool catalog even when connection-level tool overrides are empty", async () => {
    const response: AiConnectorSummaryResponse = {
      connections: [buildConnection()],
      policy: buildPolicy(),
      toolCatalog: [
        buildToolCatalogEntry({ name: "get_daily_review_report" }),
        buildToolCatalogEntry({ name: "get_portfolio_report" }),
        buildToolCatalogEntry({ name: "get_market_report" }),
      ],
    };
    mockFetchAiConnectorSummary.mockResolvedValue(response);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connector-tool-catalog']")).not.toBeNull();
    expect(document.body.textContent).toContain("Available MCP tools");
    expect(document.body.textContent).toContain("get_daily_review_report");
    expect(document.body.textContent).toContain("get_portfolio_report");
    expect(document.body.textContent).toContain("get_market_report");
    expect(document.body.textContent).toContain("available");
    expect(document.body.textContent).toContain("Connection tools");
    expect(document.body.textContent).toContain("Inherited default");
  });

  it("surfaces unavailable MCP tool reasons from policy and connection scope", async () => {
    const response: AiConnectorSummaryResponse = {
      connections: [buildConnection()],
      policy: buildPolicy({ groupToggles: { read: true, drafts: false, write: true } }),
      toolCatalog: [
        buildToolCatalogEntry({
          name: "create_transaction_draft_batch",
          scope: "transaction_draft:create",
          accessKind: "draft_create",
          group: "drafts",
          enabledByPolicy: false,
          availability: "unavailable",
          unavailableReason: "Draft MCP tools are disabled by admin policy.",
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        }),
        buildToolCatalogEntry({
          name: "create_account",
          scope: "account:manage",
          accessKind: "write",
          group: "write",
          enabledByPolicy: true,
          availability: "available",
          unavailableReason: null,
          annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
          },
        }),
      ],
    };
    mockFetchAiConnectorSummary.mockResolvedValue(response);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("Draft MCP tools are disabled by admin policy.");
    expect(document.body.textContent).toContain("Requires Manage accounts.");
    const disabledDraftTool = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("create_transaction_draft_batch"));
    const disabledDraftCheckbox = disabledDraftTool?.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    expect(disabledDraftCheckbox?.disabled).toBe(true);
    expect(disabledDraftCheckbox?.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("renders the MCP tool catalog even when no connectors are connected", async () => {
    const response: AiConnectorSummaryResponse = {
      connections: [],
      policy: buildPolicy(),
      toolCatalog: [
        buildToolCatalogEntry({ name: "get_daily_review_report" }),
      ],
    };
    mockFetchAiConnectorSummary.mockResolvedValue(response);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connector-tool-catalog']")).not.toBeNull();
    expect(document.body.textContent).toContain("Available MCP tools");
    expect(document.body.textContent).toContain("get_daily_review_report");
    expect(document.body.textContent).toContain("No AI connectors are connected.");
  });

  it("loads access logs after connector summary renders", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy(),
    } satisfies AiConnectorSummaryResponse);
    mockFetchAiConnectorLogs.mockResolvedValue({
      accessLogs: [
        {
          id: "log-1",
          connectionId: "conn-1",
          portfolioContextUserId: "user-1",
          shareId: null,
          toolName: "portfolio.read",
          accessKind: "tool",
          result: "ok",
          denialReason: null,
          createdAt: "2026-06-02T00:00:00.000Z",
        },
      ],
    });

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();
    await flushEffects();

    expect(mockFetchAiConnectorSummary).toHaveBeenCalledTimes(1);
    expect(mockFetchAiConnectorLogs).toHaveBeenCalledWith(12);
    expect(document.body.textContent).toContain("Recent access");
    expect(document.body.textContent).toContain("portfolio.read");
  });
});
