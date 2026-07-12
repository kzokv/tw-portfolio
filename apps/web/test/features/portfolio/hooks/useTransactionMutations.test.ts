import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { TransactionHistoryItemDto } from "@vakwen/shared-types";
import {
  useTransactionMutations,
  type UseTransactionMutationsResult,
} from "../../../../features/portfolio/hooks/useTransactionMutations";
import type { AppDictionary } from "../../../../lib/i18n";

// ---------------------------------------------------------------------------
// Module mocks (hoisted by vitest)
// ---------------------------------------------------------------------------

let capturedOnEvent: ((data: unknown) => void) | null = null;

vi.mock("../../../../hooks/useEventStream", () => ({
  useEventStream: (opts: { onEvent: (data: unknown) => void }) => {
    capturedOnEvent = opts.onEvent;
  },
}));

vi.mock("../../../../features/portfolio/services/transactionMutationService", () => ({
  previewImpact: vi.fn(),
  previewDividendDelete: vi.fn(),
  deleteTransaction: vi.fn(),
  patchTransaction: vi.fn(),
}));

import {
  previewImpact,
  previewDividendDelete,
  deleteTransaction,
} from "../../../../features/portfolio/services/transactionMutationService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockDict = {
  mutations: {
    deleteSuccessMessage: "Deleted successfully",
    editSuccessMessage: "Updated successfully",
    recomputeCompleteMessage: "Recomputed successfully",
    recomputeRetryMessage: "Retrying recompute...",
    recomputeExhaustedMessage: "Recompute failed",
    recomputeTimeoutMessage: "Taking longer than expected",
    safetyNetMessage: "Portfolio updated.",
  },
} as unknown as AppDictionary;

const mockTx = {
  id: "tx-1",
  accountId: "acc-1",
  ticker: "2330",
} as TransactionHistoryItemDto;

// ---------------------------------------------------------------------------
// Wrapper component (no @testing-library/react dependency)
// ---------------------------------------------------------------------------

let result: UseTransactionMutationsResult;

function Harness({ refresh }: { refresh: () => Promise<void> }) {
  result = useTransactionMutations({ locale: "en", dict: mockDict, refresh });
  return null;
}

// ---------------------------------------------------------------------------
// Tests — safety net behavior
// ---------------------------------------------------------------------------

describe("useTransactionMutations — safety net", () => {
  let container: HTMLDivElement;
  let root: Root;
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    capturedOnEvent = null;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    refresh = vi.fn().mockResolvedValue(undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.mocked(previewImpact).mockResolvedValue({
      negativeLots: { wouldOccur: false, symbols: [] },
      affectedTransactionCount: 0,
      affectedHoldingCount: 0,
    } as never);

    vi.mocked(previewDividendDelete).mockResolvedValue({
      preview: {
        previewId: "preview-1",
        previewVersion: 1,
        fingerprint: "1234567890abcdef",
        accountId: "acc-1",
        targetTradeEventId: "tx-1",
        expiresAt: "2026-07-10T12:00:00.000Z",
      },
      affectedCounts: {
        dividendLedgerEntries: 0,
        cashLedgerEntries: 0,
        dividendDeductionEntries: 0,
        dividendSourceLines: 0,
        stockDividendPositionActions: 0,
      },
      affectedDividends: [],
      manualReceiptReentryLedgerEntryIds: [],
    });

    vi.mocked(deleteTransaction).mockResolvedValue({
      accountId: "acc-1",
      ticker: "2330",
    } as never);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    warnSpy.mockRestore();
    vi.useRealTimers();
    vi.mocked(previewImpact).mockReset();
    vi.mocked(previewDividendDelete).mockReset();
    vi.mocked(deleteTransaction).mockReset();
  });

  function mount() {
    act(() => {
      root.render(createElement(Harness, { refresh }));
    });
  }

  /**
   * Trigger a delete mutation so that recomputingSymbols becomes non-empty
   * and the safety net effect activates.
   */
  async function triggerDelete() {
    // 1. Start delete — sets deleteTarget, fires previewImpact
    act(() => result.startDelete(mockTx));

    // 2. Flush the previewImpact promise
    await act(async () => {});

    // 3. Confirm delete — calls deleteTransaction + addRecomputing
    await act(async () => {
      await result.confirmDelete();
    });
  }

  it("fires on 10 s SSE silence after mutation", async () => {
    mount();
    await triggerDelete();

    expect(result.recomputingSymbols.size).toBeGreaterThan(0);

    // Advance past SAFETY_NET_MS (10 s) — safety net fires
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(refresh).toHaveBeenCalled();
    expect(result.message).toBe("Portfolio updated.");
    expect(result.errorMessage).toBe("");
    expect(result.recomputingSymbols.size).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      "[useTransactionMutations] SSE silent for recompute — safety net fired",
      expect.objectContaining({ symbols: expect.any(Array) }),
    );
  });

  it("is cancelled when SSE delivers before 10 s", async () => {
    mount();
    await triggerDelete();

    // Simulate SSE event arrival via the captured onEvent callback
    act(() => {
      capturedOnEvent!({
        type: "recompute_complete",
        accountId: "acc-1",
        ticker: "2330",
      });
    });

    // Advance past 10 s — safety net should NOT fire
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    // refresh called exactly once (by SSE handler), not by safety net
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.message).toBe("Recomputed successfully");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("settles destructive recompute when snapshot regeneration completes", async () => {
    mount();
    await triggerDelete();

    await act(async () => {
      capturedOnEvent!({
        type: "snapshots_generated",
        status: "ok",
        totalRows: 1,
        provisionalRows: 0,
        dateRange: null,
        generationRunId: "run-1",
        trigger: "dividend_destructive_replay",
        scopes: [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
      });
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.message).toBe("Recomputed successfully");
    expect(result.recomputingSymbols.size).toBe(0);
  });

  it("ignores an unrelated snapshot generation while a mutation is pending", async () => {
    mount();
    await triggerDelete();

    act(() => {
      capturedOnEvent!({
        type: "snapshots_generated",
        status: "ok",
        totalRows: 1,
        provisionalRows: 0,
        dateRange: null,
        generationRunId: "run-unrelated",
      });
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(result.recomputingSymbols.size).toBe(1);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.recomputingSymbols.size).toBe(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("keeps the negative-lot warning without requesting a destructive preview", async () => {
    vi.mocked(previewImpact).mockResolvedValueOnce({
      negativeLots: { wouldOccur: true, symbols: ["2330"], resultingQuantity: -100, ticker: "2330" },
      affectedTransactionCount: 1,
      affectedHoldingCount: 1,
    } as never);
    mount();

    act(() => result.startDelete(mockTx));
    await act(async () => {});

    expect(result.deletePreview?.negativeLots.wouldOccur).toBe(true);
    expect(result.isDeleteDialogOpen).toBe(true);
    expect(result.isDeletePreviewLoading).toBe(false);
    expect(previewDividendDelete).not.toHaveBeenCalled();
  });

  it("does not fire when no symbols are recomputing", async () => {
    mount();

    // No mutation triggered — just advance time
    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
