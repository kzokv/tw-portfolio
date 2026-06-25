import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { McpOAuthConsentRequestDto } from "@vakwen/shared-types";

const mockFetchMcpOAuthConsent = vi.fn();
const mockApproveMcpOAuthConsent = vi.fn();
const mockDenyMcpOAuthConsent = vi.fn();

vi.mock("../../../features/ai-inbox/service", () => ({
  fetchMcpOAuthConsent: (...args: unknown[]) => mockFetchMcpOAuthConsent(...args),
  approveMcpOAuthConsent: (...args: unknown[]) => mockApproveMcpOAuthConsent(...args),
  denyMcpOAuthConsent: (...args: unknown[]) => mockDenyMcpOAuthConsent(...args),
}));

import { ChatGptConnectorAuthorizeClient } from "../../../components/connectors/ChatGptConnectorAuthorizeClient";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildConsent(overrides: Partial<McpOAuthConsentRequestDto> = {}): McpOAuthConsentRequestDto {
  return {
    requestId: "req-1",
    clientId: "chatgpt",
    redirectUri: "http://localhost:5555/callback",
    resource: "http://localhost:4000/mcp",
    scopes: ["portfolio:mcp_read", "transaction_draft:create"],
    csrfToken: "csrf-1",
    expiresAt: "2026-05-23T12:00:00.000Z",
    policy: {
      maxConnectorLifetimeDays: 90,
      groupToggles: { read: true, drafts: true, write: true },
    },
    ...overrides,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`button not found: ${text}`);
  return button as HTMLButtonElement;
}

describe("ChatGptConnectorAuthorizeClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockFetchMcpOAuthConsent.mockReset();
    mockApproveMcpOAuthConsent.mockReset();
    mockDenyMcpOAuthConsent.mockReset();
    window.history.pushState(null, "", "/connectors/chatgpt/authorize?requestId=req-1");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders resource and redirect URI as fully inspectable values", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      redirectUri: "http://localhost:5555/callback/path?state=inspect",
      resource: "http://localhost:4000/mcp",
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    expect(document.body.textContent).toContain("http://localhost:4000/mcp");
    expect(document.body.textContent).toContain("http://localhost:5555/callback/path?state=inspect");
    const redirectLink = document.querySelector("a[href='http://localhost:5555/callback/path?state=inspect']");
    expect(redirectLink).not.toBeNull();
    expect(redirectLink?.className).toContain("break-all");
  });

  it("explains policy-blocked approvals while keeping denial available", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      policy: {
        maxConnectorLifetimeDays: 90,
        groupToggles: { read: false, drafts: false, write: false },
      },
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    const alert = document.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("Admin policy has disabled every requested MCP tool group");
    expect(buttonByText("Approve").disabled).toBe(true);
    expect(buttonByText("Deny").disabled).toBe(false);
  });

  it("offers recovery actions when an authorization request cannot be loaded", async () => {
    mockFetchMcpOAuthConsent
      .mockRejectedValueOnce(new Error("OAuth consent request is no longer pending"))
      .mockResolvedValueOnce(buildConsent());

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    expect(document.querySelector("[role='alert']")?.textContent).toContain("OAuth consent request is no longer pending");
    expect(buttonByText("Start again in ChatGPT")).not.toBeNull();

    await act(async () => {
      buttonByText("Retry request").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(mockFetchMcpOAuthConsent).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("http://localhost:4000/mcp");
  });

  it("keeps transaction:write unchecked until the user explicitly opts into advanced posting", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      scopes: ["portfolio:mcp_read", "transaction_draft:create", "transaction:write"],
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    const postingLabel = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("Post confirmed transactions"));
    const postingCheckbox = postingLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(postingCheckbox?.checked).toBe(false);
    expect(document.body.textContent).toContain("Advanced scope. Off by default");
    expect(document.body.textContent).toContain("post_transaction_draft_rows");
  });

  it("shows account management consent as a standard checked scope", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      scopes: ["portfolio:mcp_read", "account:manage", "transaction_draft:create"],
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient />));
    await flushEffects();

    const accountLabel = Array.from(document.querySelectorAll("label"))
      .find((candidate) => candidate.textContent?.includes("Manage accounts"));
    const accountCheckbox = accountLabel?.querySelector("input[type='checkbox']") as HTMLInputElement | null;

    expect(accountCheckbox?.checked).toBe(true);
    expect(accountCheckbox?.disabled).toBe(false);
  });

  it("renders zh-TW connector labels and scope copy when locale is explicit", async () => {
    mockFetchMcpOAuthConsent.mockResolvedValue(buildConsent({
      scopes: ["portfolio:mcp_read", "account:manage", "transaction:write"],
    }));

    await act(async () => root.render(<ChatGptConnectorAuthorizeClient locale="zh-TW" />));
    await flushEffects();

    expect(document.body.textContent).toContain("連接 ChatGPT");
    expect(document.body.textContent).toContain("管理帳戶");
    expect(document.body.textContent).toContain("送出已確認交易");
  });
});
