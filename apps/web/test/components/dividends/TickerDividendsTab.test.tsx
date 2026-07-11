import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DividendLedgerHistoryItemDto, DividendLedgerHistoryPageDto, DividendUpcomingPageDto } from "@vakwen/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "../../../lib/i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const navigation = vi.hoisted(() => ({
  pathname: "/tickers/2330",
  replace: vi.fn(),
  search: "tickerDividendPostedPage=2&tickerDividendPostedLimit=25",
}));

const tickerService = vi.hoisted(() => ({
  upcoming: vi.fn(),
  open: vi.fn(),
  posted: vi.fn(),
}));

const reviewService = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

vi.mock("../../../features/dividends/services/tickerDividendService", () => ({
  fetchTickerUpcomingDividends: tickerService.upcoming,
  fetchTickerOpenReconciliation: tickerService.open,
  fetchTickerPostedDividendHistory: tickerService.posted,
}));

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendLedgerReview: reviewService.fetch,
}));

vi.mock("../../../components/dividends/DividendReviewDrawer", () => ({
  DividendReviewDrawer: ({ entry, allowMutations, onClose }: { entry: { id: string } | null; allowMutations: boolean; onClose: () => void }) => (
    <div data-testid="shared-dividend-review-drawer" data-entry-id={entry?.id ?? ""} data-allow-mutations={String(allowMutations)}>
      <button type="button" data-testid="shared-dividend-review-close" onClick={onClose}>Close</button>
    </div>
  ),
}));

import { TickerDividendsTab } from "../../../components/dividends/TickerDividendsTab";

const dict = getDictionary("en");
let container: HTMLDivElement;
let root: Root;

function historyItem(id: string, overrides: Partial<DividendLedgerHistoryItemDto> = {}): DividendLedgerHistoryItemDto {
  return {
    dividendLedgerEntryId: id,
    accountId: "acc-1",
    accountName: "Main",
    ticker: "2330",
    tickerName: "TSMC",
    marketCode: "TW",
    instrumentType: "STOCK",
    eventType: "CASH",
    paymentDate: "2024-07-12",
    exDividendDate: "2024-06-13",
    postedAt: "2024-07-15T12:00:00.000Z",
    expectedCashAmount: 120,
    expectedNetAmount: 96,
    receivedCashAmount: 120,
    actualNetAmount: 96,
    varianceAmount: 0,
    expectedStockQuantity: 0,
    receivedStockQuantity: 0,
    stockDistributionRatio: null,
    stockDistributionRatioState: "unresolved",
    expectedStockCalcState: "resolved",
    cashDividendCurrency: "TWD",
    nhiAmount: 20,
    bankFeeAmount: 2,
    otherDeductionAmount: 2,
    deductions: { nhiAmount: 20, bankFeeAmount: 2, otherDeductionAmount: 2 },
    postingStatus: "posted",
    reconciliationStatus: "matched",
    ...overrides,
  };
}

const upcomingPage: DividendUpcomingPageDto = {
  page: 1,
  limit: 50,
  total: 1,
  items: [{
    id: "event-upcoming",
    accountId: "acc-1",
    accountName: "Main",
    ticker: "2330",
    tickerName: "TSMC",
    marketCode: "TW",
    instrumentType: "STOCK",
    eventType: "CASH",
    exDividendDate: "2027-02-20",
    paymentDate: "2027-03-15",
    expectedCashAmount: 120,
    expectedNetAmount: 120,
    expectedStockQuantity: 0,
    eligibleQuantity: 10,
    stockDistributionRatio: null,
    stockDistributionRatioState: "unresolved",
    expectedStockCalcState: "resolved",
    cashDividendCurrency: "TWD",
    hasPostedLedgerEntry: false,
    dividendLedgerEntryId: null,
    status: "declared",
  }],
};

function page(items: DividendLedgerHistoryItemDto[], pageNumber = 1, limit: 10 | 25 | 50 = 50, total = items.length): DividendLedgerHistoryPageDto {
  return { page: pageNumber, limit, total, items };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderTab(canWriteDividends = true) {
  await act(async () => {
    root.render(
      <TickerDividendsTab
        dict={dict}
        locale="en"
        marketCode="TW"
        ticker="2330"
        tickerName="TSMC"
        accountId="acc-1"
        dividends={{ upcomingCount: 99, nextPaymentDate: "2099-01-01", lastPostedDate: null, openReconciliationCount: 99 }}
        onMarkMatched={() => {}}
        pendingLedgerEntryId={null}
        canWriteDividends={canWriteDividends}
      />,
    );
  });
  await flush();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  navigation.replace.mockReset();
  navigation.search = "tickerDividendPostedPage=2&tickerDividendPostedLimit=25";
  tickerService.upcoming.mockResolvedValue(upcomingPage);
  tickerService.open.mockResolvedValue(page([historyItem("ledger-open", { reconciliationStatus: "open" })]));
  tickerService.posted.mockResolvedValue(page([historyItem("ledger-posted")], 2, 25, 26));
  reviewService.fetch.mockResolvedValue({
    ledgerEntries: [{
      id: "ledger-open",
      dividendEventId: "event-open",
      accountId: "acc-1",
      accountName: "Main",
      ticker: "2330",
      tickerName: "TSMC",
      marketCode: "TW",
      instrumentType: "STOCK",
      eventType: "CASH",
      paymentDate: "2024-07-12",
      exDividendDate: "2024-06-13",
      cashCurrency: "TWD",
      postingStatus: "posted",
      reconciliationStatus: "open",
      sourceCompositionStatus: "provided",
      version: 1,
      expectedCashAmount: 120,
      receivedCashAmount: 120,
      expectedStockQuantity: 0,
      receivedStockQuantity: 0,
      eligibleQuantity: 10,
      sourceLines: [],
      deductions: [],
    }],
    total: 1,
    aggregates: {},
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("TickerDividendsTab", () => {
  it("loads upcoming, open reconciliation, and posted history independently with server pagination", async () => {
    await renderTab();

    expect(tickerService.upcoming).toHaveBeenCalledWith("2330", expect.objectContaining({ accountId: "acc-1", marketCode: "TW", page: 1, limit: 50 }), expect.anything());
    expect(tickerService.open).toHaveBeenCalledWith("2330", expect.objectContaining({ accountId: "acc-1", page: 1, limit: 50 }), expect.anything());
    expect(tickerService.posted).toHaveBeenCalledWith("2330", expect.objectContaining({ accountId: "acc-1", page: 2, limit: 25 }), expect.anything());
    expect(container.querySelector('[data-testid="ticker-open-reconciliation-0"]')?.textContent).toContain("ledger-open");
    expect(container.querySelector('[data-testid="ticker-posted-dividend-0"]')?.textContent).not.toContain("ledger-open");
    expect(container.textContent).not.toContain("99");
    const reviewLinks = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="/dividends?"]'));
    expect(reviewLinks.length).toBeGreaterThan(0);
    expect(reviewLinks.every((link) => link.href.includes("accountId=acc-1"))).toBe(true);
  });

  it("opens the shared review drawer from a dedicated open row", async () => {
    await renderTab(false);
    const reviewButton = container.querySelector('[data-testid="ticker-open-reconciliation-review-0"]');
    expect(reviewButton).not.toBeNull();

    await act(async () => reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    expect(reviewService.fetch).toHaveBeenCalledWith(expect.objectContaining({ ticker: "2330", accountId: "acc-1", excludeExpected: true }));
    const drawer = container.querySelector('[data-testid="shared-dividend-review-drawer"]');
    expect(drawer?.getAttribute("data-entry-id")).toBe("ledger-open");
    expect(drawer?.getAttribute("data-allow-mutations")).toBe("false");
    expect(container.querySelector('[data-testid="ticker-reconciliation-mark-matched-ledger-open"]')).toBeNull();
  });

  it("opens posted history in the shared review drawer", async () => {
    reviewService.fetch.mockResolvedValueOnce({
      ledgerEntries: [{
        id: "ledger-posted",
        dividendEventId: "event-posted",
        accountId: "acc-1",
        accountName: "Main",
        ticker: "2330",
        tickerName: "TSMC",
        marketCode: "TW",
        instrumentType: "STOCK",
        eventType: "CASH",
        paymentDate: "2024-07-12",
        exDividendDate: "2024-06-13",
        cashCurrency: "TWD",
        postingStatus: "posted",
        reconciliationStatus: "matched",
        sourceCompositionStatus: "provided",
        version: 1,
        expectedCashAmount: 120,
        receivedCashAmount: 120,
        expectedStockQuantity: 0,
        receivedStockQuantity: 0,
        eligibleQuantity: 10,
        sourceLines: [],
        deductions: [],
      }],
      total: 1,
      aggregates: {},
    });
    await renderTab();

    const reviewButton = container.querySelector('[data-testid="ticker-posted-dividend-review-0"]');
    await act(async () => reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await flush();

    expect(container.querySelector('[data-testid="shared-dividend-review-drawer"]')?.getAttribute("data-entry-id")).toBe("ledger-posted");
  });

  it("keeps the latest drawer selection when review requests resolve out of order", async () => {
    let resolveOpen!: (value: never) => void;
    let resolvePosted!: (value: never) => void;
    const openPromise = new Promise<never>((resolve) => { resolveOpen = resolve; });
    const postedPromise = new Promise<never>((resolve) => { resolvePosted = resolve; });
    const reviewResponse = (id: string) => ({ ledgerEntries: [{ id }], total: 1, aggregates: {} }) as never;
    reviewService.fetch
      .mockReturnValueOnce(openPromise)
      .mockReturnValueOnce(postedPromise);
    await renderTab();

    await act(async () => {
      container.querySelector('[data-testid="ticker-open-reconciliation-review-0"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container.querySelector('[data-testid="ticker-posted-dividend-review-0"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    resolvePosted(reviewResponse("ledger-posted"));
    await flush();
    resolveOpen(reviewResponse("ledger-open"));
    await flush();

    expect(container.querySelector('[data-testid="shared-dividend-review-drawer"]')?.getAttribute("data-entry-id")).toBe("ledger-posted");
  });

  it("does not reopen a closed drawer when its request resolves later", async () => {
    let resolveReview!: (value: never) => void;
    reviewService.fetch.mockReturnValueOnce(new Promise<never>((resolve) => { resolveReview = resolve; }));
    await renderTab();

    await act(async () => {
      container.querySelector('[data-testid="ticker-open-reconciliation-review-0"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container.querySelector('[data-testid="shared-dividend-review-close"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    resolveReview({ ledgerEntries: [{ id: "ledger-open" }], total: 1, aggregates: {} } as never);
    await flush();

    expect(container.querySelector('[data-testid="shared-dividend-review-drawer"]')?.getAttribute("data-entry-id")).toBe("");
  });

  it("renders the posted title as ticker, name, and payment date", async () => {
    await renderTab();
    expect(container.querySelector('[data-testid="ticker-posted-title-0"]')?.textContent).toBe("2330 TSMC Jul 12, 2024");
    expect(container.querySelector('[data-testid="ticker-posted-dividend-0"]')?.textContent).toContain(dict.dashboardHome.exDividendDateLabel);
    expect(container.querySelector('[data-testid="ticker-posted-dividend-0"]')?.textContent).toContain(dict.dividends.review.table.nhi);
  });

  it("writes page-size changes to the ticker dividend URL and refetches page one", async () => {
    await renderTab();
    const select = container.querySelector('[data-testid="ticker-posted-page-size"]') as HTMLSelectElement;
    await act(async () => {
      select.value = "50";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(navigation.replace).toHaveBeenCalledWith("/tickers/2330?tickerDividendPostedPage=1&tickerDividendPostedLimit=50", { scroll: false });
    expect(tickerService.posted).toHaveBeenLastCalledWith("2330", expect.objectContaining({ page: 1, limit: 50 }), expect.anything());
  });
});
