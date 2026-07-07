import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DividendReviewClient } from "../../../components/dividends/DividendReviewClient";
import { getDictionary } from "../../../lib/i18n";

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
const emptyReviewData = {
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
});
