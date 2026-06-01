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

  it("creates and restores accounts through the bridge", async () => {
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
});
