import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DividendReviewClient } from "../../../components/dividends/DividendReviewClient";
import { getDictionary } from "../../../lib/i18n";
import type { DividendReviewPrimaryDto, DividendReviewRowSummaryDto } from "@vakwen/shared-types";
import {
  buildDividendReviewEnrichmentCacheKey,
  buildDividendReviewPrimaryCacheKey,
} from "../../../features/dividends/dividendReviewCache";
import { searchParamsToReviewQuery } from "../../../components/dividends/dividendsPageQuery";
import { writeRouteDtoCache } from "../../../lib/routeDtoCache";

const searchParamsState = { value: "" };
const smallScreenState = { value: false };
const shellContext = vi.hoisted(() => ({ value: null as null | {
  isSharedContext: boolean;
  sharedContextPermissions: { canWriteDividends: boolean };
  contextRefreshSignal: number;
} }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

vi.mock("../../../hooks/useEventStream", () => ({
  useEventStream: () => undefined,
}));

vi.mock("../../../lib/hooks/use-small-screen", () => ({
  useIsSmallScreen: () => smallScreenState.value,
}));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useOptionalAppShellData: () => shellContext.value,
}));

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendReviewPrimary: vi.fn(),
  fetchDividendReviewEnrichment: vi.fn(),
  fetchDividendLedgerEntry: vi.fn(),
  updateDividendReconciliation: vi.fn(),
}));

import {
  fetchDividendReviewEnrichment,
  fetchDividendLedgerEntry,
  fetchDividendReviewPrimary,
} from "../../../features/dividends/services/dividendService";

function primaryQueryCalls(): unknown[][] {
  return vi.mocked(fetchDividendReviewPrimary).mock.calls.map(([query]) => [query]);
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");
const zhDict = getDictionary("zh-TW");
const emptyReviewData: DividendReviewPrimaryDto = {
  reviewRows: [],
  total: 0,
  years: [2026],
  accounts: [],
  eligibleTickers: [{ ticker: "2330", name: "Taiwan Semiconductor" }],
};
const emptyEnrichment = {
  aggregates: {
    totalExpectedCashAmount: {},
    totalReceivedCashAmount: {},
    openCount: 0,
    byMonth: {},
    byTicker: {},
  },
  nhiRollup: {
    bucketAggregates: [],
    nhiSubjectTotal: 0,
    projectedPremium: 0,
    pendingCount: 0,
    hasEtfEntries: false,
  },
  sourceComposition: { providedCount: 0, pendingCount: 0 },
};

const reviewRow: DividendReviewRowSummaryDto = {
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
  cashDividendPerShare: 3,
  eligibleQuantity: 100,
  expectedCashAmount: 300,
  expectedStockQuantity: 0,
  receivedCashAmount: 0,
  receivedStockQuantity: 0,
  postingStatus: "expected",
  cashReconciliationStatus: "open",
  stockReconciliationStatus: null,
  reconciliationStatus: "open",
  version: 0,
  sourceCompositionStatus: "unknown_pending_disclosure",
};

const postedReviewRow: DividendReviewRowSummaryDto = {
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
    window.sessionStorage.clear();
    smallScreenState.value = false;
    shellContext.value = null;
    searchParamsState.value = "view=ledger&ticker=2330&marketCode=TW";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(emptyReviewData);
    vi.mocked(fetchDividendReviewEnrichment).mockResolvedValue(emptyEnrichment);
    vi.mocked(fetchDividendLedgerEntry).mockResolvedValue({ ...postedReviewRow, deductions: [], sourceLines: [] } as never);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
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

    const clearTickers = container.querySelector<HTMLButtonElement>("[data-testid='filter-ticker-clear']");
    expect(clearTickers).not.toBeNull();

    await act(async () => {
      clearTickers!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({
        tickers: undefined,
        marketCode: undefined,
      }),
    ]);
    expect(window.location.search).not.toContain("marketCode=TW");
    expect(window.location.search).not.toContain("ticker=2330");
  });

  it("persists and requests cash and stock statuses independently", async () => {
    searchParamsState.value = "view=ledger&cashStatus=explained&stockStatus=variance";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);

    act(() => {
      root.render(
        <DividendReviewClient initialData={emptyReviewData} dict={dict} locale="en" accounts={[]} years={[2026]} />,
      );
    });
    await act(async () => {});

    expect(container.querySelector<HTMLInputElement>("[data-testid='filter-cash-status-explained']")?.checked).toBe(true);
    const stockStatus = container.querySelector<HTMLInputElement>("[data-testid='filter-stock-status-matched']");
    expect(container.querySelector<HTMLInputElement>("[data-testid='filter-stock-status-variance']")?.checked).toBe(true);
    await act(async () => {
      stockStatus?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({ cashStatuses: ["explained"], stockStatuses: ["variance", "matched"] }),
    ]);
    expect(window.location.search).toContain("cashStatus=explained");
    expect(window.location.search).toContain("stockStatus=variance");
    expect(window.location.search).toContain("stockStatus=matched");
  });

  it("keeps the checkbox multi-select open and announced across keyboard toggles and All", async () => {
    const data = {
      ...emptyReviewData,
      accounts: [{ id: "acc-1", name: "Main" }, { id: "acc-2", name: "Brokerage" }],
    };
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(data);
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={data}
          dict={dict}
          locale="en"
          accounts={data.accounts}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    const dropdown = container.querySelector<HTMLDetailsElement>("[data-testid='filter-account-dropdown']")!;
    const summary = container.querySelector<HTMLElement>("[data-testid='filter-account-summary']")!;
    summary.focus();
    summary.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await act(async () => summary.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(dropdown.open).toBe(true);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(summary);

    const first = container.querySelector<HTMLInputElement>("[data-testid='filter-account-acc-1']")!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await act(async () => first.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(dropdown.open).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(container.querySelector("[data-testid='filter-account-announcement']")?.textContent).toContain("Main");

    const second = container.querySelector<HTMLInputElement>("[data-testid='filter-account-acc-2']")!;
    second.focus();
    second.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await act(async () => second.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(dropdown.open).toBe(true);
    expect(document.activeElement).toBe(second);
    expect(container.querySelector("[data-testid='filter-account-announcement']")?.textContent).toContain("2 selected");

    const all = container.querySelector<HTMLInputElement>("[data-testid='filter-account-all']")!;
    all.focus();
    all.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await act(async () => all.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(dropdown.open).toBe(true);
    expect(document.activeElement).toBe(all);
    expect(all.checked).toBe(true);
    expect(container.querySelector("[data-testid='filter-account-announcement']")?.textContent).toContain("All accounts");
  });

  it("searches eligible tickers and synchronizes repeated selections immediately", async () => {
    searchParamsState.value = "view=ledger&ticker=3714&ticker=2886";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    const data: DividendReviewPrimaryDto = {
      ...emptyReviewData,
      eligibleTickers: [
        { ticker: "0050", name: "Yuanta Taiwan 50" },
        { ticker: "2886", name: "Mega Financial" },
        { ticker: "3714", name: "Foxtron" },
      ],
    };
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(data);

    act(() => {
      root.render(<DividendReviewClient initialData={data} dict={dict} locale="en" accounts={[]} years={[2026]} />);
    });
    await act(async () => {});

    expect(container.querySelector("[data-testid='filter-ticker-summary']")?.textContent).toContain("2 tickers");
    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual(["3714", "2886"]);

    const search = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-search']")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "Yuanta");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector("[data-testid='filter-ticker-option-0050']")).not.toBeNull();
    expect(container.querySelector("[data-testid='filter-ticker-option-2886']")).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-0050']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(primaryQueryCalls()).toContainEqual([expect.objectContaining({ tickers: ["3714", "2886", "0050"] })]);
    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual(["3714", "2886", "0050"]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='filter-ticker-clear']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(primaryQueryCalls()).toContainEqual([expect.objectContaining({ tickers: undefined })]);
    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual([]);
  });

  it("keeps a lowercase deep-link ticker selected after authoritative eligibility is applied", async () => {
    searchParamsState.value = "view=ledger&ticker=tsmc";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    const data: DividendReviewPrimaryDto = {
      ...emptyReviewData,
      eligibleTickers: [{ ticker: "TSMC", name: "Taiwan Semiconductor" }],
    };

    act(() => {
      root.render(<DividendReviewClient initialData={data} dict={dict} locale="en" accounts={[]} years={[2026]} />);
    });
    await act(async () => {});

    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual(["TSMC"]);
    expect(container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-TSMC']")?.checked).toBe(true);
  });

  it("accumulates a second ticker while the first request transitions without pruning from same-scope stale metadata", async () => {
    searchParamsState.value = "view=ledger";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    const data: DividendReviewPrimaryDto = {
      ...emptyReviewData,
      eligibleTickers: [
        { ticker: "2886", name: "Mega Financial" },
        { ticker: "5880", name: "Taiwan Cooperative" },
      ],
    };
    const firstRequest = createDeferred<DividendReviewPrimaryDto>();
    const secondRequest = createDeferred<DividendReviewPrimaryDto>();
    vi.mocked(fetchDividendReviewPrimary)
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    act(() => {
      root.render(<DividendReviewClient initialData={data} dict={dict} locale="en" accounts={[]} years={[2026]} />);
    });
    await act(async () => {});

    await act(async () => {
      container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-2886']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const search = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-search']")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "5880");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const secondTicker = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-5880']")!;
    const pointerDown = new MouseEvent("pointerdown", { bubbles: true });
    Object.defineProperty(pointerDown, "isPrimary", { value: true });
    await act(async () => secondTicker.dispatchEvent(pointerDown));
    await act(async () => {
      firstRequest.resolve(data);
    });
    expect(container.querySelector("[data-testid='filter-ticker-checkbox-5880']")).toBe(secondTicker);
    const filterBar = container.querySelector("[data-testid='review-filter-bar']")!;
    const stats = container.querySelector("[data-testid='stat-tiles']");
    if (stats) {
      expect(filterBar.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    }
    await act(async () => {
      secondTicker.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, detail: 1 }));
      secondTicker.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 0)));

    await act(async () => {
      secondRequest.resolve(data);
    });

    expect(primaryQueryCalls()).toContainEqual([expect.objectContaining({ tickers: ["2886", "5880"] })]);
    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual(["2886", "5880"]);
    expect(container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-5880']")?.checked).toBe(true);
    expect(container.querySelector("[data-testid='filter-ticker-summary']")?.textContent).toContain("2 tickers");
  });

  it("replaces same-query eligibility and prunes selections missing from the authoritative response", async () => {
    searchParamsState.value = "view=ledger&ticker=2886&ticker=5880";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    const initialData: DividendReviewPrimaryDto = {
      ...emptyReviewData,
      eligibleTickers: [
        { ticker: "2886", name: "Mega Financial" },
        { ticker: "5880", name: "Taiwan Cooperative" },
      ],
    };
    const shrunkData: DividendReviewPrimaryDto = {
      ...initialData,
      eligibleTickers: [{ ticker: "2886", name: "Mega Financial" }],
    };
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(shrunkData);

    act(() => {
      root.render(<DividendReviewClient initialData={initialData} dict={dict} locale="en" accounts={[]} years={[2026]} />);
    });
    await act(async () => {});
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='review-sort-ticker']")?.click();
    });
    await act(async () => {});

    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual(["2886"]);
    expect(container.querySelector("[data-testid='filter-ticker-checkbox-5880']")).toBeNull();
    expect(container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-2886']")?.checked).toBe(true);
  });

  it("prunes an initial URL ticker that is absent from authoritative eligibility", async () => {
    searchParamsState.value = "view=ledger&ticker=9999";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    const data: DividendReviewPrimaryDto = {
      ...emptyReviewData,
      eligibleTickers: [{ ticker: "2330", name: "Taiwan Semiconductor" }],
    };
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(data);

    act(() => {
      root.render(<DividendReviewClient initialData={data} dict={dict} locale="en" accounts={[]} years={[2026]} />);
    });
    await act(async () => {});

    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual([]);
    expect(container.querySelector("[data-testid='filter-ticker-checkbox-9999']")).toBeNull();
    expect(container.querySelector("[data-testid='filter-ticker-summary']")?.textContent).toContain("All tickers");
  });

  it("keeps ticker controls mounted across interleaved commits for clear, pointer, and keyboard selection", async () => {
    searchParamsState.value = "view=ledger&ticker=2886&ticker=3714";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    const data: DividendReviewPrimaryDto = {
      ...emptyReviewData,
      eligibleTickers: [
        { ticker: "2886", name: "Mega Financial" },
        { ticker: "3714", name: "Foxtron" },
        { ticker: "5880", name: "Taiwan Cooperative" },
      ],
    };
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(data);
    const renderReview = () => root.render(
      <DividendReviewClient initialData={data} dict={dict} locale="en" accounts={[]} years={[2026]} />,
    );
    act(renderReview);
    await act(async () => {});

    const clear = container.querySelector<HTMLButtonElement>("[data-testid='filter-ticker-clear']")!;
    const clearPointer = new MouseEvent("pointerdown", { bubbles: true });
    Object.defineProperty(clearPointer, "isPrimary", { value: true });
    await act(async () => clear.dispatchEvent(clearPointer));
    act(renderReview);
    expect(container.querySelector("[data-testid='filter-ticker-clear']")).toBe(clear);
    await act(async () => clear.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual([]);

    const first = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-2886']")!;
    await act(async () => first.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const second = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-5880']")!;
    const secondPointer = new MouseEvent("pointerdown", { bubbles: true });
    Object.defineProperty(secondPointer, "isPrimary", { value: true });
    await act(async () => second.dispatchEvent(secondPointer));
    act(renderReview);
    expect(container.querySelector("[data-testid='filter-ticker-checkbox-5880']")).toBe(second);
    await act(async () => {
      second.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, detail: 1 }));
      second.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual(["2886", "5880"]);

    const keyboard = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-3714']")!;
    keyboard.focus();
    keyboard.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await act(async () => keyboard.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual(["2886", "5880", "3714"]);
    expect(document.activeElement).toBe(keyboard);
  });

  it("prunes only ticker selections that become ineligible after an account change", async () => {
    searchParamsState.value = "view=ledger&ticker=2886&ticker=3714";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    const initialData: DividendReviewPrimaryDto = {
      ...emptyReviewData,
      accounts: [{ id: "acc-1", name: "Main" }],
      eligibleTickers: [
        { ticker: "2886", name: "Mega Financial" },
        { ticker: "3714", name: "Foxtron" },
      ],
    };
    const accountData: DividendReviewPrimaryDto = {
      ...initialData,
      eligibleTickers: [
        { ticker: "0050", name: "Yuanta Taiwan 50" },
        { ticker: "2886", name: "Mega Financial" },
      ],
    };
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(accountData);

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={initialData}
          dict={dict}
          locale="en"
          accounts={initialData.accounts}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    const account = container.querySelector<HTMLInputElement>("[data-testid='filter-account-acc-1']")!;
    await act(async () => {
      account.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    expect(primaryQueryCalls()).toContainEqual([expect.objectContaining({ accountIds: ["acc-1"], tickers: ["2886", "3714"] })]);
    expect(primaryQueryCalls()).toContainEqual([expect.objectContaining({ accountIds: ["acc-1"], tickers: ["2886"] })]);
    expect(new URLSearchParams(window.location.search).getAll("ticker")).toEqual(["2886"]);
  });

  it("renders filter-responsive stock hero totals with a keyboard-accessible overflow", async () => {
    vi.mocked(fetchDividendReviewEnrichment).mockResolvedValue({
      ...emptyEnrichment,
      aggregates: {
        ...emptyEnrichment.aggregates,
        totalExpectedCashAmount: { TWD: 900 },
        totalReceivedCashAmount: { TWD: 750 },
      },
      hero: {
        expectedStockTickers: [
          { marketCode: "TW", ticker: "2330", expectedWholeShares: 100, receivedShares: 90, unresolvedEventCount: 0 },
          { marketCode: "TW", ticker: "2886", expectedWholeShares: null, receivedShares: 150, unresolvedEventCount: 1 },
          { marketCode: "US", ticker: "VOO", expectedWholeShares: 4, receivedShares: 4, unresolvedEventCount: 0 },
          { marketCode: "US", ticker: "SCHD", expectedWholeShares: 8, receivedShares: 8, unresolvedEventCount: 0 },
          { marketCode: "JP", ticker: "7203", expectedWholeShares: 12, receivedShares: 12, unresolvedEventCount: 0 },
        ],
        expectedStockTopTickers: [
          { marketCode: "TW", ticker: "2330", expectedWholeShares: 100, receivedShares: 90, unresolvedEventCount: 0 },
          { marketCode: "TW", ticker: "2886", expectedWholeShares: null, receivedShares: 150, unresolvedEventCount: 1 },
          { marketCode: "US", ticker: "VOO", expectedWholeShares: 4, receivedShares: 4, unresolvedEventCount: 0 },
        ],
        expectedStockRemainingTickerCount: 2,
        receivedStockTickers: [
          { marketCode: "TW", ticker: "2886", expectedWholeShares: null, receivedShares: 150, unresolvedEventCount: 1 },
          { marketCode: "US", ticker: "SCHD", expectedWholeShares: 8, receivedShares: 8, unresolvedEventCount: 0 },
        ],
        receivedStockTopTickers: [
          { marketCode: "TW", ticker: "2886", expectedWholeShares: null, receivedShares: 150, unresolvedEventCount: 1 },
        ],
        receivedStockRemainingTickerCount: 0,
        needsCalculationCount: 1,
        needsAttentionCount: 4,
        cashAttentionCount: 2,
        stockAttentionCount: 3,
      },
    });

    act(() => {
      root.render(
        <DividendReviewClient initialData={emptyReviewData} dict={dict} locale="en" accounts={[]} years={[2026]} />,
      );
    });
    await act(async () => {});

    expect(container.querySelector("[data-testid='stat-expected-stock']")?.textContent).toContain("TW · 2886");
    expect(container.querySelector("[data-testid='stat-expected-stock']")?.textContent).toContain("—");
    expect(container.querySelector("[data-testid='stat-expected-stock']")?.textContent).toContain("1 event needs calculation");
    expect(container.querySelector("[data-testid='stat-received-stock']")?.textContent).toContain("150");
    expect(container.querySelector("[data-testid='stat-received-stock']")?.textContent).not.toContain("needs calculation");
    expect(container.querySelector("[data-testid='stat-cash-variance']")?.textContent).toContain("150");
    expect(container.querySelector("[data-testid='stat-needs-attention']")?.textContent).toContain("4");
    const overflow = container.querySelector<HTMLElement>("[data-testid='stat-expected-stock-overflow']");
    expect(overflow?.textContent).toContain("+2 more");
    expect(overflow?.tagName).toBe("SUMMARY");
    overflow?.click();
    expect(overflow?.parentElement?.getAttribute("open")).not.toBeNull();
    expect(overflow?.parentElement?.textContent).toContain("US · SCHD");
    expect(overflow?.parentElement?.textContent).toContain("JP · 7203");
  });

  it("renders a table-local fixed skeleton and busy state on an exact cache miss", async () => {
    vi.mocked(fetchDividendReviewPrimary).mockReturnValue(new Promise(() => {}));
    vi.mocked(fetchDividendReviewEnrichment).mockReturnValue(new Promise(() => {}));
    act(() => {
      root.render(
        <DividendReviewClient initialData={null} dict={dict} locale="en" accounts={[]} years={[2026]} />,
      );
    });
    await act(async () => {});

    expect(container.querySelector("[data-testid='review-table']")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-testid='review-row-skeleton']").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-testid='filter-ticker-dropdown']")).not.toBeNull();
    expect(container.querySelector("[data-testid='review-stats-loading']")).not.toBeNull();
    expect(container.querySelector("[data-testid='review-charts-loading']")).not.toBeNull();
  });

  it("populates account and year filters from a successful SSR-null client primary", async () => {
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue({
      ...emptyReviewData,
      years: [2024],
      accounts: [{ id: "client-acc", name: "Client account" }],
    });
    act(() => {
      root.render(<DividendReviewClient initialData={null} dict={dict} locale="en" accounts={[]} years={[]} />);
    });
    await act(async () => {});

    expect(container.querySelector("[data-testid='filter-account-dropdown']")?.textContent).toContain("Client account");
    expect(container.querySelector("[data-testid='preset-year-2024']")).not.toBeNull();
  });

  it("replaces prior-context account and year metadata with the committed context response", async () => {
    shellContext.value = {
      isSharedContext: false,
      sharedContextPermissions: { canWriteDividends: true },
      contextRefreshSignal: 0,
    };
    const selfPrimary = {
      ...emptyReviewData,
      years: [2026],
      accounts: [{ id: "self-acc", name: "Self account" }],
      eligibleTickers: [{ ticker: "2886", name: "Self-only ticker" }],
    };
    act(() => {
      root.render(<DividendReviewClient initialData={selfPrimary} dict={dict} locale="en" accounts={selfPrimary.accounts} years={selfPrimary.years} />);
    });
    await act(async () => {});

    const ownerPrimary: DividendReviewPrimaryDto = {
      ...emptyReviewData,
      years: [2023],
      accounts: [{ id: "owner-acc", name: "Owner account" }],
      eligibleTickers: [{ ticker: "5880", name: "Owner-only ticker" }],
    };
    let resolveOwner!: (value: DividendReviewPrimaryDto) => void;
    vi.mocked(fetchDividendReviewPrimary).mockReturnValue(new Promise((resolve) => {
      resolveOwner = resolve;
    }));
    shellContext.value = { ...shellContext.value, contextRefreshSignal: 1 };
    act(() => {
      root.render(<DividendReviewClient initialData={selfPrimary} dict={dict} locale="en" accounts={selfPrimary.accounts} years={selfPrimary.years} />);
    });
    await act(async () => {});

    const accountFilter = container.querySelector<HTMLElement>("[data-testid='filter-account-dropdown']");
    expect(accountFilter?.textContent).not.toContain("Self account");
    expect(accountFilter?.textContent).not.toContain("Owner account");
    expect(container.querySelector("[data-testid='preset-year-2026']")).toBeNull();
    expect(container.querySelector("[data-testid='preset-year-2023']")).toBeNull();
    expect(container.querySelector("[data-testid='filter-ticker-option-2886']")).toBeNull();
    expect(container.querySelector("[data-testid='filter-ticker-option-5880']")).toBeNull();

    await act(async () => {
      resolveOwner(ownerPrimary);
    });

    expect(accountFilter?.textContent).toContain("Owner account");
    expect(accountFilter?.textContent).not.toContain("Self account");
    expect(container.querySelector("[data-testid='preset-year-2023']")).not.toBeNull();
    expect(container.querySelector("[data-testid='preset-year-2026']")).toBeNull();
    expect(container.querySelector("[data-testid='filter-ticker-option-5880']")).not.toBeNull();
    expect(container.querySelector("[data-testid='filter-ticker-option-2886']")).toBeNull();

    vi.mocked(fetchDividendReviewPrimary).mockReturnValue(new Promise(() => {}));
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='review-sort-ticker']")?.click();
    });
    expect(accountFilter?.textContent).toContain("Owner account");
    expect(accountFilter?.textContent).not.toContain("Self account");
    expect(container.querySelector("[data-testid='preset-year-2023']")).not.toBeNull();
    expect(container.querySelector("[data-testid='preset-year-2026']")).toBeNull();
  });

  it("renders exact stale rows with a visible refreshing status instead of skeletons", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    searchParamsState.value = "view=ledger&fromPaymentDate=2026-01-01&toPaymentDate=2026-12-31";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    const exactQuery = searchParamsToReviewQuery(new URLSearchParams(searchParamsState.value));
    writeRouteDtoCache(
      buildDividendReviewPrimaryCacheKey("session:unknown:context:self", exactQuery),
      { ...emptyReviewData, reviewRows: [reviewRow], total: 1 },
      { ttlMs: 100, staleTtlMs: 1_000 },
    );
    vi.setSystemTime(new Date("2026-07-01T00:00:00.200Z"));
    vi.mocked(fetchDividendReviewPrimary).mockReturnValue(new Promise(() => {}));

    act(() => {
      root.render(<DividendReviewClient initialData={null} initialQuery={exactQuery} dict={dict} locale="en" accounts={[]} years={[2026]} />);
    });
    await act(async () => {});

    expect(container.textContent).toContain("Taiwan Semiconductor");
    expect(container.querySelector("[data-testid='review-refreshing']")).not.toBeNull();
    expect(container.querySelector("[data-testid='review-row-skeleton']")).toBeNull();
  });

  it("keeps new loading and retry labels localized in English and zh-TW", () => {
    expect(dict.dividends.review.loading).toEqual(expect.objectContaining({
      refreshing: expect.any(String), retry: "Retry", primaryError: expect.any(String), enrichmentError: expect.any(String), enrichmentStale: expect.any(String), drawerError: expect.any(String),
    }));
    expect(zhDict.dividends.review.loading.retry).toBe("重試");
    expect(zhDict.dividends.review.loading.enrichmentStale).not.toBe(dict.dividends.review.loading.enrichmentStale);
    expect(zhDict.dividends.review.loading.refreshing).not.toBe(dict.dividends.review.loading.refreshing);
  });

  it("keeps stale enrichment visibly retryable without disabling primary and clears the error after retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    const exactQuery = searchParamsToReviewQuery(new URLSearchParams(searchParamsState.value));
    const staleEnrichment = {
      ...emptyEnrichment,
      aggregates: { ...emptyEnrichment.aggregates, openCount: 7 },
    };
    const refreshedEnrichment = {
      ...emptyEnrichment,
      aggregates: { ...emptyEnrichment.aggregates, openCount: 3 },
    };
    writeRouteDtoCache(
      buildDividendReviewEnrichmentCacheKey("session:unknown:context:self", exactQuery),
      staleEnrichment,
      { ttlMs: 100, staleTtlMs: 1_000 },
    );
    vi.setSystemTime(new Date("2026-07-01T00:00:00.200Z"));
    vi.mocked(fetchDividendReviewEnrichment)
      .mockRejectedValueOnce(new Error("enrichment revalidation failed"))
      .mockResolvedValueOnce(refreshedEnrichment);

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          initialQuery={exactQuery}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    expect(container.querySelector("[data-testid='review-row-ledger-1']")).not.toBeNull();
    expect(container.querySelector("[data-testid='review-table']")?.getAttribute("aria-busy")).toBe("false");
    expect(container.querySelector("[data-testid='review-enrichment-error']")?.textContent).toContain(dict.dividends.review.loading.enrichmentStale);
    expect(container.textContent).toContain("7");

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='review-enrichment-retry']")?.click();
    });

    expect(container.querySelector("[data-testid='review-enrichment-error']")).toBeNull();
    expect(container.textContent).toContain("3");
    expect(fetchDividendReviewEnrichment).toHaveBeenCalledTimes(2);
  });

  it("keeps the primary table usable and removes enrichment busy skeletons after enrichment failure", async () => {
    vi.mocked(fetchDividendReviewEnrichment).mockRejectedValue(new Error("enrichment unavailable"));
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    expect(container.querySelector("[data-testid='review-row-ledger-1']")).not.toBeNull();
    expect(container.querySelector("[data-testid='review-enrichment-error']")?.textContent).toContain("enrichment unavailable");
    expect(container.querySelector("[data-testid='review-stats-loading']")).toBeNull();
    expect(container.querySelector("[data-testid='review-charts-loading']")).toBeNull();
    expect(container.querySelector("[data-testid='review-enrichment-loading']")).toBeNull();
  });

  it("clears the hidden market filter when the ticker changes", async () => {
    const data = {
      ...emptyReviewData,
      eligibleTickers: [...emptyReviewData.eligibleTickers, { ticker: "0050", name: "Yuanta Taiwan 50" }],
    };
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue(data);
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={data}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    await act(async () => {
      container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-0050']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({ tickers: ["2330", "0050"], marketCode: undefined }),
    ]);
    expect(window.location.search).toContain("ticker=0050");
    expect(window.location.search).not.toContain("marketCode=TW");
  });

  it("does not submit a stale market when another filter follows a ticker edit", async () => {
    const eligibleTickers = [...emptyReviewData.eligibleTickers, { ticker: "0050", name: "Yuanta Taiwan 50" }];
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue({
      ...emptyReviewData,
      accounts: [{ id: "acc-1", name: "Main" }],
      eligibleTickers,
    });
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, accounts: [{ id: "acc-1", name: "Main" }], eligibleTickers }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    await act(async () => {
      container.querySelector<HTMLInputElement>("[data-testid='filter-ticker-checkbox-0050']")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    const accountSelect = container.querySelector<HTMLInputElement>("[data-testid='filter-account-acc-1']")!;
    await act(async () => {
      accountSelect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(primaryQueryCalls().at(-1)?.[0]).toEqual(
      expect.objectContaining({ tickers: ["2330", "0050"], marketCode: undefined, accountIds: ["acc-1"] }),
    );
  });

  it("renders ticker and instrument display name in review rows", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [reviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
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

  it("renders visible component-qualified reconciliation badges in English and Traditional Chinese", async () => {
    const mixedRow: DividendReviewRowSummaryDto = {
      ...postedReviewRow,
      eventType: "CASH_AND_STOCK",
      cashReconciliationStatus: "matched",
      stockReconciliationStatus: "matched",
    };

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [mixedRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    const english = container.querySelector("[data-testid='dividend-review-status-ledger-1']")?.textContent ?? "";
    expect(english).toContain("Cash · Matched");
    expect(english).toContain("Stock · Matched");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [mixedRow], total: 1 }}
          dict={zhDict}
          locale="zh-TW"
          accounts={[]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    const traditionalChinese = container.querySelector("[data-testid='dividend-review-status-ledger-1']")?.textContent ?? "";
    expect(traditionalChinese).toContain("現金 · 相符");
    expect(traditionalChinese).toContain("股票 · 相符");
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

    expect(primaryQueryCalls()).toContainEqual([
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
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
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

  it("hides the mobile reconciliation action without delegated dividend write access", async () => {
    smallScreenState.value = true;
    shellContext.value = {
      isSharedContext: true,
      sharedContextPermissions: { canWriteDividends: false },
      contextRefreshSignal: 0,
    };

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
          years={[2026]}
        />,
      );
    });

    await act(async () => {});

    expect(container.querySelector("[data-testid='mark-matched-ledger-1']")).toBeNull();
    expect(container.querySelector("[data-testid='review-row-ledger-1-open']")).not.toBeNull();
  });

  it("opens the ticker route from the row link without opening the review drawer", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
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

  it("opens the drawer from the row's keyboard-accessible details button", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
          years={[2026]}
        />,
      );
    });

    await act(async () => {});

    const row = container.querySelector<HTMLElement>("[data-testid='review-row-ledger-1']");
    const openButton = container.querySelector<HTMLButtonElement>("[data-testid='review-row-ledger-1-open']");
    expect(row?.getAttribute("role")).toBeNull();
    expect(row?.getAttribute("tabindex")).toBeNull();
    expect(openButton).not.toBeNull();
    const focusSpy = vi.spyOn(openButton!, "focus");
    openButton!.focus();

    await act(async () => {
      openButton!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      openButton!.click();
    });

    expect(document.querySelector("[data-testid='ui-drawer-body']")).not.toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='ui-drawer-close']")?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    });

    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it("restores focus to a mobile row after pointer-opening and closing its drawer", async () => {
    smallScreenState.value = true;
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    const openButton = container.querySelector<HTMLButtonElement>("[data-testid='review-row-ledger-1-open']")!;
    const focusSpy = vi.spyOn(openButton, "focus");
    openButton.focus();
    await act(async () => {
      openButton.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-testid='ui-drawer-close']")?.click();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    });

    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it("resets mobile sort direction to ascending when selecting an inactive field", async () => {
    smallScreenState.value = true;
    searchParamsState.value = "view=ledger&sortBy=paymentDate&sortOrder=desc";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);
    act(() => {
      root.render(<DividendReviewClient initialData={emptyReviewData} dict={dict} locale="en" accounts={[]} years={[2026]} />);
    });
    await act(async () => {});

    const field = container.querySelector<HTMLSelectElement>("[data-testid='review-mobile-sort-field']")!;
    await act(async () => {
      field.value = "ticker";
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({ sortBy: "ticker", sortOrder: "asc", page: 1 }),
    ]);
    expect(container.querySelector<HTMLSelectElement>("[data-testid='review-mobile-sort-direction']")?.value).toBe("asc");
  });

  it("rewrites unsupported legacy review sorts out of the canonical URL on load", async () => {
    searchParamsState.value = "view=ledger&sortBy=exDate&sortOrder=asc";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);

    act(() => {
      root.render(<DividendReviewClient initialData={emptyReviewData} dict={dict} locale="en" accounts={[]} years={[2026]} />);
    });
    await act(async () => {});

    expect(window.location.search).not.toContain("sortBy=exDate");
    expect(window.location.search).toContain("sortOrder=asc");
    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({ sortBy: "paymentDate", sortOrder: "asc", page: 1 }),
    ]);
  });

  it("resets the page to 1 when sorting changes", async () => {
    searchParamsState.value = "view=ledger&page=3";
    window.history.replaceState(null, "", "/dividends?view=ledger&page=3");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
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

    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({
        page: 1,
        sortBy: "varianceAmount",
      }),
    ]);
    expect(window.location.search).toContain("page=1");
    expect(window.location.search).toContain("sortBy=varianceAmount");
  });

  it("offers all 12 server-sort headers with ascending then descending semantics", async () => {
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    const fields = [
      "payment-date", "ticker", "account", "nhi-amount",
      "bank-fee-amount", "other-deduction-amount", "expected-net-amount", "actual-net-amount", "variance",
      "reconciliation-status",
    ];
    expect(fields.map((field) => container.querySelector(`[data-testid='review-sort-${field}']`) !== null)).toEqual(
      Array.from({ length: 10 }, () => true),
    );

    const ticker = container.querySelector<HTMLButtonElement>("[data-testid='review-sort-ticker']")!;
    await act(async () => { ticker.click(); });
    expect(window.location.search).toContain("sortBy=ticker");
    expect(window.location.search).toContain("sortOrder=asc");
    await act(async () => { ticker.click(); });
    expect(window.location.search).not.toContain("sortOrder=");
    expect(ticker.closest("th")?.getAttribute("aria-sort")).toBe("descending");
  });

  it("offers URL-backed sort field and direction controls on small screens", async () => {
    smallScreenState.value = true;
    searchParamsState.value = "view=ledger&page=3";
    window.history.replaceState(null, "", "/dividends?view=ledger&page=3");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
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

    expect(primaryQueryCalls()).toContainEqual([
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
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 1 }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
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

    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({
        limit: 10,
        page: 1,
      }),
    ]);
    expect(window.location.search).toContain("page=1");
    expect(window.location.search).not.toContain("limit=25");
  });

  it("rolls URL, query controls, and rows back after primary failure and retries the attempted page", async () => {
    vi.mocked(fetchDividendReviewPrimary)
      .mockRejectedValueOnce(new Error("page unavailable"))
      .mockResolvedValueOnce({ ...emptyReviewData, reviewRows: [{ ...postedReviewRow, id: "page-2" }], total: 20 });
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, reviewRows: [postedReviewRow], total: 20 }}
          dict={dict}
          locale="en"
          accounts={[]}
          years={[2026]}
        />,
      );
    });
    await act(async () => {});

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='pagination-next']")?.click(); });
    await act(async () => {});
    expect(window.location.search).toContain("page=1");
    expect(container.querySelector("[data-testid='review-row-ledger-1']")).not.toBeNull();
    expect(container.textContent).toContain("page unavailable");

    await act(async () => { container.querySelector<HTMLButtonElement>("[data-testid='review-primary-retry']")?.click(); });
    await act(async () => {});
    expect(window.location.search).toContain("page=2");
    expect(container.querySelector("[data-testid='review-row-page-2']")).not.toBeNull();
  });

  it("synchronizes page state and URL when the portfolio context refreshes", async () => {
    searchParamsState.value = "view=ledger&page=4&limit=25";
    window.history.replaceState(null, "", "/dividends?view=ledger&page=4&limit=25");
    shellContext.value = {
      isSharedContext: true,
      sharedContextPermissions: { canWriteDividends: true },
      contextRefreshSignal: 0,
    };

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
    vi.mocked(fetchDividendReviewPrimary).mockClear();

    shellContext.value = { ...shellContext.value, contextRefreshSignal: 1 };
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

    expect(fetchDividendReviewPrimary).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 25 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(window.location.search).toContain("page=1");
    expect(container.querySelector<HTMLButtonElement>("[data-testid='pagination-prev']")?.disabled).toBe(true);
  });

  it("applies selected year range through URL and review fetch query", async () => {
    searchParamsState.value = "view=ledger";
    window.history.replaceState(null, "", "/dividends?view=ledger");
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue({ ...emptyReviewData, years: [2024, 2025, 2026] });

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, years: [2024, 2025, 2026] }}
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
    expect(primaryQueryCalls()).toContainEqual([
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
    vi.mocked(fetchDividendReviewPrimary)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, years: [2024, 2025, 2026] }}
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
      resolveFirst!({ ...emptyReviewData, reviewRows: [reviewRow], total: 1 });
    });

    expect(vi.mocked(fetchDividendReviewPrimary)).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-testid='review-row-expected:acc-1:event-1']")).toBeNull();
    expect(window.location.search).toContain("toPaymentDate=2026-12-31");
  });

  it("renders legacy year preset URLs as selected year ranges", async () => {
    searchParamsState.value = "view=ledger&preset=year-2025";
    window.history.replaceState(null, "", "/dividends?view=ledger&preset=year-2025");

    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, years: [2024, 2025, 2026] }}
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
          initialData={{ ...emptyReviewData, years: [2024, 2025, 2026] }}
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

  it("keeps invalid custom date edits out of the URL and query until blur validates", async () => {
    searchParamsState.value = "view=ledger&fromPaymentDate=2026-01-01&toPaymentDate=2026-12-31";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);

    act(() => {
      root.render(
        <DividendReviewClient initialData={emptyReviewData} dict={dict} locale="en" accounts={[]} years={[2026]} />,
      );
    });
    await act(async () => {});

    const fromDate = container.querySelector<HTMLInputElement>("[data-testid='filter-from-date']")!;
    const toDate = container.querySelector<HTMLInputElement>("[data-testid='filter-to-date']")!;

    await act(async () => {
      setInputValue(fromDate, "2026-12-31");
      setInputValue(toDate, "");
    });

    expect(window.location.search).toContain("fromPaymentDate=2026-01-01");
    expect(window.location.search).toContain("toPaymentDate=2026-12-31");

    await act(async () => {
      toDate.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(container.textContent).toContain(dict.dividends.review.filter.partialDateError);
    expect(window.location.search).toContain("fromPaymentDate=2026-01-01");
    expect(window.location.search).toContain("toPaymentDate=2026-12-31");
  });

  it("commits valid custom date edits only on blur", async () => {
    searchParamsState.value = "view=ledger&fromPaymentDate=2026-01-01&toPaymentDate=2026-12-31";
    window.history.replaceState(null, "", `/dividends?${searchParamsState.value}`);

    act(() => {
      root.render(
        <DividendReviewClient initialData={emptyReviewData} dict={dict} locale="en" accounts={[]} years={[2026]} />,
      );
    });
    await act(async () => {});
    vi.clearAllMocks();

    const fromDate = container.querySelector<HTMLInputElement>("[data-testid='filter-from-date']")!;
    const toDate = container.querySelector<HTMLInputElement>("[data-testid='filter-to-date']")!;

    await act(async () => {
      setInputValue(fromDate, "2026-02-01");
      setInputValue(toDate, "2026-11-30");
    });

    expect(window.location.search).toContain("fromPaymentDate=2026-01-01");
    expect(window.location.search).toContain("toPaymentDate=2026-12-31");
    expect(vi.mocked(fetchDividendReviewPrimary)).not.toHaveBeenCalled();

    await act(async () => {
      toDate.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(window.location.search).toContain("fromPaymentDate=2026-02-01");
    expect(window.location.search).toContain("toPaymentDate=2026-11-30");
    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({ fromPaymentDate: "2026-02-01", toPaymentDate: "2026-11-30" }),
    ]);
  });

  it("moves pending source composition into URL and server query while resetting page 1", async () => {
    searchParamsState.value = "view=ledger&page=3";
    window.history.replaceState(null, "", "/dividends?view=ledger&page=3");
    vi.mocked(fetchDividendReviewEnrichment).mockResolvedValue({
      ...emptyEnrichment,
      nhiRollup: { ...emptyEnrichment.nhiRollup, hasEtfEntries: true, pendingCount: 2 },
      sourceComposition: { providedCount: 0, pendingCount: 2 },
    });
    act(() => {
      root.render(
        <DividendReviewClient initialData={emptyReviewData} dict={dict} locale="en" accounts={[]} years={[2026]} />,
      );
    });
    await act(async () => {});

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='nhi-rollup-pending-link']")?.click();
    });

    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({ sourceComposition: "pending", page: 1 }),
    ]);
    expect(window.location.search).toContain("sourceComposition=pending");
    expect(window.location.search).toContain("page=1");
  });
});
