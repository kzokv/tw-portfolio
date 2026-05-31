import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AiConnectorConnectionDto, AiConnectorPolicySettingsDto } from "@vakwen/shared-types";
import type { AiConnectorsResponse } from "../../../features/ai-inbox/service";

const mockFetchAiConnectors = vi.fn();
const mockUpdateAiConnector = vi.fn();
const mockRevokeAiConnector = vi.fn();

vi.mock("../../../features/ai-inbox/service", () => ({
  fetchAiConnectors: (...args: unknown[]) => mockFetchAiConnectors(...args),
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

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AiConnectorsSettingsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockFetchAiConnectors.mockReset();
    mockUpdateAiConnector.mockReset();
    mockRevokeAiConnector.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("announces policy-disabled scope controls and page-level recovery", async () => {
    const response: AiConnectorsResponse = {
      connections: [buildConnection()],
      accessLogs: [],
      policy: buildPolicy({ groupToggles: { read: false, drafts: false, write: false } }),
    };
    mockFetchAiConnectors.mockResolvedValue(response);

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
    const response: AiConnectorsResponse = {
      connections: [buildConnection({ status: "pending", lastUsedAt: null })],
      accessLogs: [],
      policy: buildPolicy(),
    };
    mockFetchAiConnectors.mockResolvedValue(response);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    const statusRegions = Array.from(document.querySelectorAll("[role='status']"));
    expect(statusRegions.some((region) => region.textContent?.includes("Waiting for ChatGPT"))).toBe(true);
  });

  it("keeps transaction:write as a reconnect-only advanced scope when it was not granted at consent", async () => {
    const response: AiConnectorsResponse = {
      connections: [buildConnection()],
      accessLogs: [],
      policy: buildPolicy(),
    };
    mockFetchAiConnectors.mockResolvedValue(response);

    await act(async () => root.render(<AiConnectorsSettingsClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("No tool-level overrides.");
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
});
