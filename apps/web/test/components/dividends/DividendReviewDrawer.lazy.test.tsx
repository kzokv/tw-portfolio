import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DividendReviewRowSummaryDto } from "@vakwen/shared-types";
import {
  DividendReviewDrawer,
  clearDividendReviewDrawerDetailCache,
  primeDividendReviewDrawerDetailCache,
} from "../../../components/dividends/DividendReviewDrawer";
import { getDictionary } from "../../../lib/i18n";

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendLedgerEntry: vi.fn(),
}));

vi.mock("../../../components/dividends/DividendPostingForm", () => ({
  DividendPostingForm: () => <div data-testid="posting-form" />,
}));

import { fetchDividendLedgerEntry } from "../../../features/dividends/services/dividendService";

const dict = getDictionary("en");
const row: DividendReviewRowSummaryDto = {
  rowKind: "ledger", id: "ledger-1", version: 3, accountId: "acc-1", dividendEventId: "event-1",
  ticker: "2330", tickerName: "TSMC", marketCode: "TW", instrumentType: "STOCK", eventType: "CASH",
  exDividendDate: "2026-06-01", paymentDate: "2026-07-01", cashCurrency: "TWD", eligibleQuantity: 10,
  expectedCashAmount: 100, receivedCashAmount: 90, expectedStockQuantity: 0, receivedStockQuantity: 0,
  postingStatus: "posted", reconciliationStatus: "open", sourceCompositionStatus: "provided",
};

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("DividendReviewDrawer lazy detail", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    clearDividendReviewDrawerDetailCache();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(entry: DividendReviewRowSummaryDto | null) {
    root.render(
      <DividendReviewDrawer
        entry={entry}
        cacheScope="session:a:context:self"
        dict={dict}
        locale="en"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  }

  it("opens expected rows immediately without a detail request", async () => {
    act(() => render({ ...row, rowKind: "expected", id: "expected:1", postingStatus: "expected", version: 0 }));
    await act(async () => {});

    expect(fetchDividendLedgerEntry).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='posting-form']")).not.toBeNull();
    expect(document.querySelector("[data-testid='review-drawer-loading']")).toBeNull();
  });

  it("loads ledger detail locally and reuses the ID/version cache on reopen", async () => {
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue({ ...row, deductions: [], sourceLines: [] } as never);
    act(() => render(row));
    expect(document.querySelector("[data-testid='review-drawer-loading']")).not.toBeNull();
    await act(async () => {});
    expect(document.querySelector("[data-testid='posting-form']")).not.toBeNull();

    act(() => render(null));
    act(() => render(row));
    await act(async () => {});
    expect(fetchDividendLedgerEntry).toHaveBeenCalledTimes(1);

    act(() => render({ ...row, version: 4 }));
    await act(async () => {});
    expect(fetchDividendLedgerEntry).toHaveBeenCalledTimes(2);
  });

  it("reuses detail prefetched by another view without issuing a second request", async () => {
    primeDividendReviewDrawerDetailCache(
      "session:a:context:self",
      { ...row, deductions: [], sourceLines: [] },
    );

    act(() => render(row));
    await act(async () => {});

    expect(fetchDividendLedgerEntry).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='posting-form']")).not.toBeNull();
  });

  it("keeps detail failure local and retries without disturbing the table owner", async () => {
    vi.mocked(fetchDividendLedgerEntry)
      .mockRejectedValueOnce(new Error("detail unavailable"))
      .mockResolvedValueOnce({ ...row, deductions: [], sourceLines: [] } as never);
    act(() => render(row));
    await act(async () => {});
    expect(document.querySelector("[data-testid='review-drawer-error']")?.textContent).toContain("detail unavailable");

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='review-drawer-retry']")?.click();
    });
    await act(async () => {});
    expect(document.querySelector("[data-testid='posting-form']")).not.toBeNull();
  });
});
