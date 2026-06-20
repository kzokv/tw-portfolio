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
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
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

  it("renders responsive section controls and policy recovery messaging", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy({ groupToggles: { read: false, drafts: false, write: false } }),
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("AI Connectors");
    expect(document.querySelector("[data-testid='ai-connectors-mobile-tab-select']")).not.toBeNull();
    expect(document.querySelector("[data-testid='ai-connectors-tab-connections']")).not.toBeNull();
    const alert = document.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("Admin policy has disabled all MCP tool groups");
  });

  it("keeps the active ChatGPT connector visible first and collapses revoked history by default", async () => {
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [
        buildConnection({ id: "revoked-1", status: "revoked", displayName: "Old ChatGPT" }),
        buildConnection({ id: "conn-1", status: "active", displayName: "Primary ChatGPT" }),
        buildConnection({ id: "pending-1", provider: "self_hosted", status: "pending", displayName: "Lab Connector" }),
      ],
      policy: buildPolicy(),
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    const cards = Array.from(document.querySelectorAll("[data-testid^='ai-connector-']"));
    expect(cards[0]?.textContent).toContain("Primary ChatGPT");
    expect(document.body.textContent).not.toContain("Connection tools");
    const history = document.querySelector("[data-testid='ai-connectors-history']") as HTMLDetailsElement | null;
    expect(history).not.toBeNull();
    expect(history?.open).toBe(false);
    expect(history?.textContent).toContain("1 hidden connection");
  });

  it("renders the MCP tools tab as the only searchable tool surface", async () => {
    mockUpdateAiConnector.mockResolvedValue(buildConnection({
      toolToggles: { get_daily_review_report: false },
    }));
    mockFetchAiConnectorSummary.mockResolvedValue({
      connections: [buildConnection()],
      policy: buildPolicy(),
      toolCatalog: [
        buildToolCatalogEntry({ name: "get_daily_review_report" }),
        buildToolCatalogEntry({ name: "create_account", scope: "account:manage", group: "write", accessKind: "write" }),
        buildToolCatalogEntry({
          name: "delete_draft",
          scope: "transaction_draft:delete",
          group: "drafts",
          accessKind: "draft_delete",
          availability: "unavailable",
          unavailableReason: "Draft tools disabled.",
        }),
      ],
    } satisfies AiConnectorSummaryResponse);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-tab-tools']")).not.toBeNull();
    expect(document.querySelector("[data-testid='ai-connectors-mobile-tab-select']")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Connection tools");

    await act(async () => {
      (document.querySelector("[data-testid='ai-connectors-tab-tools']") as HTMLButtonElement | null)?.click();
    });
    await flushEffects();

    expect(document.querySelector("[data-testid='ai-connectors-tool-search']")).not.toBeNull();
    expect(document.querySelector("[data-testid='ai-connectors-tool-group-filter']")).not.toBeNull();
    expect(document.querySelector("[data-testid='ai-connectors-tool-availability-filter']")).not.toBeNull();
    expect(document.body.textContent).toContain("get_daily_review_report");
    expect(document.body.textContent).toContain("Available");
    expect(document.body.textContent).toContain("delete_draft");
    expect(document.body.textContent).toContain("Unavailable");

    const search = document.querySelector("[data-testid='ai-connectors-tool-search']") as HTMLInputElement;
    setInputValue(search, "daily");
    expect(document.body.textContent).toContain("get_daily_review_report");
    expect(document.body.textContent).not.toContain("create_account");

    const availability = document.querySelector("[data-testid='ai-connectors-tool-availability-filter']") as HTMLSelectElement;
    setSelectValue(availability, "unavailable");
    expect(document.body.textContent).toContain("No tools match");

    setInputValue(search, "");
    expect(document.body.textContent).toContain("delete_draft");
    expect(document.body.textContent).not.toContain("get_daily_review_report");

    const group = document.querySelector("[data-testid='ai-connectors-tool-group-filter']") as HTMLSelectElement;
    setSelectValue(group, "read");
    expect(document.body.textContent).toContain("No tools match");

    setSelectValue(availability, "all");
    expect(document.body.textContent).toContain("get_daily_review_report");
    const reportLabel = Array.from(document.querySelectorAll("label"))
      .find((label) => label.textContent?.includes("get_daily_review_report"));
    const reportToggle = reportLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;
    expect(reportToggle).not.toBeNull();
    await act(async () => {
      reportToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mockUpdateAiConnector).toHaveBeenCalledWith("conn-1", {
      toolToggles: { get_daily_review_report: false },
    });
  });

  it("loads access logs after the summary resolves", async () => {
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

    expect(mockFetchAiConnectorLogs).toHaveBeenCalledWith(12);
    expect(document.querySelector("[data-testid='ai-connectors-tab-access']")).not.toBeNull();
  });
});
