import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatGptAccountManagerWidget } from "../../../components/chatgpt/ChatGptAccountManagerWidget";
import { buildMockAccountManagerWidgetData } from "../../../components/chatgpt/mockAccountManagerWidgetData";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("ChatGptAccountManagerWidget", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.openai;
  });

  it("creates and restores accounts through app-visible low-level tools", async () => {
    const initial = buildMockAccountManagerWidgetData();
    const next = structuredClone(initial);
    next.activeAccounts = [
      {
        id: "acct-new",
        name: "KR Brokerage",
        defaultCurrency: "KRW",
        accountType: "broker",
        feeProfileName: "Unassigned",
        status: "active",
      },
      ...next.activeAccounts,
    ];

    const restored = structuredClone(next);
    const restoredAccount = restored.deletedAccounts[0];
    restored.deletedAccounts = [];
    if (restoredAccount) {
      restored.activeAccounts.push({ ...restoredAccount, status: "active", deletedAt: null });
    }

    const callTool = vi.fn()
      .mockResolvedValueOnce({
        structuredContent: {
          account: {
            id: "acct-new",
            name: "KR Brokerage",
            defaultCurrency: "KRW",
            accountType: "broker",
          },
        },
      })
      .mockResolvedValueOnce({ structuredContent: next, _meta: next })
      .mockResolvedValueOnce({ structuredContent: { accountId: "acct-demo", finalName: "Demo Brokerage" } })
      .mockResolvedValueOnce({ structuredContent: restored, _meta: restored });

    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: initial,
      callTool,
    };

    await act(async () => root.render(<ChatGptAccountManagerWidget />));

    const nameInput = document.querySelector("input") as HTMLInputElement;
    const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      inputSetter?.call(nameInput, "KR Brokerage");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const addButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Add account"));
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(callTool).toHaveBeenNthCalledWith(1, "create_account", expect.objectContaining({ name: "KR Brokerage" }));
    expect(callTool).toHaveBeenNthCalledWith(2, "get_account_manager_component", {});
    expect(document.body.textContent).toContain("KR Brokerage");

    const restoreButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Restore"));
    await act(async () => {
      restoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(callTool).toHaveBeenNthCalledWith(3, "restore_account", { accountId: "acct-demo" });
    expect(callTool).toHaveBeenNthCalledWith(4, "get_account_manager_component", {});
  });

  it("refreshes from nested widget metadata after a low-level tool call", async () => {
    const initial = buildMockAccountManagerWidgetData();
    const refreshed = structuredClone(initial);
    refreshed.activeAccounts[0] = {
      ...refreshed.activeAccounts[0],
      name: "Cathay TW Brokerage Prime",
    };

    const callTool = vi.fn()
      .mockResolvedValueOnce({
        structuredContent: { accountId: "acct-tw", name: "Cathay TW Brokerage Prime" },
      })
      .mockResolvedValueOnce({
        structuredContent: { ok: true },
        _meta: { widget: refreshed },
      });

    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: initial,
      callTool,
    };

    await act(async () => root.render(<ChatGptAccountManagerWidget />));

    const editButton = document.querySelector('[data-testid="chatgpt-account-edit-acct-tw"]');
    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const nameInput = document.querySelector("input") as HTMLInputElement;
    const inputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      inputSetter?.call(nameInput, "Cathay TW Brokerage Prime");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Save changes"));
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(callTool).toHaveBeenNthCalledWith(1, "update_account", { accountId: "acct-tw", name: "Cathay TW Brokerage Prime" });
    expect(callTool).toHaveBeenNthCalledWith(2, "get_account_manager_component", {});
    expect(document.body.textContent).toContain("Cathay TW Brokerage Prime");
  });

  it("renders zh-TW frontend copy when locale is explicit", async () => {
    const initial = buildMockAccountManagerWidgetData();
    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: initial,
    };

    await act(async () => root.render(<ChatGptAccountManagerWidget locale="zh-TW" />));

    expect(document.body.textContent).toContain("account:manage 權限");
    expect(document.body.textContent).toContain("新增帳戶");
    expect(document.body.textContent).toContain("權限防護說明");
  });
});
