import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostedTransactionMutationPreviewDto } from "@vakwen/shared-types";
import { PostedTransactionMutationPreviewClient } from "../../../components/transactions/PostedTransactionMutationPreviewClient";

const getPostedTransactionMutationPreview = vi.fn();

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../../../features/portfolio/services/transactionMutationService", () => ({
  getPostedTransactionMutationPreview: (...args: unknown[]) => getPostedTransactionMutationPreview(...args),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

function buildPreview(): PostedTransactionMutationPreviewDto {
  return {
    previewId: "preview-1",
    previewVersion: 1,
    status: "ready",
    operation: "update",
    reason: "Correct posted prices after broker correction",
    confirmationSummary: "Update one posted transaction",
    confirmationDigest: "digest-1",
    fingerprint: "fingerprint-1",
    expiresAt: "2026-07-16T10:30:00.000Z",
    createdAt: "2026-07-16T10:00:00.000Z",
    batchLimit: 50,
    affectedAccountIds: ["acc-1"],
    affectedTickers: [{ ticker: "2330", marketCode: "TW" }],
    warnings: ["Manual re-entry may be required for one dividend receipt."],
    blockers: [],
    errors: [],
    deepLinks: {
      previewPath: "/transactions/mutations/previews/preview-1",
      runPath: null,
      transactionPath: "/transactions",
      previewUrl: null,
      runUrl: null,
    },
    scopes: [{
      accountId: "acc-1",
      accountName: "Main account",
      ticker: "2330",
      marketCode: "TW",
      earliestReplayDate: "2026-06-01",
      accountRevision: 1,
      fingerprint: "scope-fingerprint-1",
    }],
    summary: {
      quantityDelta: -5,
      costBasisDelta: -300,
      realizedPnlDelta: 250,
      cashDelta: 275,
      reopenedDividendCount: 1,
      deletedDividendCount: 0,
    },
    page: {
      offset: 0,
      limit: 50,
      total: 1,
      items: [{
        transactionId: "tx-1",
        status: "changed",
        note: null,
        warnings: ["manual re-entry required"],
        blockers: [],
        errors: [],
        before: {
          transactionId: "tx-1",
          accountId: "acc-1",
          accountName: "Main account",
          ticker: "2330",
          marketCode: "TW",
          tradeDate: "2026-06-01",
          side: "BUY",
          quantity: 10,
          unitPrice: 100,
          priceCurrency: "TWD",
          grossTradeValueAmount: 1_000,
          commissionAmount: 20,
          taxAmount: 30,
          settlementAmount: 1_050,
          settlementAvailable: true,
          bookedCostAmount: 1_050,
          isDayTrade: false,
          feesSource: "CALCULATED",
        },
        after: {
          transactionId: "tx-1",
          accountId: "acc-1",
          accountName: "Main account",
          ticker: "2330",
          marketCode: "TW",
          tradeDate: "2026-06-01",
          side: "SELL",
          quantity: 5,
          unitPrice: 110,
          priceCurrency: "TWD",
          grossTradeValueAmount: 550,
          commissionAmount: 20,
          taxAmount: 30,
          settlementAmount: 500,
          settlementAvailable: true,
          bookedCostAmount: null,
          isDayTrade: false,
          feesSource: "CALCULATED",
        },
        impacts: {
          quantityDelta: -5,
          cashDelta: 275,
          costBasisDelta: -300,
          realizedPnlDelta: 250,
          reopenedDividendCount: 1,
          deletedDividendCount: 0,
        },
      }],
    },
  };
}

describe("PostedTransactionMutationPreviewClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    getPostedTransactionMutationPreview.mockReset();
    getPostedTransactionMutationPreview.mockResolvedValue(buildPreview());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("renders an inspection-only preview with booked cost facts and manual re-entry guidance", async () => {
    await act(async () => {
      root.render(<PostedTransactionMutationPreviewClient initialPreview={buildPreview()} locale="en" />);
    });

    expect(container.textContent).toContain("inspection-only");
    expect(container.textContent).toContain("Approval must be given in your AI conversation");
    expect(container.textContent).toContain("Booked cost");
    expect(container.textContent).toContain("NT$1,050");
    expect(container.textContent).toContain("Unavailable");
    expect(container.textContent).toContain("Manual re-entry or dividend follow-up may be required.");
  });

  it("reloads preview data when filters change", async () => {
    await act(async () => {
      root.render(<PostedTransactionMutationPreviewClient initialPreview={buildPreview()} locale="en" />);
    });

    const searchInput = container.querySelector("input") as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchInput!, "2330");
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    expect(getPostedTransactionMutationPreview).toHaveBeenCalledWith("preview-1", expect.objectContaining({
      ticker: "2330",
      offset: 0,
      limit: 50,
    }));
  });

  it("renders localized before and after labels in zh-TW", async () => {
    await act(async () => {
      root.render(<PostedTransactionMutationPreviewClient initialPreview={buildPreview()} locale="zh-TW" />);
    });

    expect(container.textContent).toContain("變更前");
    expect(container.textContent).toContain("變更後");
  });
});
