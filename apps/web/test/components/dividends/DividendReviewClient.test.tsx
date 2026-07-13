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
  eligibleQuantity: 100,
  expectedCashAmount: 300,
  expectedStockQuantity: 0,
  receivedCashAmount: 0,
  receivedStockQuantity: 0,
  postingStatus: "expected",
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

    const tickerInput = container.querySelector<HTMLInputElement>("[data-testid='filter-ticker']");
    expect(tickerInput).not.toBeNull();

    await act(async () => {
      tickerInput!.value = "";
      tickerInput!.dispatchEvent(new Event("input", { bubbles: true }));
      tickerInput!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({
        ticker: undefined,
        marketCode: undefined,
      }),
    ]);
    expect(window.location.search).not.toContain("marketCode=TW");
    expect(window.location.search).not.toContain("ticker=2330");
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
    expect(container.querySelector("[data-testid='filter-ticker']")).not.toBeNull();
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

    expect(container.querySelector<HTMLSelectElement>("[data-testid='filter-account']")?.textContent).toContain("Client account");
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
    };
    act(() => {
      root.render(<DividendReviewClient initialData={selfPrimary} dict={dict} locale="en" accounts={selfPrimary.accounts} years={selfPrimary.years} />);
    });
    await act(async () => {});

    const ownerPrimary: DividendReviewPrimaryDto = {
      ...emptyReviewData,
      years: [2023],
      accounts: [{ id: "owner-acc", name: "Owner account" }],
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

    const accountFilter = container.querySelector<HTMLSelectElement>("[data-testid='filter-account']");
    expect(accountFilter?.textContent).not.toContain("Self account");
    expect(accountFilter?.textContent).not.toContain("Owner account");
    expect(container.querySelector("[data-testid='preset-year-2026']")).toBeNull();
    expect(container.querySelector("[data-testid='preset-year-2023']")).toBeNull();

    await act(async () => {
      resolveOwner(ownerPrimary);
    });

    expect(accountFilter?.textContent).toContain("Owner account");
    expect(accountFilter?.textContent).not.toContain("Self account");
    expect(container.querySelector("[data-testid='preset-year-2023']")).not.toBeNull();
    expect(container.querySelector("[data-testid='preset-year-2026']")).toBeNull();

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

    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({ ticker: "0050", marketCode: undefined }),
    ]);
    expect(window.location.search).toContain("ticker=0050");
    expect(window.location.search).not.toContain("marketCode=TW");
  });

  it("does not submit a stale market when another filter follows a ticker edit", async () => {
    vi.mocked(fetchDividendReviewPrimary).mockResolvedValue({
      ...emptyReviewData,
      accounts: [{ id: "acc-1", name: "Main" }],
    });
    act(() => {
      root.render(
        <DividendReviewClient
          initialData={{ ...emptyReviewData, accounts: [{ id: "acc-1", name: "Main" }] }}
          dict={dict}
          locale="en"
          accounts={[{ id: "acc-1", name: "Main" }]}
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

    expect(primaryQueryCalls()).toContainEqual([
      expect.objectContaining({ ticker: "0050", marketCode: undefined, accountId: "acc-1" }),
    ]);
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

  it("hides the quick reconciliation action without delegated dividend write access", async () => {
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

  it("opens the drawer from keyboard interaction on a review row", async () => {
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
    expect(row).not.toBeNull();
    const focusSpy = vi.spyOn(row!, "focus");
    row!.focus();

    await act(async () => {
      row!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
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

    const row = container.querySelector<HTMLElement>("[data-testid='review-row-ledger-1']");
    const focusSpy = vi.spyOn(row!, "focus");
    row!.focus();
    await act(async () => {
      row!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
      "payment-date", "ticker", "account", "expected-gross-amount", "received-cash-amount", "nhi-amount",
      "bank-fee-amount", "other-deduction-amount", "expected-net-amount", "actual-net-amount", "variance",
      "reconciliation-status",
    ];
    expect(fields.map((field) => container.querySelector(`[data-testid='review-sort-${field}']`) !== null)).toEqual(
      Array.from({ length: 12 }, () => true),
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
    expect(container.textContent).not.toContain("Taiwan Semiconductor");
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
