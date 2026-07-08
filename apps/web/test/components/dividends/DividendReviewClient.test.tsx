import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DividendReviewClient } from "../../../components/dividends/DividendReviewClient";
import { getDictionary } from "../../../lib/i18n";
import type { DividendLedgerEntryDetails } from "../../../features/dividends/types";
import type { DividendLedgerReviewResponse } from "../../../features/dividends/services/dividendService";

const searchParamsState = { value: "" };

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

vi.mock("../../../hooks/useEventStream", () => ({
  useEventStream: () => undefined,
}));

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendLedgerReview: vi.fn(),
  updateDividendReconciliation: vi.fn(),
}));

import { fetchDividendLedgerReview } from "../../../features/dividends/services/dividendService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");
const zhDict = getDictionary("zh-TW");
const emptyReviewData: DividendLedgerReviewResponse = {
  ledgerEntries: [],
  total: 0,
  aggregates: {
    totalExpectedCashAmount: {},
    totalReceivedCashAmount: {},
    openCount: 0,
    byMonth: {},
    byTicker: {},
  },
};

const reviewRow: DividendLedgerEntryDetails = {
  id: "expected:acc-1:event-1",
  rowKind: "expected",
  accountId: "acc-1",
  dividendEventId: "event-1",
  ticker: "2330",
  tickerName: "Taiwan Semiconductor",
  marketCode: "TW",
  instrumentType: "STOCK",
  eventType: "CASH",
  exDividendDate: "2026-06-01",
  paymentDate: "2026-07-01",
  cashCurrency: "TWD",
  eligibleQuantity: 100,
  expectedCashAmount: 300,
  expectedStockQuantity: 0,
  receivedCashAmount: 0,
  receivedStockQuantity: 0,
  postingStatus: "expected",
  reconciliationStatus: "open",
  version: 0,
  sourceCompositionStatus: "unknown_pending_disclosure",
  deductions: [],
  sourceLines: [],
};

describe("DividendReviewClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsState.value = "view=ledger&ticker=2330&marketCode=TW";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    vi.mocked(fetchDividendLedgerReview).mockResolvedValue(emptyReviewData);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("clears the hidden market filter when the ticker filter is cleared", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={emptyReviewData}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2026]}
        />,
      );
    });

    await act(async () => {});

    const tickerInput = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker']");
    expect(tickerInput).not.toBeNull();

    await act(async () => {
      tickerInput!.value = "";
      tickerInput!.dispatchEvent(new Event("input", { bubbles: true }));
      tickerInput!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(vi.mocked(fetchDividendLedgerReview).mock.calls).toContainEqual([
      expect.objectContaining({
        ticker: undefined,
        marketCode: undefined,
      }),
    ]);
    expect(window.location.search).not.toContain("marketCode=TW");
    expect(window.location.search).not.toContain("ticker=2330");
  });

  it("renders ticker and instrument display name in review rows", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, ledgerEntries: [reviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main", userId: "user-1", feeProfileId: "fee-1", accountType: "broker", defaultCurrency: "TWD" }]}
          years={[2026]}
        />,
      );
    });

    await act(async () => {});

    expect(container.textContent).toContain("2330");
    expect(container.textContent).toContain("Taiwan Semiconductor");

    const row = container.querySelector<HTMLElement>("[data-testid='review-row-expected:acc-1:event-1']");
    expect(row).not.toBeNull();
  });

  it("applies selected year range through URL and review fetch query", async () => {
    searchParamsState.value = "view=ledger";
    window.history.replaceState(null, "", "/dividends?view=ledger");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={emptyReviewData}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2024, 2025, 2026]}
        />,
      );
    });

    await act(async () => {});

    const year2024 = container.querySelector<HTMLInputElement>("[data-testid='preset-year-2024']");
    const year2026 = container.querySelector<HTMLInputElement>("[data-testid='preset-year-2026']");
    expect(year2024).not.toBeNull();
    expect(year2026).not.toBeNull();

    await act(async () => {
      year2024!.click();
    });
    await act(async () => {
      year2026!.click();
    });

    const year2025 = container.querySelector<HTMLInputElement>("[data-testid='preset-year-2025']");
    expect(year2025).not.toBeNull();
    expect(year2025!.checked).toBe(true);
    expect(year2025!.disabled).toBe(true);
    expect(vi.mocked(fetchDividendLedgerReview).mock.calls).toContainEqual([
      expect.objectContaining({
        fromPaymentDate: "2024-01-01",
        toPaymentDate: "2026-12-31",
      }),
    ]);
    expect(window.location.search).toContain("preset=yearRange");
    expect(window.location.search).toContain("fromPaymentDate=2024-01-01");
    expect(window.location.search).toContain("toPaymentDate=2026-12-31");
  });

  it("ignores stale year-range responses that finish after the latest request", async () => {
    searchParamsState.value = "view=ledger";
    window.history.replaceState(null, "", "/dividends?view=ledger");
    let resolveFirst: ((value: typeof emptyReviewData) => void) | undefined;
    let resolveSecond: ((value: typeof emptyReviewData) => void) | undefined;
    vi.mocked(fetchDividendLedgerReview)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={emptyReviewData}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2024, 2025, 2026]}
        />,
      );
    });
    await act(async () => {});

    const year2024 = container.querySelector<HTMLInputElement>("[data-testid='preset-year-2024']");
    const year2026 = container.querySelector<HTMLInputElement>("[data-testid='preset-year-2026']");
    expect(year2024).not.toBeNull();
    expect(year2026).not.toBeNull();

    await act(async () => {
      year2024!.click();
    });
    await act(async () => {
      year2026!.click();
    });

    await act(async () => {
      resolveSecond!(emptyReviewData);
    });
    await act(async () => {
      resolveFirst!({ ...emptyReviewData, ledgerEntries: [reviewRow], total: 1 });
    });

    expect(vi.mocked(fetchDividendLedgerReview)).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Taiwan Semiconductor");
    expect(window.location.search).toContain("toPaymentDate=2026-12-31");
  });

  it("renders legacy year preset URLs as selected year ranges", async () => {
    searchParamsState.value = "view=ledger&preset=year-2025";
    window.history.replaceState(null, "", "/dividends?view=ledger&preset=year-2025");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={emptyReviewData}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2024, 2025, 2026]}
        />,
      );
    });

    await act(async () => {});

    const yearRange = container.querySelector<HTMLElement>("[data-testid='preset-year-range']");
    const fromDate = container.querySelector<HTMLInputElement>("[data-testid='filter-from-date']");
    const toDate = container.querySelector<HTMLInputElement>("[data-testid='filter-to-date']");
    const year2025 = container.querySelector<HTMLInputElement>("[data-testid='preset-year-2025']");

    expect(yearRange?.textContent).toContain("2025");
    expect(fromDate?.value).toBe("2025-01-01");
    expect(toDate?.value).toBe("2025-12-31");
    expect(year2025?.checked).toBe(true);
  });

  it("uses the localized compact years label when no year range is selected", async () => {
    searchParamsState.value = "view=ledger";
    window.history.replaceState(null, "", "/dividends?view=ledger");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={emptyReviewData}
          dict={zhDict}
          locale="zh-TW"
          accounts={[]}
          years={[2024, 2025, 2026]}
        />,
      );
    });

    await act(async () => {});

    expect(container.querySelector<HTMLElement>("[data-testid='preset-year-range']")?.textContent).toContain("年份");
  });
});
