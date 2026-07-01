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
  fetchDashboardPrimaryData: vi.fn(),
}));

vi.mock("../../../features/portfolio/services/portfolioService", () => ({
  fetchTransactionHistory: vi.fn(),
}));

vi.mock("../../../features/settings/services/repairService", () => ({
  fetchRepairInstrument: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-app-shell">{children}</div>,
}));

vi.mock("../../../components/dashboard/DashboardLoading", () => ({
  DashboardLoading: () => <div data-testid="dashboard-loading" />,
}));

vi.mock("recharts", () => ({}));

vi.mock("../../../app/tickers/[ticker]/TickerHistoryClient", () => ({
  TickerHistoryClient: ({
    details,
    initialChartQuery,
    initialTradeDate,
    instrument,
    quotePollIntervalSeconds,
    ticker,
    tickerPriceIntradayEnabled,
    tickerPriceIntradayRefreshIntervalMinutes,
	    transactionAccountFilter,
	    transactionAccountIdsFilter,
	    transactionMarketFilter,
	  }: {
    details: {
      position?: { accountScope?: string };
      quote?: {
        currentPrice?: number | null;
        priceState?: {
          marketState?: string | null;
          source?: string | null;
        } | null;
      };
    };
    initialChartQuery?: { chartEnd?: string; chartRange?: string; chartStart?: string };
    initialTradeDate?: string;
    instrument: { ticker?: string } | null;
    quotePollIntervalSeconds?: number | null;
    ticker: string;
    tickerPriceIntradayEnabled?: boolean | null;
    tickerPriceIntradayRefreshIntervalMinutes?: number | null;
	    transactionAccountFilter?: string;
	    transactionAccountIdsFilter?: string[];
	    transactionMarketFilter?: string;
	  }) => (
    <section
      data-testid="ticker-history-client"
      data-instrument-ticker={instrument?.ticker ?? ""}
      data-primary-account-scope={details.position?.accountScope ?? ""}
      data-chart-range={initialChartQuery?.chartRange ?? ""}
      data-chart-start={initialChartQuery?.chartStart ?? ""}
      data-chart-end={initialChartQuery?.chartEnd ?? ""}
      data-initial-trade-date={initialTradeDate ?? ""}
	      data-transaction-account-filter={transactionAccountFilter ?? ""}
	      data-transaction-account-ids-filter={transactionAccountIdsFilter?.join(",") ?? ""}
	      data-transaction-market-filter={transactionMarketFilter ?? ""}
      data-ticker={ticker}
      data-quote-poll-seconds={quotePollIntervalSeconds ?? ""}
      data-intraday-enabled={tickerPriceIntradayEnabled === undefined || tickerPriceIntradayEnabled === null ? "" : String(tickerPriceIntradayEnabled)}
      data-intraday-interval-minutes={tickerPriceIntradayRefreshIntervalMinutes ?? ""}
      data-current-price={details.quote?.currentPrice ?? ""}
      data-price-state-market={details.quote?.priceState?.marketState ?? ""}
      data-price-state-source={details.quote?.priceState?.source ?? ""}
    />
  ),
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { fetchDashboardPrimaryData } from "../../../features/dashboard/services/dashboardService";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { fetchRepairInstrument } from "../../../features/settings/services/repairService";
import TickerHistoryPage from "../../../app/tickers/[ticker]/page";

const requireSessionMock = vi.mocked(requireSession);
const getJsonMock = vi.mocked(getJson);
const readSidebarStateCookieMock = vi.mocked(readSidebarStateCookie);
const fetchDashboardPrimaryDataMock = vi.mocked(fetchDashboardPrimaryData);
const fetchTransactionHistoryMock = vi.mocked(fetchTransactionHistory);
const fetchRepairInstrumentMock = vi.mocked(fetchRepairInstrument);

describe("TickerHistoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ isDemo: false } as never);
    getJsonMock.mockImplementation(async (path: string) => {
      if (path === "/profile") return {};
      if (path === "/settings") return { locale: "en", quotePollIntervalSeconds: 10 };
      if (path.startsWith("/tickers/2330/primary")) {
        return {
          identity: {
            ticker: "2330",
            marketCode: "TW",
            accountId: "acc-2",
            name: "Taiwan Semiconductor Manufacturing",
            instrumentType: "STOCK",
            priceCurrency: "TWD",
            barsBackfillStatus: "ready",
          },
          quote: {
            currentUnitPrice: 2390,
            previousClose: 2385,
            change: 5,
            changePercent: 0.2096,
            asOf: "2026-06-18",
            source: "yahoo-finance-chart",
            quoteStatus: "current",
            priceState: {
              basis: "intraday",
              chipState: "open_fresh",
              marketState: "open",
              source: "yahoo-finance-chart",
              sourceKind: "intraday_yahoo_chart",
              asOfDate: "2026-06-18",
              asOfTimestamp: "2026-06-18T03:54:43.000Z",
              observedAt: "2026-06-18T04:14:48.384Z",
              delaySeconds: 1200,
              marketTimeZone: "Asia/Taipei",
              quality: null,
            },
          },
          position: {
            quantity: 5000,
            averageCostPerShare: 837.44,
            costBasisAmount: 4187200,
            marketValueAmount: 11950000,
            unrealizedPnlAmount: 7762800,
            realizedPnlAmount: 0,
            currency: "TWD",
            accountIds: ["acc-2"],
            lastTradeDate: "2026-01-02",
          },
          unrealizedPnlHistory: [],
          transactions: [],
          dividends: { upcoming: [], recent: [] },
          holdingGroup: null,
          accountBreakdown: [],
        };
      }
      return {};
    });
    readSidebarStateCookieMock.mockResolvedValue(false as never);
    fetchTransactionHistoryMock.mockResolvedValue([]);
    fetchRepairInstrumentMock.mockResolvedValue(null as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes the normalized ticker scope into ticker primary rendering", async () => {
    fetchDashboardPrimaryDataMock.mockResolvedValue({
      settings: { locale: "en" },
      holdings: [],
      holdingGroups: [],
      instruments: [],
      accounts: [{ id: "acc-2", name: "Brokerage 2" }],
      dividends: { upcoming: [], recent: [] },
      actions: { integrityIssue: null },
      feeProfiles: [],
      feeProfileBindings: [],
    } as never);

    const element = await TickerHistoryPage({
      params: Promise.resolve({ ticker: "2330" }),
      searchParams: Promise.resolve({
        accountId: "acc-2",
        chartEnd: "2024-06-30",
        chartRange: "CUSTOM",
        chartStart: "2024-01-01",
        marketCode: "tw",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="ticker-history-client"');
    expect(html).toContain('data-ticker="2330"');
    expect(html).toContain('data-transaction-account-filter="acc-2"');
    expect(html).toContain('data-transaction-market-filter="TW"');
    expect(html).toContain('data-primary-account-scope="acc-2"');
    expect(html).toContain('data-current-price="2390"');
    expect(html).toContain('data-price-state-market="open"');
    expect(html).toContain('data-price-state-source="yahoo-finance-chart"');
    expect(html).toContain('data-chart-range="CUSTOM"');
    expect(html).toContain('data-chart-start="2024-01-01"');
    expect(html).toContain('data-chart-end="2024-06-30"');
    expect(fetchDashboardPrimaryDataMock).toHaveBeenCalledTimes(1);
    expect(fetchTransactionHistoryMock).toHaveBeenCalledWith({ ticker: "2330", accountId: "acc-2", accountIds: undefined, marketCode: "TW" });
    expect(getJsonMock).toHaveBeenCalledWith("/tickers/2330/primary?accountId=acc-2&marketCode=TW");
  });

  it("maps unrealized P&L analysis date scope into the ticker chart custom range", async () => {
    fetchDashboardPrimaryDataMock.mockResolvedValue({
      settings: { locale: "en" },
      holdings: [],
      holdingGroups: [],
      instruments: [],
      accounts: [{ id: "acc-2", name: "Brokerage 2" }],
      dividends: { upcoming: [], recent: [] },
      actions: { integrityIssue: null },
      feeProfiles: [],
      feeProfileBindings: [],
    } as never);

    const element = await TickerHistoryPage({
      params: Promise.resolve({ ticker: "2330" }),
      searchParams: Promise.resolve({
        accountId: "acc-2",
        fromDate: "2026-04-10",
        marketCode: "tw",
        source: "unrealized-pnl-analysis",
        toDate: "2026-06-26",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="ticker-history-client"');
    expect(html).toContain('data-chart-range="CUSTOM"');
    expect(html).toContain('data-chart-start="2026-04-10"');
    expect(html).toContain('data-chart-end="2026-06-26"');
    expect(fetchTransactionHistoryMock).toHaveBeenCalledWith({ ticker: "2330", accountId: "acc-2", accountIds: undefined, marketCode: "TW" });
    expect(getJsonMock).toHaveBeenCalledWith("/tickers/2330/primary?accountId=acc-2&marketCode=TW");
  });

  it("passes multi-account analysis scope into initial ticker transactions", async () => {
    fetchDashboardPrimaryDataMock.mockResolvedValue({
      settings: { locale: "en" },
      holdings: [],
      holdingGroups: [],
      instruments: [],
      accounts: [
        { id: "acc-1", name: "Brokerage 1" },
        { id: "acc-2", name: "Brokerage 2" },
      ],
      dividends: { upcoming: [], recent: [] },
      actions: { integrityIssue: null },
      feeProfiles: [],
      feeProfileBindings: [],
    } as never);

    const element = await TickerHistoryPage({
      params: Promise.resolve({ ticker: "2330" }),
      searchParams: Promise.resolve({
        accountIds: "acc-1,acc-2",
        fromDate: "2026-04-10",
        marketCode: "tw",
        source: "unrealized-pnl-analysis",
        toDate: "2026-06-26",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-transaction-account-filter=""');
    expect(html).toContain('data-transaction-account-ids-filter="acc-1,acc-2"');
    expect(fetchTransactionHistoryMock).toHaveBeenCalledWith({
      ticker: "2330",
      accountId: undefined,
      accountIds: ["acc-1", "acc-2"],
      marketCode: "TW",
    });
    expect(getJsonMock).toHaveBeenCalledWith("/tickers/2330/primary?accountIds=acc-1%2Cacc-2&marketCode=TW");
  });

  it("passes effective ticker intraday settings into the ticker client", async () => {
    fetchDashboardPrimaryDataMock.mockResolvedValue({
      settings: {
        locale: "en",
        quotePollIntervalSeconds: 10,
        effectiveTickerPriceIntradayEnabled: true,
        effectiveTickerPriceIntradayRefreshIntervalMinutes: 5,
      },
      holdings: [],
      holdingGroups: [],
      instruments: [],
      accounts: [{ id: "acc-2", name: "Brokerage 2" }],
      dividends: { upcoming: [], recent: [] },
      actions: { integrityIssue: null },
      feeProfiles: [],
      feeProfileBindings: [],
    } as never);

    const element = await TickerHistoryPage({
      params: Promise.resolve({ ticker: "2330" }),
      searchParams: Promise.resolve({ accountId: "acc-2", marketCode: "TW" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-quote-poll-seconds="10"');
    expect(html).toContain('data-intraday-enabled="true"');
    expect(html).toContain('data-intraday-interval-minutes="5"');
  });

  it("renders the shell fallback when dashboard loading fails", async () => {
    fetchDashboardPrimaryDataMock.mockRejectedValue(new Error("dashboard unavailable"));

    const element = await TickerHistoryPage({
      params: Promise.resolve({ ticker: "nvda" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Failed to load data for NVDA.");
    expect(html).toContain("Back to portfolio");
    expect(html).not.toContain('data-testid="ticker-history-client"');
  });

  it("renders zh-TW fallback copy when dashboard loading fails for a zh-TW session", async () => {
    getJsonMock.mockImplementation(async (path: string) => {
      if (path === "/profile") return {};
      if (path === "/settings") return { locale: "zh-TW", quotePollIntervalSeconds: 10 };
      return {};
    });
    fetchDashboardPrimaryDataMock.mockRejectedValue(new Error("dashboard unavailable"));

    const element = await TickerHistoryPage({
      params: Promise.resolve({ ticker: "2330" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("無法載入 2330 的資料。");
    expect(html).toContain("返回持倉");
  });
});
