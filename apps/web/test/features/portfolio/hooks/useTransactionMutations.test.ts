import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type {
  PostedTransactionMutationPreviewDto,
  PostedTransactionMutationRunDto,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import {
  useTransactionMutations,
  type UseTransactionMutationsResult,
} from "../../../../features/portfolio/hooks/useTransactionMutations";
import type { AppDictionary } from "../../../../lib/i18n";
import { ApiError } from "../../../../lib/api";

vi.mock("../../../../features/portfolio/services/transactionMutationService", () => ({
  confirmPostedTransactionMutation: vi.fn(),
  getPostedTransactionMutationRun: vi.fn(),
  previewPostedTransactionDeleteBatch: vi.fn(),
  previewPostedTransactionUpdateBatch: vi.fn(),
}));

import {
  confirmPostedTransactionMutation,
  getPostedTransactionMutationRun,
  previewPostedTransactionDeleteBatch,
  previewPostedTransactionUpdateBatch,
} from "../../../../features/portfolio/services/transactionMutationService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const mockDict = {
  mutations: {
    deleteSuccessMessage: "Deleted successfully",
    editSuccessMessage: "Updated successfully",
    recomputeCompleteMessage: "Recomputed successfully",
    recomputeRetryMessage: "Retrying recompute...",
    recomputeExhaustedMessage: "Recompute failed",
    recomputeTimeoutMessage: "Taking longer than expected",
    safetyNetMessage: "Portfolio updated.",
    deletePreviewRefreshed: "Impact refreshed. Review it and confirm again.",
  },
} as unknown as AppDictionary;

const mockTx = {
  id: "tx-1",
  accountId: "acc-1",
  ticker: "2330",
} as TransactionHistoryItemDto;

function buildPreview(operation: "delete" | "update" = "delete"): PostedTransactionMutationPreviewDto {
  return {
    previewId: "preview-1",
    previewVersion: 1,
    status: "ready",
    operation,
    reason: "User confirmed mutation from ticker history.",
    confirmationSummary: "1 transaction will change",
    confirmationDigest: "digest-1",
    fingerprint: "fingerprint-1",
    expiresAt: "2026-07-16T12:30:00.000Z",
    createdAt: "2026-07-16T12:00:00.000Z",
    batchLimit: 50,
    affectedAccountIds: ["acc-1"],
    affectedTickers: [{ ticker: "2330", marketCode: "TW" }],
    scopes: [{
      accountId: "acc-1",
      accountName: "Main",
      ticker: "2330",
      marketCode: "TW",
      earliestReplayDate: "2026-07-15",
      accountRevision: 1,
      fingerprint: "scope-fingerprint",
    }],
    warnings: [],
    blockers: [],
    errors: [],
    summary: {
      quantityDelta: -10,
      costBasisDelta: -1000,
      realizedPnlDelta: 0,
      cashDelta: 1000,
      reopenedDividendCount: 0,
      deletedDividendCount: 0,
    },
    page: {
      items: [{
        transactionId: "tx-1",
        status: operation === "delete" ? "deleted" : "changed",
        before: {
          transactionId: "tx-1",
          accountId: "acc-1",
          accountName: "Main",
          ticker: "2330",
          marketCode: "TW",
          priceCurrency: "TWD",
          tradeDate: "2026-07-15",
          side: "BUY",
          quantity: 10,
          unitPrice: 100,
          grossTradeValueAmount: 1000,
          commissionAmount: 0,
          taxAmount: 0,
          settlementAmount: 1000,
          settlementAvailable: true,
          bookedCostAmount: 1000,
          isDayTrade: false,
          feesSource: "CALCULATED",
        },
        after: operation === "delete"
          ? null
          : {
              transactionId: "tx-1",
              accountId: "acc-1",
              accountName: "Main",
              ticker: "2330",
              marketCode: "TW",
              priceCurrency: "TWD",
              tradeDate: "2026-07-16",
              side: "BUY",
              quantity: 12,
              unitPrice: 101,
              grossTradeValueAmount: 1212,
              commissionAmount: 0,
              taxAmount: 0,
              settlementAmount: 1212,
              settlementAvailable: true,
              bookedCostAmount: 1212,
              isDayTrade: false,
              feesSource: "CALCULATED",
            },
        impacts: {
          quantityDelta: 2,
          costBasisDelta: 212,
          realizedPnlDelta: 0,
          cashDelta: -212,
          reopenedDividendCount: 0,
          deletedDividendCount: 0,
        },
        warnings: [],
        blockers: [],
        errors: [],
      }],
      total: 1,
      limit: 50,
      offset: 0,
    },
    deepLinks: {
      previewPath: "/transactions/mutations/previews/preview-1",
      runPath: "/transactions/mutations/runs/run-1",
      transactionPath: "/transactions",
      previewUrl: null,
      runUrl: null,
    },
  };
}

function buildRun(rebuildStatus: PostedTransactionMutationRunDto["rebuildStatus"]): PostedTransactionMutationRunDto {
  return {
    runId: "run-1",
    previewId: "preview-1",
    operation: "delete",
    status: rebuildStatus === "failed" ? "failed" : "completed",
    rebuildStatus,
    createdAt: "2026-07-16T12:00:00.000Z",
    startedAt: "2026-07-16T12:01:00.000Z",
    completedAt: rebuildStatus === "running" ? null : "2026-07-16T12:02:00.000Z",
    reason: "User confirmed mutation from ticker history.",
    warnings: [],
    blockers: [],
    errors: rebuildStatus === "failed" ? [{ code: "posted_transaction_mutation_rebuild_unavailable", message: "Replay worker unavailable" }] : [],
    summary: {
      quantityDelta: -10,
      costBasisDelta: -1000,
      realizedPnlDelta: 0,
      cashDelta: 1000,
      reopenedDividendCount: 0,
      deletedDividendCount: 0,
    },
    affectedAccountIds: ["acc-1"],
    affectedTickers: [{ ticker: "2330", marketCode: "TW" }],
    scopes: [{
      accountId: "acc-1",
      accountName: "Main",
      ticker: "2330",
      marketCode: "TW",
      earliestReplayDate: "2026-07-15",
      accountRevision: 1,
      fingerprint: "scope-fingerprint",
    }],
    deepLinks: {
      previewPath: "/transactions/mutations/previews/preview-1",
      runPath: "/transactions/mutations/runs/run-1",
      transactionPath: "/transactions",
      previewUrl: null,
      runUrl: null,
    },
  };
}

let result: UseTransactionMutationsResult;

function Harness({
  onDeleteAccepted,
  refresh,
}: {
  onDeleteAccepted?: (transactionId: string) => void;
  refresh: () => Promise<void>;
}) {
  result = useTransactionMutations({ locale: "en", dict: mockDict, refresh, onDeleteAccepted });
  return null;
}

describe("useTransactionMutations", () => {
  let container: HTMLDivElement;
  let root: Root;
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let onDeleteAccepted: ReturnType<typeof vi.fn<(transactionId: string) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    refresh = vi.fn().mockResolvedValue(undefined);
    onDeleteAccepted = vi.fn();
    vi.mocked(previewPostedTransactionDeleteBatch).mockResolvedValue(buildPreview("delete"));
    vi.mocked(previewPostedTransactionUpdateBatch).mockResolvedValue(buildPreview("update"));
    vi.mocked(confirmPostedTransactionMutation).mockResolvedValue(buildRun("completed"));
    vi.mocked(getPostedTransactionMutationRun).mockResolvedValue(buildRun("completed"));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function mount() {
    act(() => {
      root.render(createElement(Harness, { refresh, onDeleteAccepted }));
    });
  }

  it("previews and confirms a delete mutation with canonical confirmation payload", async () => {
    mount();

    act(() => result.startDelete(mockTx));
    await act(async () => {});

    expect(result.deletePreview?.previewId).toBe("preview-1");
    expect(result.isDeleteDialogOpen).toBe(true);
    expect(previewPostedTransactionDeleteBatch).toHaveBeenCalledWith(
      "User requested a posted transaction deletion from ticker history.",
      [{ transactionId: "tx-1" }],
    );

    await act(async () => {
      await result.confirmDelete();
    });

    expect(confirmPostedTransactionMutation).toHaveBeenCalledWith("preview-1", expect.objectContaining({
      previewVersion: 1,
      operation: "delete",
      fingerprint: "fingerprint-1",
      confirmationDigest: "digest-1",
    }));
    expect(onDeleteAccepted).toHaveBeenCalledWith("tx-1");
    expect(refresh).toHaveBeenCalled();
    expect(result.message).toBe("Recomputed successfully");
    expect(result.recomputingIds.size).toBe(0);
  });

  it("refreshes a stale delete preview without confirming the replacement", async () => {
    const refreshedPreview = {
      ...buildPreview("delete"),
      previewId: "preview-2",
      previewVersion: 2,
      fingerprint: "fingerprint-2",
      confirmationDigest: "digest-2",
    };
    vi.mocked(previewPostedTransactionDeleteBatch)
      .mockResolvedValueOnce(buildPreview("delete"))
      .mockResolvedValueOnce(refreshedPreview);
    vi.mocked(confirmPostedTransactionMutation).mockRejectedValueOnce(
      new ApiError(
        "Underlying records changed after preview",
        409,
        "posted_transaction_mutation_preview_stale",
      ),
    );
    mount();

    act(() => result.startDelete(mockTx));
    await act(async () => {});
    await act(async () => {
      await result.confirmDelete();
    });

    expect(previewPostedTransactionDeleteBatch).toHaveBeenCalledTimes(2);
    expect(confirmPostedTransactionMutation).toHaveBeenCalledTimes(1);
    expect(result.deletePreview?.previewId).toBe("preview-2");
    expect(result.isDeleteDialogOpen).toBe(true);
    expect(result.message).toBe("Impact refreshed. Review it and confirm again.");
    expect(onDeleteAccepted).not.toHaveBeenCalled();
  });

  it("polls run status until rebuild completes", async () => {
    vi.mocked(confirmPostedTransactionMutation).mockResolvedValueOnce(buildRun("running"));
    vi.mocked(getPostedTransactionMutationRun)
      .mockResolvedValueOnce(buildRun("running"))
      .mockResolvedValueOnce(buildRun("completed"));
    mount();

    act(() => result.startDelete(mockTx));
    await act(async () => {});

    await act(async () => {
      await result.confirmDelete();
    });

    expect(result.recomputingIds.has("tx-1")).toBe(true);
    expect(result.message).toBe("Retrying recompute...");

    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
    });

    expect(getPostedTransactionMutationRun).toHaveBeenCalledWith("run-1");
    expect(refresh).toHaveBeenCalled();
    expect(result.message).toBe("Recomputed successfully");
    expect(result.recomputingIds.size).toBe(0);
  });

  it("surfaces rebuild failures from the canonical run status", async () => {
    vi.mocked(confirmPostedTransactionMutation).mockResolvedValueOnce(buildRun("failed"));
    mount();

    act(() => result.startDelete(mockTx));
    await act(async () => {});

    await act(async () => {
      await result.confirmDelete();
    });

    expect(result.message).toBe("");
    expect(result.errorMessage).toBe("Replay worker unavailable");
    expect(result.recomputingIds.size).toBe(0);
  });

  it("previews edit mutations and confirms them through the canonical update flow", async () => {
    mount();

    await act(async () => {
      await result.submitEdit("tx-1", { quantity: 12, price: 101 });
    });

    expect(result.isEditPreviewOpen).toBe(true);
    expect(result.editPreview?.operation).toBe("update");
    expect(previewPostedTransactionUpdateBatch).toHaveBeenCalledWith(
      "User confirmed a posted transaction update from ticker history.",
      [{ transactionId: "tx-1", patch: expect.objectContaining({ quantity: 12, unitPrice: 101, feeOverrideMode: "preserve_recorded" }) }],
    );

    await act(async () => {
      await result.confirmEdit();
    });

    expect(confirmPostedTransactionMutation).toHaveBeenCalledWith("preview-1", expect.objectContaining({
      operation: "update",
    }));
    expect(result.editingId).toBeNull();
    expect(refresh).toHaveBeenCalled();
    expect(result.message).toBe("Recomputed successfully");
  });

  it("marks edit confirmation as submitting while the canonical confirm request is in flight", async () => {
    let resolveRun!: (run: PostedTransactionMutationRunDto) => void;
    vi.mocked(confirmPostedTransactionMutation).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveRun = resolve;
      }),
    );
    mount();

    await act(async () => {
      await result.submitEdit("tx-1", { quantity: 12, price: 101 });
    });

    let confirmation!: Promise<void>;
    act(() => {
      confirmation = result.confirmEdit();
    });

    expect(result.isEditSubmitting).toBe(true);

    await act(async () => {
      resolveRun(buildRun("completed"));
      await confirmation;
    });

    expect(result.isEditSubmitting).toBe(false);
  });
});
