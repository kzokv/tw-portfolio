import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const mockFetchAiInboxBadge = vi.fn();
const mockFetchDraftBatches = vi.fn();
const mockFetchDraftBatch = vi.fn();

vi.mock("../../../features/ai-inbox/service", () => ({
  fetchAiInboxBadge: (...args: unknown[]) => mockFetchAiInboxBadge(...args),
  fetchDraftBatches: (...args: unknown[]) => mockFetchDraftBatches(...args),
  fetchDraftBatch: (...args: unknown[]) => mockFetchDraftBatch(...args),
  archiveDraftBatch: vi.fn(),
  confirmDraftRows: vi.fn(),
  deleteDraftBatch: vi.fn(),
  transitionDraftRows: vi.fn(),
  updateDraftRow: vi.fn(),
}));

vi.mock("../../../hooks/useEventStream", () => ({
  useEventStream: vi.fn(),
}));

import { AiInboxPanel } from "../../../components/transactions/AiInboxPanel";
import { buildMockTransactionDraftWidgetData } from "../../../components/chatgpt/mockTransactionDraftWidgetData";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AiInboxPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    const widget = buildMockTransactionDraftWidgetData();
    mockFetchAiInboxBadge.mockReset();
    mockFetchDraftBatches.mockReset();
    mockFetchDraftBatch.mockReset();
    mockFetchAiInboxBadge.mockResolvedValue({
      openBatchCount: 1,
      actionRequiredRowCount: 2,
      readyRowCount: 3,
      latestBatchId: widget.batch.id,
    });
    mockFetchDraftBatches.mockResolvedValue([
      {
        ...widget.batch,
        deepLinkUrl: widget.deepLinkUrl ?? "/transactions?tab=ai-inbox",
      },
    ]);
    mockFetchDraftBatch.mockResolvedValue({
      batch: {
        ...widget.batch,
        deepLinkUrl: widget.deepLinkUrl ?? "/transactions?tab=ai-inbox",
      },
      rows: widget.rows,
      unsupportedItems: widget.unsupportedItems,
      deepLinkUrl: widget.deepLinkUrl ?? "/transactions?tab=ai-inbox",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("surfaces connector provenance and deep-link handoff details for mcp batches", async () => {
    await act(async () => root.render(<AiInboxPanel locale="en" />));
    await flushEffects();

    expect(document.body.textContent).toContain("Connector provenance");
    expect(document.body.textContent).toContain("ChatGPT connector");
    expect(document.body.textContent).toContain("capped snippets");
    expect(document.body.textContent).toContain("Open deep link");
  });

  it("disables mutation controls for read-only shared-context permissions", async () => {
    await act(async () => root.render(
      <AiInboxPanel
        locale="en"
        permissions={{
          canReadAiDrafts: true,
          canManageAccounts: false,
          canWriteTransactions: false,
          canCreateDrafts: false,
          canEditDrafts: false,
          canArchiveDrafts: false,
          canDeleteDrafts: false,
          hasAnyDelegatedWrite: false,
        }}
      />,
    ));
    await flushEffects();

    const buttonByText = (text: string) =>
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes(text)) as HTMLButtonElement | undefined;
    expect(buttonByText("Exclude")?.disabled).toBe(true);
    expect(buttonByText("Reinclude")?.disabled).toBe(true);
    expect(buttonByText("Reject")?.disabled).toBe(true);
    expect(buttonByText("Archive")?.disabled).toBe(true);
    expect(buttonByText("Delete")?.disabled).toBe(true);
    expect(buttonByText("Post selected")?.disabled).toBe(true);
    expect(buttonByText("Edit row")?.disabled).toBe(true);
    expect(
      Array.from(document.querySelectorAll("input[type='checkbox']"))
        .every((input) => (input as HTMLInputElement).disabled),
    ).toBe(true);
  });
});
