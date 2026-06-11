import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DailyReviewReportDto, PortfolioReportDto } from "@vakwen/shared-types";
import { ReportsClient } from "../../../components/reports/ReportsClient";
import { parseReportRouteState, type ReportRouteState } from "../../../features/reports/reportState";

const refreshMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const useReportDataMock = vi.hoisted(() => vi.fn());
const openQuickActionsMock = vi.hoisted(() => vi.fn());
const searchParamsMock = vi.hoisted(() => ({ value: "tab=daily-review&scope=all&currencyMode=specified&currency=AUD&range=1Y" }));
const effectiveRangesMock = vi.hoisted(() => ({ value: ["1M", "1Y"] }));
const reportHookOverride = vi.hoisted(() => ({ errorMessage: "" }));
const fetchMock = vi.hoisted(() => vi.fn());
const userPreferencesMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(searchParamsMock.value),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useAppShellData: () => ({
    canUseGlobalQuickActions: true,
    contextRefreshSignal: 0,
    locale: "en",
    openQuickActions: openQuickActionsMock,
    sessionUserId: "user-a",
    uiDict: {
      navigation: {
        reportsLabel: "Reports",
        reportsDescription: "Structured reports",
      },
      dashboardHome: {
        performanceSnapshotAsOfTooltip: "Latest reliable snapshot: {date}. Trend charts use server snapshots only.",
        allocationBasisLabel: "Allocation basis",
        allocationBasisCostBasis: "Cost basis",
        allocationBasisMarketValue: "Market value",
        allocationFallbackLabel: "Cost basis fallback",
        latestAvailableSnapshot: "Latest available snapshot",
        requestedAsOfLabel: "Requested {date}",
      },
      reports: {
        tabDailyReview: "Daily Review",
        tabPortfolio: "Portfolio Report",
        tabMarket: "Market Report",
        controlScope: "Scope",
        controlRange: "Range",
        allMarkets: "All markets",
        resolvedCurrency: "Resolved {currency}",
        changeInQuickActions: "Change in Quick Actions",
        reportingCurrencyQuickActionsOnly: "Reporting currency is managed from Quick Actions.",
        restoredFromCache: "Restored from cache at {time}",
        contentVisibleWhileLoading: "Report content stays visible while fresh data loads.",
        refreshing: "Refreshing",
        refresh: "Refresh",
        reportUnavailable: "Report unavailable",
        noReportData: "No report data",
        noReportDataDescription: "Run refresh after the portfolio read model is available.",
        latestRefreshFailed: "Latest refresh failed",
        reportingCurrencyBadge: "Reporting {currency}",
        fxStatusBadge: "FX {status}",
        marketValue: "Market value",
        bookCost: "Book Cost",
        unrealizedPnl: "Unrealized P&L",
        realizedPnl: "Realized P&L",
        dailyChange: "Daily change",
        income: "Income",
        upcomingIncome: "Upcoming income",
        dividendsCount: "{count} dividend(s)",
        fxStatusTitle: "FX status",
        fxPairDescription: "{from} to {to}",
        fxPairLabel: "{from} to {to}",
        todayTitle: "Today",
        todayDescription: "Deterministic observations from the report data.",
        todayEmpty: "No observations for this scope.",
        topMoversTitle: "Top movers",
        holdingsDetailTitle: "Holdings detail",
        allocationByMarketTitle: "Allocation by market",
        allocationByAccountTitle: "Allocation by account",
        incomeTitle: "Income",
        postedDividendRows: "{count} posted dividend row(s)",
        concentrationTitle: "Concentration",
        marketSummaryTitle: "Market summary",
        topHoldingsTitle: "Top holdings",
        marketDetailTitle: "Market detail",
        performanceTrendTitle: "Performance trend",
        performanceTrendLabel: "Performance trend",
        performanceMetaAsOf: "As of {date}",
        performanceStaleDataWarning: "Market data stale since {date}",
        timelineAuto: "Auto",
        timelineDay: "Day",
        timelineWeek: "Week",
        timelineMonth: "Month",
        timelineYear: "Year",
        noSnapshotSeries: "No server snapshot series is available for this scope.",
        allocationBucketCount: "{count} bucket(s)",
        noAllocationBuckets: "No allocation buckets for this scope.",
        totalRows: "{count} total row(s)",
        ticker: "Ticker",
        position: "Position",
        unitsLabel: "{count} units",
        accountAbbrev: "{count} acct",
        price: "Price",
        pnl: "P&L",
        weight: "Weight",
        openTicker: "Open ticker",
        openTickerAria: "Open {ticker} ticker page",
        viewDetails: "View details",
        holdingDetailTitle: "Holding detail",
        holdingDetailDescription: "Exact report values for the selected holding row.",
        reportingPrice: "Reporting price",
        nativePrice: "Native price",
        nativeMarketValue: "Native market value",
        nativeBookCost: "Native book cost",
        fxRate: "FX rate",
        accounts: "Accounts",
        quantity: "Quantity",
        dailyChangePercent: "Daily change %",
        allocation: "Allocation",
        priceTranslationTitle: "Price translation",
        reportingCurrencySentence: "Reporting currency is {currency}.",
        reportingPriceWithCurrency: "Reporting price ({currency})",
        nativePriceWithCurrency: "Native price ({currency})",
        quoteStatus: "Quote status",
        quoteStatusMissing: "No quote",
        quoteStatusProvisional: "Provisional",
        quoteStatusCurrent: "Current",
      },
      holdings: {
        dataHealthTerm: "Data health",
        dataHealthDescription: "Quote status, FX conversion, and price freshness. Allocation fallback appears when relevant.",
        dataHealthHoldingCount: "Holdings",
        dataHealthMissingQuoteCount: "Missing quotes",
        dataHealthProvisionalQuoteCount: "Provisional quotes",
        dataHealthMissingFxCount: "Missing FX",
        dataHealthStaleQuoteCount: "Stale quotes",
        statusCurrent: "Current",
        statusProvisional: "Provisional",
        statusMissing: "Missing quote",
        fxStatusComplete: "FX complete",
        fxStatusPartial: "FX partial",
        fxStatusMissing: "FX missing",
        freshnessCurrent: "Fresh",
        freshnessStale: "Stale",
        freshnessDelayed: "Delayed",
        avgCostTerm: "Avg Cost",
        unitPnlTerm: "Unit P&L",
        columnSettingsButtonLabel: "Columns",
        columnSettingsTitle: "Column settings",
        dragColumnTitle: "Drag to reorder {column}",
        layoutStyleLabel: "Table style",
        layoutStyleCompact: "Dashboard Top Holdings",
        layoutStyleDetailed: "Portfolio Holdings",
        moveColumnLeftAria: "Move {column} column left",
        moveColumnRightAria: "Move {column} column right",
        resizeColumnAria: "Resize {column} column",
        resetColumnsLabel: "Reset",
        toggleColumnAria: "Show {column} column",
        allocationFallbackMissingQuote: "Missing quote; allocation uses cost basis",
      },
    },
  }),
}));

vi.mock("../../../hooks/useEffectiveRanges", () => ({
  useEffectiveRanges: () => ({ effectiveRanges: effectiveRangesMock.value }),
}));

vi.mock("../../../features/reports/hooks/useReportData", () => ({
  useReportData: (args: { initialReport: DailyReviewReportDto | PortfolioReportDto; state: ReportRouteState }) => {
    useReportDataMock(args);
    return {
      data: args.initialReport,
      errorMessage: reportHookOverride.errorMessage,
      isBootstrapping: false,
      isRefreshing: false,
      refresh: refreshMock,
      restoredFromCache: false,
      restoredAt: null,
    };
  },
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  class ResizeObserverStub {
    observe(): void {
      return undefined;
    }
    unobserve(): void {
      return undefined;
    }
    disconnect(): void {
      return undefined;
    }
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("fetch", fetchMock);
});

const fixture: DailyReviewReportDto = {
  query: {
    scope: "all",
    currencyMode: "specified",
    currency: "AUD",
    reportingCurrency: "AUD",
    nativeCurrency: null,
    range: "1Y",
    asOf: "2026-06-08",
  },
  summary: {
    costBasisAmount: 1000,
    marketValueAmount: 1200,
    unrealizedPnlAmount: 200,
    realizedPnlAmount: 30,
    dailyChangeAmount: 10,
    dailyChangePercent: 0.8,
    incomeAmount: 15,
    upcomingDividendCount: 1,
    upcomingDividendAmount: 12,
  },
  fxStatus: {
    status: "complete",
    reportingCurrency: "AUD",
    nativeCurrencies: ["AUD"],
    missingRatePairs: [],
  },
  dataHealth: {
    holdingCount: 1,
    missingQuoteCount: 0,
    provisionalQuoteCount: 0,
    missingFxCount: 0,
    staleQuoteCount: 0,
  },
  diagnostics: {
    scope: "all",
    reportingCurrency: "AUD",
    requestedAsOf: "2026-06-08",
    lastValuationDate: "2026-06-08",
    marketDataStaleSince: null,
    latestSnapshotDate: "2026-06-08",
    latestReliableValuationDate: "2026-06-08",
    expectedLatestValuationDate: "2026-06-08",
    staleSinceDate: null,
    missingQuoteCount: 0,
    provisionalQuoteCount: 0,
    staleQuoteCount: 0,
    missingFxCount: 0,
    missingProviderSourceCount: 0,
    knownGapReasons: [],
    rowCounts: {
      holdingsTotal: 1,
      holdingsReturned: 1,
      topMovers: 0,
      suggestions: 1,
    },
  },
  suggestions: [{ code: "coverage", severity: "info", title: "Coverage looks complete", detail: "All rows resolved." }],
  topMovers: [],
  holdings: {
    total: 1,
    limit: 25,
    offset: 0,
    rows: [{
      ticker: "BHP",
      instrumentName: "BHP Group",
      marketCode: "AU",
      accountCount: 1,
      quantity: 5,
      nativeCurrency: "AUD",
      nativeAverageCostPerShare: 200,
      nativeCurrentUnitPrice: 240,
      nativeCostBasisAmount: 1000,
      nativeMarketValueAmount: 1200,
      reportingCurrency: "AUD",
      reportingAverageCostPerShare: 200,
      reportingCurrentUnitPrice: 240,
      reportingCostBasisAmount: 1000,
      reportingMarketValueAmount: 1200,
      reportingUnrealizedPnlAmount: 200,
      reportingAllocationPercent: 100,
      fxRateToReporting: 1,
      dailyChangeAmount: 10,
      dailyChangePercent: 0.8,
      quoteStatus: "current",
      fxStatus: "complete",
      freshness: "current",
    }],
  },
};

const portfolioFixture: PortfolioReportDto = {
  query: {
    ...fixture.query,
    range: "1Y",
  },
  summary: fixture.summary,
  fxStatus: fixture.fxStatus,
  dataHealth: fixture.dataHealth,
  diagnostics: {
    ...fixture.diagnostics,
    lastValuationDate: "2026-05-29",
    marketDataStaleSince: "2026-05-29",
    rowCounts: {
      holdingsTotal: 1,
      holdingsReturned: 1,
      topHoldings: 1,
      marketBuckets: 1,
      accountBuckets: 1,
    },
  },
  performance: {
    range: "1Y",
    reportingCurrency: "AUD",
    fxStatus: "complete",
    requestedAsOf: "2026-06-08",
    lastReliableDate: "2026-05-29",
    marketDataStaleSince: "2026-05-29",
    points: [
      {
        date: "2026-05-29",
        totalCostAmount: 1000,
        marketValueAmount: 1200,
        unrealizedPnlAmount: 200,
        cumulativeRealizedPnlAmount: 30,
        cumulativeDividendsAmount: 15,
        totalReturnAmount: 245,
        totalReturnPercent: 24.5,
        fxAvailable: true,
      },
    ],
  },
  allocation: {
    byMarket: [{ key: "AU", label: "Australia", reportingCurrency: "AUD", amount: 1200, allocationPercent: 100 }],
    byAccount: [{ key: "acct-1", label: "Main", reportingCurrency: "AUD", amount: 1200, allocationPercent: 100 }],
  },
  concentration: {
    topHoldings: fixture.holdings.rows,
  },
  income: {
    trailingDividendAmount: 15,
    recentDividendCount: 1,
  },
  holdings: fixture.holdings,
};

describe("ReportsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    refreshMock.mockReset();
    replaceMock.mockReset();
    openQuickActionsMock.mockReset();
    useReportDataMock.mockReset();
    fetchMock.mockReset();
    reportHookOverride.errorMessage = "";
    searchParamsMock.value = "tab=daily-review&scope=all&currencyMode=specified&currency=AUD&range=1Y";
    effectiveRangesMock.value = ["1M", "1Y"];
    userPreferencesMock.value = {};
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ preferences: userPreferencesMock.value }), { status: 200 });
      }
      return new Response(JSON.stringify({ preferences: userPreferencesMock.value }), { status: 200 });
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders daily report summary, controls, and mobile detail rows", async () => {
    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.body.textContent).toContain("Reports");
    expect(document.body.textContent).toContain("Daily Review");
    expect(document.body.textContent).toContain("AUD");
    expect(document.querySelector("[data-testid='reports-control-scope']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-control-range']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-control-currency']")).toBeNull();
    expect(document.querySelector("[data-testid='reports-control-currency-mode']")).toBeNull();
    expect(document.body.textContent).toContain("Resolved AUD");
    expect(document.body.textContent).toContain("Upcoming income");
    expect(document.body.textContent).toContain("1 dividend(s)");
    expect(document.body.textContent).toContain("Coverage looks complete");
    expect(document.body.textContent).toContain("Quote status, FX conversion, and price freshness. Allocation fallback appears when relevant.");
    expect(document.body.textContent).toContain("Data health");
    expect(document.body.textContent).toContain("BHP Group");
    expect(document.querySelector("[data-testid='reports-mobile-row-BHP-AU']")).not.toBeNull();
    const sectionRefresh = document.querySelector("[data-testid='reports-today-refresh']");
    expect(sectionRefresh).not.toBeNull();
    act(() => {
      sectionRefresh?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(refreshMock).toHaveBeenCalledWith({ bypassCache: true });

    const quickActionsButton = document.querySelector("[data-testid='reports-open-quick-actions']");
    expect(quickActionsButton).not.toBeNull();
    act(() => {
      quickActionsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openQuickActionsMock).toHaveBeenCalledTimes(1);
  });

  it("colors Today severity badges by level", async () => {
    const severityFixture: DailyReviewReportDto = {
      ...fixture,
      suggestions: [
        { code: "coverage", severity: "info", title: "Coverage looks complete", detail: "All rows resolved." },
        { code: "quotes", severity: "warning", title: "Quote coverage is mixed", detail: "Some rows need attention." },
        { code: "fx", severity: "critical", title: "FX is missing", detail: "Some totals cannot be reconciled." },
      ],
    };

    act(() => {
      root.render(<ReportsClient initialReport={severityFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-today-severity-coverage']")?.className).toContain("text-primary");
    expect(document.querySelector("[data-testid='reports-today-severity-quotes']")?.className).toContain("text-warning");
    expect(document.querySelector("[data-testid='reports-today-severity-fx']")?.className).toContain("text-destructive");
  });

  it("hydrates report holdings column order and widths from backend preferences", async () => {
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "reports.dailyReview.holdings": {
            columnOrder: ["health", "ticker", "position", "avgCost", "price", "unitPnl", "marketValue", "costBasis", "unrealized", "daily", "weight"],
            hiddenColumns: [],
            columnWidths: { health: 234 },
            layoutStyle: "portfolio",
          },
        },
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const holdingsTable = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.holdings']");
    expect(holdingsTable).not.toBeNull();
    const firstHeader = holdingsTable?.querySelector("[data-testid^='holdings-column-drag-']");
    expect(firstHeader?.getAttribute("data-testid")).toBe("holdings-column-drag-health");
    expect(firstHeader?.getAttribute("draggable")).toBe("true");
    expect((firstHeader?.closest("th") as HTMLTableCellElement | null)?.style.width).toBe("234px");
    expect(holdingsTable?.querySelector("[data-testid='holdings-column-resize-health']")).not.toBeNull();
  });

  it("links tickers, colors finance values, and renders optional fx rates", async () => {
    const rateFixture = {
      ...fixture,
      summary: {
        ...fixture.summary,
        unrealizedPnlAmount: -200,
        realizedPnlAmount: -30,
        dailyChangeAmount: -10,
        dailyChangePercent: -0.8,
      },
      fxRates: [
        {
          fromCurrency: "USD",
          toCurrency: "AUD",
          rate: 1.52,
          asOf: "2026-06-08",
        },
      ],
      holdings: {
        ...fixture.holdings,
        rows: [{
          ...fixture.holdings.rows[0]!,
          nativeCurrency: "USD",
          nativeAverageCostPerShare: 100,
          nativeCurrentUnitPrice: 150,
          nativeCostBasisAmount: 500,
          nativeMarketValueAmount: 750,
          reportingAverageCostPerShare: 152,
          reportingCurrentUnitPrice: 228,
          fxRateToReporting: 1.52,
          reportingUnrealizedPnlAmount: -200,
          dailyChangeAmount: -10,
          dailyChangePercent: -0.8,
        }],
      },
    } as DailyReviewReportDto;

    act(() => {
      root.render(<ReportsClient initialReport={rateFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const tickerLinks = Array.from(document.querySelectorAll("a")).map((anchor) => anchor.getAttribute("href"));
    expect(tickerLinks).toContain("/tickers/BHP?marketCode=AU");
    expect(document.body.textContent).toContain("Open ticker");

    const negativeValue = Array.from(document.querySelectorAll("p, span, h3, div")).find((node) =>
      node.textContent?.includes("-AUD 10") && String(node.className).includes("text-[hsl(var(--destructive))]"));
    expect(negativeValue?.className).toContain("text-[hsl(var(--destructive))]");
    expect(document.body.textContent).toContain("Native price $150.00");

    const fxRates = document.querySelector("[data-testid='reports-fx-rates']");
    expect(fxRates?.textContent).toContain("USD to AUD");
    expect(fxRates?.textContent).toContain("1.52");

    const viewDetailsButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("View details"));
    expect(viewDetailsButton).not.toBeUndefined();
    act(() => {
      viewDetailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Daily change %");
    expect(document.body.textContent).toContain("Reporting price");
    expect(document.body.textContent).toContain("Native price");
    expect(document.body.textContent).toContain("FX rate");
    expect(document.body.textContent).toContain("1.52");
    const detailPercent = Array.from(document.querySelectorAll("span")).find((node) => node.textContent?.includes("-0.8%"));
    expect(detailPercent?.className).toContain("text-[hsl(var(--destructive))]");
  });

  it("does not render a stale daily-review DTO as another report tab", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&currencyMode=specified&currency=AUD&range=1Y";

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-loading-skeleton']")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Performance trend");
  });

  it("keeps cached report content visible when refresh reports an error", async () => {
    reportHookOverride.errorMessage = "Report refresh timed out. Try refreshing again.";

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-error']")).toBeNull();
    expect(document.querySelector("[data-testid='reports-refresh-error']")?.textContent).toContain("Report refresh timed out");
    expect(document.querySelector("[data-testid='reports-daily-review-content']")).not.toBeNull();
    expect(document.body.textContent).toContain("Top movers");
  });

  it("renders portfolio report performance as-of and stale-data metadata", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&currencyMode=specified&currency=AUD&range=1Y";

    act(() => {
      root.render(<ReportsClient initialReport={portfolioFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    expect(document.body.textContent).toContain("Performance trend");
    expect(document.body.textContent).toContain("As of May 29, 2026");
    expect(document.body.textContent).toContain("Market data stale since May 29, 2026");
    expect(document.querySelector("[data-testid='reports-performance-stale-warning']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-performance-as-of-tooltip-trigger']")).not.toBeNull();
  });

  it("snaps unsupported report ranges to the configured dashboard ranges", async () => {
    searchParamsMock.value = "tab=daily-review&scope=all&currencyMode=specified&currency=AUD&range=5Y";
    effectiveRangesMock.value = ["1M", "1Y"];

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("range=1M"),
      { scroll: false },
    );
    expect(replaceMock).not.toHaveBeenCalledWith(
      expect.stringContaining("range=5Y"),
      expect.anything(),
    );
  });

  it("syncs report state from changed search params while mounted", async () => {
    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    searchParamsMock.value = "tab=market&scope=AU&currencyMode=auto&currency=AUD&range=1M";

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(useReportDataMock).toHaveBeenLastCalledWith(expect.objectContaining({
      state: {
        tab: "market",
        scope: "AU",
        range: "1M",
      },
    }));
  });
});
