import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../lib/auth", () => ({
  requireSession: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../lib/sidebar-cookie", () => ({
  readSidebarStateCookie: vi.fn(),
}));

vi.mock("../../../features/dashboard/services/dashboardService", () => ({
  fetchDashboardSnapshot: vi.fn(),
}));

vi.mock("../../../features/portfolio/services/portfolioService", () => ({
  fetchTransactionHistory: vi.fn(),
}));

vi.mock("../../../features/settings/services/repairService", () => ({
  fetchRepairInstrument: vi.fn(),
}));

vi.mock("../../../features/portfolio/services/tickerDetailsService", () => ({
  fetchTickerDetails: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-app-shell">{children}</div>,
}));

vi.mock("../../../components/dashboard/DashboardLoading", () => ({
  DashboardLoading: () => <div data-testid="dashboard-loading" />,
}));

vi.mock("../../../app/tickers/[ticker]/TickerHistoryClient", () => ({
  TickerHistoryClient: ({
    instrument,
    statsBar,
    ticker,
    transactionAccountFilter,
    transactionMarketFilter,
  }: {
    instrument: { ticker?: string } | null;
    statsBar: React.ReactNode;
    ticker: string;
    transactionAccountFilter?: string;
    transactionMarketFilter?: string;
  }) => (
    <section
      data-testid="ticker-history-client"
      data-instrument-ticker={instrument?.ticker ?? ""}
      data-transaction-account-filter={transactionAccountFilter ?? ""}
      data-transaction-market-filter={transactionMarketFilter ?? ""}
      data-ticker={ticker}
    >
      {statsBar}
    </section>
  ),
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { fetchDashboardSnapshot } from "../../../features/dashboard/services/dashboardService";
import { fetchTickerDetails } from "../../../features/portfolio/services/tickerDetailsService";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { fetchRepairInstrument } from "../../../features/settings/services/repairService";
import TickerHistoryPage from "../../../app/tickers/[ticker]/page";

const requireSessionMock = vi.mocked(requireSession);
const getJsonMock = vi.mocked(getJson);
const readSidebarStateCookieMock = vi.mocked(readSidebarStateCookie);
const fetchDashboardSnapshotMock = vi.mocked(fetchDashboardSnapshot);
const fetchTickerDetailsMock = vi.mocked(fetchTickerDetails);
const fetchTransactionHistoryMock = vi.mocked(fetchTransactionHistory);
const fetchRepairInstrumentMock = vi.mocked(fetchRepairInstrument);

describe("TickerHistoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ isDemo: false } as never);
    getJsonMock.mockResolvedValue({} as never);
    readSidebarStateCookieMock.mockResolvedValue(false as never);
    fetchTransactionHistoryMock.mockResolvedValue([]);
    fetchRepairInstrumentMock.mockResolvedValue(null as never);
    fetchTickerDetailsMock.mockResolvedValue({
      identity: {
        ticker: "2330",
        name: null,
        marketCode: "TW",
        instrumentType: null,
        currency: "TWD",
      },
      quote: {
        currentPrice: null,
        previousClose: null,
        changeAmount: null,
        changePercent: null,
        quoteStatus: "missing",
        freshness: "current",
        freshnessTooltip: null,
      },
      position: {
        accountScope: "acc-2",
        quantity: 0,
        averageCost: null,
        costBasis: null,
        marketValue: null,
        unrealizedPnl: null,
        realizedPnl: 0,
        transactionsCount: 0,
        nextDividendDate: null,
        lastDividendPostedDate: null,
      },
      chart: { points: [] },
      stats: [],
      dividends: {
        upcomingCount: 0,
        nextPaymentDate: null,
        lastPostedDate: null,
      },
      fundamentals: { panels: [] },
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes the normalized ticker scope into ticker details loading", async () => {
    fetchDashboardSnapshotMock.mockResolvedValue({
      settings: { locale: "en" },
      holdings: [],
      accounts: [{ id: "acc-2", name: "Brokerage 2" }],
      dividends: { upcoming: [], recent: [] },
      feeProfiles: [],
      feeProfileBindings: [],
    } as never);

    const element = await TickerHistoryPage({
      params: Promise.resolve({ ticker: "2330" }),
      searchParams: Promise.resolve({ accountId: "acc-2", marketCode: "tw" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="ticker-history-client"');
    expect(html).toContain('data-ticker="2330"');
    expect(html).toContain('data-transaction-account-filter="acc-2"');
    expect(html).toContain('data-transaction-market-filter="TW"');
    expect(fetchTransactionHistoryMock).toHaveBeenCalledWith({ ticker: "2330", accountId: "acc-2", marketCode: "TW" });
    expect(fetchTickerDetailsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: "2330",
        accountId: "acc-2",
        marketCode: "TW",
        transactions: [],
        instrument: null,
      }),
    );
  });

  it("renders the shell fallback when dashboard loading fails", async () => {
    fetchDashboardSnapshotMock.mockRejectedValue(new Error("dashboard unavailable"));

    const element = await TickerHistoryPage({
      params: Promise.resolve({ ticker: "nvda" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Failed to load data for NVDA.");
    expect(html).toContain("Back to portfolio");
    expect(html).not.toContain('data-testid="ticker-history-client"');
  });
});
