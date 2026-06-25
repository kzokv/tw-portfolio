import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ChatGptTransactionDraftWidgetDto } from "@vakwen/shared-types";
import { ChatGptTransactionDraftWidget } from "../../../components/chatgpt/ChatGptTransactionDraftWidget";
import { buildMockTransactionDraftWidgetData } from "../../../components/chatgpt/mockTransactionDraftWidgetData";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

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

function controlByLabel(text: string): HTMLInputElement | HTMLTextAreaElement {
  const label = Array.from(document.querySelectorAll("label"))
    .find((candidate) => candidate.textContent?.includes(text));
  const control = label?.querySelector("input, textarea, select");
  if (!control) throw new Error(`control not found: ${text}`);
  return control as HTMLInputElement | HTMLTextAreaElement;
}

async function setControlValue(text: string, value: string) {
  const control = controlByLabel(text);
  const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set;
  await act(async () => {
    valueSetter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("ChatGptTransactionDraftWidget", () => {
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

  it("renders from the bridge and posts through app-visible low-level tools without direct API access", async () => {
    const initial = buildMockTransactionDraftWidgetData();
    const posted: ChatGptTransactionDraftWidgetDto = {
      ...initial,
      batch: { ...initial.batch, version: initial.batch.version + 1 },
      rows: initial.rows.map((row) => initial.selectedRowIds.includes(row.id)
        ? {
            ...row,
            state: "confirmed",
            confirmedAt: "2026-05-27T11:00:00.000Z",
            confirmedTradeEventId: `txn-${row.id}`,
            version: row.version + 1,
          }
        : row),
      postingResult: {
        batchId: initial.batch.id,
        batchVersion: initial.batch.version + 1,
        postedRowIds: initial.selectedRowIds,
        createdTransactionIds: initial.selectedRowIds.map((rowId) => `txn-${rowId}`),
        remainingUnresolvedRowIds: ["row-3", "row-5"],
        requiresTypedConfirmation: false,
        typedConfirmationPhrase: null,
        grossValueAmount: 1_382_000,
        grossValueCurrency: "TWD",
        deepLinkUrl: initial.deepLinkUrl,
        auditEventIds: ["audit-1"],
      },
    };

    const callTool = vi.fn()
      .mockResolvedValueOnce({ structuredContent: posted, _meta: { widget: posted, postResult: posted.postingResult } })
      .mockResolvedValueOnce({ structuredContent: posted, _meta: { widget: posted } });
    const setWidgetState = vi.fn();
    const setOpenInAppUrl = vi.fn();

    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "post", selectedRowIds: initial.selectedRowIds, editRowId: null, confirmText: "POST 3 TRADES" },
      callTool,
      setWidgetState,
      setOpenInAppUrl,
      notifyIntrinsicHeight: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget />));
    await flushEffects();

    expect(document.body.textContent).toContain("MCP Apps bridge only");
    expect(document.body.textContent).toContain("High-value confirmation");
    expect(setOpenInAppUrl).toHaveBeenCalledWith({ href: initial.deepLinkUrl });

    await act(async () => {
      buttonByText("Post selected").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(callTool).toHaveBeenCalledWith(
      "post_transaction_draft_rows",
      expect.objectContaining({
        batchId: initial.batch.id,
        expectedBatchVersion: initial.batch.version,
        rowIds: initial.selectedRowIds,
      }),
    );
    expect(document.body.textContent).toContain("Latest posting result");
    expect(setWidgetState).toHaveBeenCalled();
  });

  it("keeps the widget in confirmation mode when the MCP post tool requires a phrase", async () => {
    const initial = buildMockTransactionDraftWidgetData();
    initial.selectedRowIds = ["row-2"];
    initial.grossValueText = "USD 2.98K";
    const mcpConfirmationRequired = {
      outcome: "confirmation_required",
      batchId: initial.batch.id,
      batchVersion: initial.batch.version,
      postedRowIds: [],
      createdTransactionIds: [],
      remainingUnresolvedRowIds: [],
      confirmation: {
        selectedRowCount: 1,
        totalRowsRequested: 1,
        typedPhraseRequired: "POST 1 TRADES",
        typedPhraseSatisfied: false,
        grossValueTwd: 1_200_000,
      },
      deepLinkUrl: initial.deepLinkUrl,
      eventIds: [],
      rowErrors: [],
    };
    const callTool = vi.fn()
      .mockResolvedValueOnce({ structuredContent: mcpConfirmationRequired })
      .mockResolvedValueOnce({ structuredContent: initial, _meta: { widget: initial } });

    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "post", selectedRowIds: initial.selectedRowIds, editRowId: null, confirmText: "" },
      callTool,
      setWidgetState: vi.fn(),
      notifyIntrinsicHeight: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget />));
    await flushEffects();

    await act(async () => {
      buttonByText("Post selected").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("Confirmation required");
    expect(document.body.textContent).toContain("Type POST 1 TRADES before posting these rows.");
    expect(document.body.textContent).toContain("Typed confirmation required before posting.");
  });

  it("omits blank edit fields from MCP row update patches", async () => {
    const initial = buildMockTransactionDraftWidgetData();
    const callTool = vi.fn().mockResolvedValue({ structuredContent: initial, _meta: { widget: initial } });

    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "review", selectedRowIds: initial.selectedRowIds, editRowId: "row-3", confirmText: "" },
      callTool,
      setWidgetState: vi.fn(),
      notifyIntrinsicHeight: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget />));
    await flushEffects();

    const select = document.querySelector("select") as HTMLSelectElement;
    const selectSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    await act(async () => {
      selectSetter?.call(select, "USD Brokerage");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await setControlValue("Commission", "0");
    await setControlValue("Tax", "0");
    await setControlValue("Note", "");
    await setControlValue("Source snippet", "");

    await act(async () => {
      buttonByText("Save row").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(callTool).toHaveBeenCalledWith("update_transaction_draft_rows", {
      batchId: initial.batch.id,
      rows: [{
        rowId: "row-3",
        expectedVersion: 2,
        patch: {
          accountName: "USD Brokerage",
          commissionAmount: 0,
          marketCode: "AU",
          quantity: 80,
          taxAmount: 0,
          unitPrice: 43.18,
        },
      }],
    });
  });

  it("renders account names and posting preview warnings", async () => {
    const initial = buildMockTransactionDraftWidgetData();
    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "post", selectedRowIds: initial.selectedRowIds, editRowId: null, confirmText: "" },
      notifyIntrinsicHeight: vi.fn(),
      setWidgetState: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget />));
    await flushEffects();

    expect(document.body.textContent).toContain("Cathay TW Brokerage");
    expect(document.body.textContent).toContain("Manual zero commission differs from calculated fee");
    expect(document.body.textContent).toContain("Post selected");
  });

  it("renders zh-TW widget chrome when locale is explicit", async () => {
    const initial = buildMockTransactionDraftWidgetData();
    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "review", selectedRowIds: initial.selectedRowIds, editRowId: null, confirmText: "" },
      notifyIntrinsicHeight: vi.fn(),
      setWidgetState: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget locale="zh-TW" />));
    await flushEffects();

    expect(document.body.textContent).toContain("Vakwen 交易草稿");
    expect(document.body.textContent).toContain("僅限 MCP Apps bridge");
    expect(document.body.textContent).toContain("在 Vakwen 開啟");
  });

  it("filters the server posting preview to the current ready selection", async () => {
    const initial = buildMockTransactionDraftWidgetData();
    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "post", selectedRowIds: ["row-2"], editRowId: null, confirmText: "" },
      notifyIntrinsicHeight: vi.fn(),
      setWidgetState: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget />));
    await flushEffects();

    expect(document.querySelector('[data-testid="chatgpt-widget-preview-row-row-1"]')).toBeNull();
    expect(document.querySelector('[data-testid="chatgpt-widget-preview-row-row-2"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Manual zero commission differs from calculated fee");
  });

  it("falls back to client preview rows when the server preview lacks the selected row", async () => {
    const initial = buildMockTransactionDraftWidgetData();
    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "post", selectedRowIds: ["row-4"], editRowId: null, confirmText: "" },
      notifyIntrinsicHeight: vi.fn(),
      setWidgetState: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget />));
    await flushEffects();

    expect(document.querySelector('[data-testid="chatgpt-widget-preview-row-row-4"]')).not.toBeNull();
    expect(document.body.textContent).toContain("0050");
  });

  it("renders readable preview account names when the preview payload only carries account ids", async () => {
    const initial = buildMockTransactionDraftWidgetData();
    if (!initial.postingPreview) throw new Error("posting preview missing in fixture");
    initial.postingPreview.rows = initial.postingPreview.rows.map((row) => ({
      ...row,
      accountName: row.rowId === "row-2" ? "" : row.accountName,
    }));
    initial.postingPreview.groups = initial.postingPreview.groups.map((group) => ({
      ...group,
      accountName: group.accountId === "us-brokerage" ? "" : group.accountName,
    }));

    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "post", selectedRowIds: ["row-2"], editRowId: null, confirmText: "" },
      notifyIntrinsicHeight: vi.fn(),
      setWidgetState: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget />));
    await flushEffects();

    expect(document.querySelector('[data-testid="chatgpt-widget-preview-row-row-2"]')?.textContent).toContain("USD Brokerage");
    expect(document.body.textContent).toContain("USD Brokerage");
  });

  it("prefills unresolved account edits from accountNameInput and shows row validation details", async () => {
    const initial = buildMockTransactionDraftWidgetData();

    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "review", selectedRowIds: initial.selectedRowIds, editRowId: "row-3", confirmText: "" },
      notifyIntrinsicHeight: vi.fn(),
      setWidgetState: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget />));
    await flushEffects();

    expect(controlByLabel("Account").value).toBe("AU Brokerage");
    expect(controlByLabel("Market").value).toBe("AU");
    expect(document.body.textContent).toContain("Validation details");
    expect(document.body.textContent).toContain("Account is ambiguous");
  });

  it("shows reconnect guidance when transaction:write has not been granted", async () => {
    const initial = buildMockTransactionDraftWidgetData();
    initial.permissions = {
      ...initial.permissions,
      canPost: false,
      writeScopeGranted: false,
      requiresWriteReconsent: true,
    };

    window.openai = {
      toolOutput: initial,
      toolResponseMetadata: { widget: initial },
      widgetState: { mode: "post", selectedRowIds: initial.selectedRowIds, editRowId: null, confirmText: "" },
      notifyIntrinsicHeight: vi.fn(),
      setWidgetState: vi.fn(),
    };

    await act(async () => root.render(<ChatGptTransactionDraftWidget />));
    await flushEffects();

    expect(document.body.textContent).toContain("Reconnect in ChatGPT and opt in during consent");
    expect(buttonByText("Post selected").disabled).toBe(true);
  });
});
