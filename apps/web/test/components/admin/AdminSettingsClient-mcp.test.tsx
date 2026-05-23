import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AiConnectorPolicySettingsDto } from "@vakwen/shared-types";

const mockGetJson = vi.fn();
const mockPatchJson = vi.fn();
const mockPostJson = vi.fn();

vi.mock("../../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
  getJson: (...args: unknown[]) => mockGetJson(...args),
  patchJson: (...args: unknown[]) => mockPatchJson(...args),
  postJson: (...args: unknown[]) => mockPostJson(...args),
}));

let mockParams = new URLSearchParams({ tab: "mcp" });

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/admin/settings",
  useSearchParams: () => mockParams,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import { AdminSettingsClient } from "../../../components/admin/AdminSettingsClient";
import { buildAppConfigDto } from "../../fixtures/appConfigDto";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildPolicy(overrides: Partial<AiConnectorPolicySettingsDto> = {}): AiConnectorPolicySettingsDto {
  return {
    enabled: true,
    maxActiveConnectionsPerUser: 3,
    allowedProviders: { chatgpt: true, self_hosted: true },
    groupToggles: { read: false, drafts: false, write: false },
    inactivityExpiryDays: 90,
    expirationWarningDays: 7,
    freshAuthMaxAgeMs: 600_000,
    maxConnectorLifetimeDays: 90,
    oauthPublicIssuer: "https://api.example.com",
    oauthTokenSecretSet: true,
    updatedAt: "2026-05-23T12:00:00.000Z",
    ...overrides,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminSettingsClient — MCP settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockGetJson.mockReset();
    mockPatchJson.mockReset();
    mockPostJson.mockReset();
    mockParams = new URLSearchParams({ tab: "mcp" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("warns admins when every MCP tool group is disabled", async () => {
    mockGetJson.mockResolvedValue(buildPolicy());

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    expect(mockGetJson).toHaveBeenCalledWith("/admin/mcp/settings");
    const alerts = Array.from(document.querySelectorAll("[role='alert']"));
    expect(alerts.some((alert) => alert.textContent?.includes("All MCP tool groups are disabled"))).toBe(true);
  });

  it("edits numeric MCP limits locally and saves them explicitly", async () => {
    mockGetJson.mockResolvedValue(buildPolicy({ groupToggles: { read: true, drafts: true, write: false } }));
    mockPostJson.mockResolvedValue({ freshAuthToken: "fresh-1" });
    mockPatchJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, drafts: true, write: false },
      maxActiveConnectionsPerUser: 10,
    }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const section = document.querySelector("[data-testid='admin-settings-mcp-section']");
    expect(section).not.toBeNull();
    const maxActiveInput = Array.from(section!.querySelectorAll("input[type='number']"))
      .find((input) => input.closest("label")?.textContent?.includes("Max active connectors")) as HTMLInputElement | undefined;
    expect(maxActiveInput).toBeTruthy();

    await act(async () => {
      setInputValue(maxActiveInput!, "10");
    });

    expect(mockPostJson).not.toHaveBeenCalled();
    expect(mockPatchJson).not.toHaveBeenCalled();

    const saveButton = Array.from(section!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save limits")) as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();
    expect(saveButton!.disabled).toBe(false);
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockPostJson).toHaveBeenCalledWith("/admin/mcp/fresh-auth", {});
    expect(mockPatchJson).toHaveBeenCalledWith(
      "/admin/mcp/settings",
      expect.objectContaining({ maxActiveConnectionsPerUser: 10 }),
      { headers: { "x-vakwen-fresh-auth-at": "fresh-1" } },
    );
  });
});
