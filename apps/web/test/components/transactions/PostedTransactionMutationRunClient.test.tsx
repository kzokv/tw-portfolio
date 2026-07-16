import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostedTransactionMutationRunDto } from "@vakwen/shared-types";
import { PostedTransactionMutationRunClient } from "../../../components/transactions/PostedTransactionMutationRunClient";

const getPostedTransactionMutationRun = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../../../features/portfolio/services/transactionMutationService", () => ({
  getPostedTransactionMutationRun: (...args: unknown[]) => getPostedTransactionMutationRun(...args),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildRun(
  rebuildStatus: PostedTransactionMutationRunDto["rebuildStatus"] = "running",
): PostedTransactionMutationRunDto {
  return {
    runId: "run-1",
    previewId: "preview-1",
    operation: "delete",
    status: rebuildStatus === "partially_failed" ? "partially_failed" : "running",
    rebuildStatus,
    createdAt: "2026-07-16T12:00:00.000Z",
    startedAt: "2026-07-16T12:01:00.000Z",
    completedAt: rebuildStatus === "running" ? null : "2026-07-16T12:02:00.000Z",
    reason: "Remove duplicate broker transactions",
    warnings: rebuildStatus === "partially_failed" ? ["Use portfolio replay for the failed scope."] : [],
    blockers: [],
    errors: [],
    summary: {
      quantityDelta: -10,
      costBasisDelta: -1_000,
      realizedPnlDelta: 0,
      cashDelta: 1_000,
      reopenedDividendCount: 0,
      deletedDividendCount: 0,
    },
    affectedAccountIds: ["acc-1", "acc-2"],
    affectedTickers: [{ ticker: "2330", marketCode: "TW" }],
    scopes: [{
      accountId: "acc-1",
      accountName: "Main account",
      ticker: "2330",
      marketCode: "TW",
      earliestReplayDate: "2026-07-15",
      accountRevision: 1,
      fingerprint: "scope-fingerprint",
      status: rebuildStatus === "partially_failed" ? "failed" : "running",
      errorMessage: rebuildStatus === "partially_failed" ? "Snapshot provider unavailable" : null,
      replayRunId: "run-1",
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

describe("PostedTransactionMutationRunClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    getPostedTransactionMutationRun.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("polls a running rebuild and renders terminal partial-failure recovery detail", async () => {
    getPostedTransactionMutationRun.mockResolvedValue(buildRun("partially_failed"));
    await act(async () => {
      root.render(<PostedTransactionMutationRunClient initialRun={buildRun()} locale="en" />);
    });

    expect(container.textContent).toContain("running");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(getPostedTransactionMutationRun).toHaveBeenCalledWith("run-1");
    expect(container.textContent).toContain("partially_failed");
    expect(container.textContent).toContain("Snapshot provider unavailable");
    expect(container.textContent).toContain("Use portfolio replay for the failed scope.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getPostedTransactionMutationRun).toHaveBeenCalledTimes(1);
  });
});
