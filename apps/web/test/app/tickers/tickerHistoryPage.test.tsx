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

vi.mock("../../../app/tickers/[ticker]/TickerHistoryClient", () => ({
  TickerHistoryClient: ({
    details,
    initialChartQuery,
    initialTradeDate,
    instrument,
    ticker,
    transactionAccountFilter,
    transactionMarketFilter,
  }: {
    details: { position?: { accountScope?: string } };
    initialChartQuery?: { chartEnd?: string; chartRange?: string; chartStart?: string };
    initialTradeDate?: string;
    instrument: { ticker?: string } | null;
    ticker: string;
    transactionAccountFilter?: string;
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
      data-transaction-market-filter={transactionMarketFilter ?? ""}
      data-ticker={ticker}
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
    getJsonMock.mockResolvedValue({} as never);
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
    expect(html).toContain('data-chart-range="CUSTOM"');
    expect(html).toContain('data-chart-start="2024-01-01"');
    expect(html).toContain('data-chart-end="2024-06-30"');
    expect(fetchDashboardPrimaryDataMock).toHaveBeenCalledTimes(1);
    expect(fetchTransactionHistoryMock).toHaveBeenCalledWith({ ticker: "2330", accountId: "acc-2", marketCode: "TW" });
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
});
