import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DividendReviewClient } from "../../../components/dividends/DividendReviewClient";
import { getDictionary } from "../../../lib/i18n";
import type { DividendLedgerEntryDetails } from "../../../features/dividends/types";
import type { DividendLedgerReviewResponse } from "../../../features/dividends/services/dividendService";

const searchParamsState = { value: "" };
const smallScreenState = { value: false };

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

vi.mock("../../../hooks/useEventStream", () => ({
  useEventStream: () => undefined,
}));

vi.mock("../../../lib/hooks/use-small-screen", () => ({
  useIsSmallScreen: () => smallScreenState.value,
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

const postedReviewRow: DividendLedgerEntryDetails = {
  ...reviewRow,
  id: "ledger-1",
  rowKind: "ledger",
  postingStatus: "posted",
  receivedCashAmount: 270,
  reconciliationStatus: "open",
  expectedGrossAmount: 300,
  expectedNetAmount: 280,
  actualNetAmount: 270,
  varianceAmount: -10,
  nhiAmount: 12,
  bankFeeAmount: 8,
  otherDeductionAmount: 0,
};

describe("DividendReviewClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    smallScreenState.value = false;
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

  it("clears the hidden market filter when the ticker changes", async () => {
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

    const tickerInput = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker']")!;
    await act(async () => {
      tickerInput.value = "0050";
      tickerInput.dispatchEvent(new Event("input", { bubbles: true }));
      tickerInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(vi.mocked(fetchDividendLedgerReview).mock.calls).toContainEqual([
      expect.objectContaining({ ticker: "0050", marketCode: undefined }),
    ]);
    expect(window.location.search).toContain("ticker=0050");
    expect(window.location.search).not.toContain("marketCode=TW");
  });

  it("does not submit a stale market when another filter follows a ticker edit", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={emptyReviewData}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main", userId: "user-1", feeProfileId: "fee-1", accountType: "broker", defaultCurrency: "TWD" }]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    const tickerInput = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker']")!;
    await act(async () => {
      tickerInput.focus();
      tickerInput.value = "0050";
      tickerInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLSelectElement>("[data-testid='filter-account']")!.focus();
    });
    await act(async () => {});
    const accountSelect = container.querySelector<HTMLSelectElement>("[data-testid='filter-account']")!;
    await act(async () => {
      accountSelect.value = "acc-1";
      accountSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(vi.mocked(fetchDividendLedgerReview).mock.calls).toContainEqual([
      expect.objectContaining({ ticker: "0050", marketCode: undefined, accountId: "acc-1" }),
    ]);
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

  it("uses URL-backed review page size options and refetches with the selected limit", async () => {
    searchParamsState.value = "view=ledger&limit=25";
    window.history.replaceState(null, "", "/dividends?view=ledger&limit=25");

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

    const pageSize = container.querySelector<HTMLSelectElement>("[data-testid='review-page-size']");
    expect(pageSize).not.toBeNull();
    expect(pageSize?.value).toBe("25");
    expect(Array.from(pageSize?.options ?? []).map((option) => option.value)).toEqual(["10", "25", "50"]);

    await act(async () => {
      pageSize!.value = "50";
      pageSize!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(vi.mocked(fetchDividendLedgerReview).mock.calls).toContainEqual([
      expect.objectContaining({
        limit: 50,
        page: 1,
      }),
    ]);
    expect(window.location.search).toContain("limit=50");
  });

  it("normalizes unsupported review page sizes in the URL back to the allowed defaults", async () => {
    searchParamsState.value = "view=ledger&limit=13&page=7";
    window.history.replaceState(null, "", "/dividends?view=ledger&limit=13&page=7");

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

    const pageSize = container.querySelector<HTMLSelectElement>("[data-testid='review-page-size']");
    expect(pageSize?.value).toBe("10");
    expect(window.location.search).not.toContain("limit=13");
    expect(window.location.search).toContain("page=7");
  });

  it("renders additive net and deduction review columns from additive DTO fields", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, ledgerEntries: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main", userId: "user-1", feeProfileId: "fee-1", accountType: "broker", defaultCurrency: "TWD" }]}
          years={[2026]}
        />,
      );
    });

    await act(async () => {});

    expect(container.textContent).toContain("NHI");
    expect(container.textContent).toContain("Bank fee");
    expect(container.textContent).toContain("Actual net");
    expect(container.textContent).toContain("Expected net");
    expect(container.textContent).toContain("NT$280");
    expect(container.textContent).toContain("NT$270");
    expect(container.textContent).toContain("NT$12");
    expect(container.textContent).toContain("NT$8");
  });

  it("opens the ticker route from the row link without opening the review drawer", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, ledgerEntries: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main", userId: "user-1", feeProfileId: "fee-1", accountType: "broker", defaultCurrency: "TWD" }]}
          years={[2026]}
        />,
      );
    });

    await act(async () => {});

    const tickerLink = container.querySelector<HTMLAnchorElement>("[data-testid='review-ticker-link-ledger-1']");
    expect(tickerLink).not.toBeNull();
    expect(tickerLink?.getAttribute("href")).toBe("/tickers/2330?marketCode=TW");

    await act(async () => {
      tickerLink!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector("[data-testid='drawer-content']")).toBeNull();
  });

  it("opens the drawer from keyboard interaction on a review row", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, ledgerEntries: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main", userId: "user-1", feeProfileId: "fee-1", accountType: "broker", defaultCurrency: "TWD" }]}
          years={[2026]}
        />,
      );
    });

    await act(async () => {});

    const row = container.querySelector<HTMLElement>("[data-testid='review-row-ledger-1']");
    expect(row).not.toBeNull();

    await act(async () => {
      row!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(document.querySelector("[data-testid='ui-drawer-body']")).not.toBeNull();
  });

  it("resets the page to 1 when sorting changes", async () => {
    searchParamsState.value = "view=ledger&page=3";
    window.history.replaceState(null, "", "/dividends?view=ledger&page=3");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, ledgerEntries: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main", userId: "user-1", feeProfileId: "fee-1", accountType: "broker", defaultCurrency: "TWD" }]}
          years={[2026]}
        />,
      );
    });

    await act(async () => {});

    const sortButton = container.querySelector<HTMLButtonElement>("[data-testid='review-sort-variance']");
    expect(sortButton).not.toBeNull();

    await act(async () => {
      sortButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(vi.mocked(fetchDividendLedgerReview).mock.calls).toContainEqual([
      expect.objectContaining({
        page: 1,
        sortBy: "varianceAmount",
      }),
    ]);
    expect(window.location.search).toContain("page=1");
    expect(window.location.search).toContain("sortBy=varianceAmount");
  });

  it("offers URL-backed sort field and direction controls on small screens", async () => {
    smallScreenState.value = true;
    searchParamsState.value = "view=ledger&page=3";
    window.history.replaceState(null, "", "/dividends?view=ledger&page=3");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, ledgerEntries: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    const field = container.querySelector<HTMLSelectElement>("[data-testid='review-mobile-sort-field']")!;
    await act(async () => {
      field.value = "varianceAmount";
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const direction = container.querySelector<HTMLSelectElement>("[data-testid='review-mobile-sort-direction']")!;
    await act(async () => {
      direction.value = "asc";
      direction.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(vi.mocked(fetchDividendLedgerReview).mock.calls).toContainEqual([
      expect.objectContaining({ page: 1, sortBy: "varianceAmount", sortOrder: "asc" }),
    ]);
    expect(window.location.search).toContain("sortBy=varianceAmount");
    expect(window.location.search).toContain("sortOrder=asc");
  });

  it("resets the page to 1 when the page size changes", async () => {
    searchParamsState.value = "view=ledger&page=4&limit=25";
    window.history.replaceState(null, "", "/dividends?view=ledger&page=4&limit=25");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, ledgerEntries: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main", userId: "user-1", feeProfileId: "fee-1", accountType: "broker", defaultCurrency: "TWD" }]}
          years={[2026]}
        />,
      );
    });

    await act(async () => {});

    const pageSize = container.querySelector<HTMLSelectElement>("[data-testid='review-page-size']");
    expect(pageSize?.value).toBe("25");

    await act(async () => {
      pageSize!.value = "10";
      pageSize!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(vi.mocked(fetchDividendLedgerReview).mock.calls).toContainEqual([
      expect.objectContaining({
        limit: 10,
        page: 1,
      }),
    ]);
    expect(window.location.search).toContain("page=1");
    expect(window.location.search).not.toContain("limit=25");
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

  it("ignores malformed yearRange date params when selecting preset years", async () => {
    searchParamsState.value = "view=ledger&preset=yearRange&fromPaymentDate=&toPaymentDate=abc";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);

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
    const year2024 = container.querySelector<HTMLInputElement>("[data-testid='preset-year-2024']");

    expect(yearRange?.textContent).not.toContain("0");
    expect(fromDate?.value).toBe("");
    expect(toDate?.value).toBe("");
    expect(year2024?.checked).toBe(false);
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
