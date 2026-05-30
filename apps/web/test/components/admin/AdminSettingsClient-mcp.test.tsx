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
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }
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
    oauthRedirectUriAllowlist: [],
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

function setTextareaValue(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
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

  it("shows redirect allowlist examples and saves exact redirect URI additions", async () => {
    mockGetJson.mockResolvedValue(buildPolicy({ groupToggles: { read: true, drafts: true, write: false } }));
    mockPostJson.mockResolvedValue({ freshAuthToken: "fresh-allowlist" });
    mockPatchJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, drafts: true, write: false },
      oauthRedirectUriAllowlist: [
        "https://connector.example.com/oauth/callback",
        "https://chatgpt.com/connector/oauth/custom123",
      ],
    }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const section = document.querySelector("[data-testid='admin-settings-mcp-section']");
    expect(section?.textContent).toContain("https://chatgpt.com/connector/oauth/<connector-id>");
    expect(section?.textContent).toContain("https://chatgpt.com/aip/<gpt-id>/oauth/callback");

    const textarea = document.querySelector(
      "[data-testid='admin-settings-mcp-redirect-allowlist']",
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();
    expect(textarea!.getAttribute("aria-describedby")).toContain("admin-settings-mcp-redirect-help");
    expect(textarea!.getAttribute("aria-describedby")).toContain("admin-settings-mcp-redirect-examples");
    expect(textarea!.hasAttribute("aria-invalid")).toBe(false);
    await act(async () => {
      setTextareaValue(
        textarea!,
        "https://connector.example.com/oauth/callback\nhttps://chatgpt.com/connector/oauth/custom123",
      );
    });

    const saveButton = Array.from(section!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save allowlist")) as HTMLButtonElement | undefined;
    expect(saveButton).toBeTruthy();
    expect(saveButton!.disabled).toBe(false);
    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockPatchJson).toHaveBeenCalledWith(
      "/admin/mcp/settings",
      expect.objectContaining({
        oauthRedirectUriAllowlist: [
          "https://connector.example.com/oauth/callback",
          "https://chatgpt.com/connector/oauth/custom123",
        ],
      }),
      { headers: { "x-vakwen-fresh-auth-at": "fresh-allowlist" } },
    );
  });

  it("keeps an invalid redirect allowlist draft resettable and accessible", async () => {
    const savedAllowlist = ["https://connector.example.com/oauth/callback"];
    mockGetJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, drafts: true, write: false },
      oauthRedirectUriAllowlist: savedAllowlist,
    }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const section = document.querySelector("[data-testid='admin-settings-mcp-section']");
    const textarea = document.querySelector(
      "[data-testid='admin-settings-mcp-redirect-allowlist']",
    ) as HTMLTextAreaElement | null;
    expect(section).toBeTruthy();
    expect(textarea).toBeTruthy();

    await act(async () => {
      setTextareaValue(textarea!, `${savedAllowlist[0]}\nnot-a-url`);
    });

    expect(textarea!.getAttribute("aria-invalid")).toBe("true");
    expect(textarea!.getAttribute("aria-describedby")).toContain("admin-settings-mcp-redirect-error");
    expect(section!.textContent).toContain("Each redirect URI must be a valid URL.");

    const resetButton = Array.from(section!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Reset allowlist")) as HTMLButtonElement | undefined;
    const saveButton = Array.from(section!.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Save allowlist")) as HTMLButtonElement | undefined;
    expect(resetButton).toBeTruthy();
    expect(saveButton).toBeTruthy();
    expect(resetButton!.disabled).toBe(false);
    expect(saveButton!.disabled).toBe(true);

    await act(async () => {
      resetButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(textarea!.value).toBe(savedAllowlist[0]);
    expect(textarea!.hasAttribute("aria-invalid")).toBe(false);
    expect(section!.textContent).not.toContain("Each redirect URI must be a valid URL.");
    expect(mockPatchJson).not.toHaveBeenCalled();
  });

  it("generates a 64-hex MCP OAuth token secret before rotating", async () => {
    mockGetJson.mockResolvedValue(buildPolicy({ groupToggles: { read: true, drafts: true, write: false } }));
    mockPostJson.mockResolvedValue({ freshAuthToken: "fresh-secret" });
    mockPatchJson.mockResolvedValue(buildPolicy({
      groupToggles: { read: true, drafts: true, write: false },
      oauthTokenSecretSet: true,
    }));

    await act(async () => root.render(<AdminSettingsClient initial={buildAppConfigDto()} />));
    await flushEffects();

    const rotate = document.querySelector(
      "[data-testid='admin-settings-mcp-oauth-token-secret-rotate-button']",
    ) as HTMLButtonElement | null;
    expect(rotate).toBeTruthy();
    await act(async () => {
      rotate!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const generate = document.querySelector(
      "[data-testid='admin-settings-mcp-oauth-token-secret-generate-button']",
    ) as HTMLButtonElement | null;
    expect(generate).toBeTruthy();
    await act(async () => {
      generate!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const submit = document.querySelector(
      "[data-testid='admin-settings-mcp-oauth-token-secret-rotate-submit']",
    ) as HTMLButtonElement | null;
    expect(submit).toBeTruthy();
    expect(submit!.disabled).toBe(false);
    await act(async () => {
      submit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockPatchJson).toHaveBeenCalledWith(
      "/admin/mcp/settings",
      expect.objectContaining({
        mcpOauthTokenSecret: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      { headers: { "x-vakwen-fresh-auth-at": "fresh-secret" } },
    );
  });
});
