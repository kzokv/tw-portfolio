import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDefaultCurrency } from "@vakwen/shared-types";
import { DashboardClient } from "../../../components/dashboard/DashboardClient";
import type { DashboardSnapshot } from "../../../features/dashboard/types";

const mocks = vi.hoisted(() => ({
  dashboardSnapshot: {
    accounts: [],
    actions: { integrityIssue: null, recomputeAvailable: true },
    dividends: { recent: [], upcoming: [] },
    feeProfileBindings: [],
    feeProfiles: [],
    holdingGroups: [],
    holdings: [],
    instruments: [],
    marketStates: [{
      marketCode: "TW",
      marketState: "closed",
      asOf: "2026-06-17T08:00:00.000Z",
      marketTimeZone: "Asia/Taipei",
      regularSessionOnly: true,
    }],
    marketValues: [],
    settings: null,
    summary: {
      accountCount: 0,
      asOf: "2026-06-12T00:00:00.000Z",
      dailyChangeAmount: null,
      dailyChangePercent: null,
      fxStatus: "complete",
      holdingCount: 0,
      marketValueAmount: 0,
      openIssueCount: 0,
      reportingCurrency: "USD",
      totalCostAmount: 0,
      unrealizedPnlAmount: null,
      upcomingDividendAmount: null,
      upcomingDividendCount: 0,
      priceStateRollup: {
        holdingCount: 0,
        currentPriceCount: 0,
        nonCurrentPriceCount: 0,
        missingPriceCount: 0,
        basisCounts: [],
      },
    },
  } as DashboardSnapshot,
  dashboardRefreshPrices: vi.fn(async () => undefined),
  dashboardRefresh: vi.fn(async () => undefined),
  dashboardPerformanceCalls: [] as Array<{ cacheKey?: string; expectedReportingCurrency?: AccountDefaultCurrency | null }>,
  performanceRefresh: vi.fn(async () => undefined),
  performanceIsLoading: false,
  shellReportingCurrency: "USD" as AccountDefaultCurrency,
}));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useAppShellData: () => ({
    canUseGlobalQuickActions: true,
    contextRefreshSignal: 0,
    isSharedContext: false,
    locale: "en",
    openQuickActions: vi.fn(),
    openRecomputeConfirm: vi.fn(),
    reportingCurrency: mocks.shellReportingCurrency,
    recomputeAction: { isRunning: false },
    routeCachePolicy: null,
    sessionUserId: "user-1",
    sessionUserRole: "admin",
    uiDict: {
      actions: { recomputeHistory: "Recompute History", recomputing: "Recomputing" },
      dashboardHome: {
        commandDividendCount: "{count} dividend(s)",
        commandIssueCount: "{count} issue(s)",
        commandMarketCount: "{count} market(s)",
        commandMarketPulseTitle: "Market Pulse",
        commandNoHoldings: "No holdings",
        commandNoMarketMovers: "No movers",
        commandOpenLabel: "Open",
        commandPortfolioHealthTitle: "Portfolio Health",
        commandTodayTitle: "Today",
        commandUnrealizedLabel: "Unrealized",
        latestAvailableSnapshot: "Latest available snapshot",
        performanceRefreshTimeout: "Performance timed out",
        primaryDataMountedDuringRefresh: "Primary data stays mounted during refresh.",
        silentRefreshRunning: "Refreshing",
      },
      dialogs: { integrityTitle: "Integrity issue" },
      reports: { refresh: "Refresh", restoredFromCache: "Restored from cache at {time}" },
      settings: {
        customizeRangesActiveLabel: "Active",
        customizeRangesAddCustomLabel: "Add",
        customizeRangesAddHint: "Hint",
        customizeRangesAddPlaceholder: "Custom",
        customizeRangesCloseLabel: "Close",
        customizeRangesResetLabel: "Reset",
        customizeRangesSaveError: "Error",
        customizeRangesSaveLabel: "Save",
        customizeRangesSaveSuccess: "Saved",
        customizeRangesSavingLabel: "Saving",
        customizeRangesTitle: "Customize",
        customizeRangesToggleOffLabel: "Disable {range}",
        customizeRangesToggleOnLabel: "Enable {range}",
      },
    },
  }),
}));

vi.mock("../../../components/layout/CardLayoutResetContext", () => ({
  useCardLayoutResetCount: () => 0,
}));

vi.mock("../../../components/layout/SortableCardGrid", () => ({
  SortableCardGrid: () => <div data-testid="mock-sortable-card-grid" />,
}));

vi.mock("../../../features/dashboard/hooks/useDashboardData", () => ({
  useDashboardPrimaryData: () => ({
    ...mocks.dashboardSnapshot,
    cacheStatus: null,
    errorMessage: "",
    isBootstrapping: false,
    isRefreshing: false,
    refresh: mocks.dashboardRefresh,
    refreshPrices: mocks.dashboardRefreshPrices,
    restoredAt: null,
    restoredFromCache: false,
    setErrorMessage: vi.fn(),
    setShowIntegrityDialog: vi.fn(),
    showIntegrityDialog: false,
    synchronizeTransactionDraft: vi.fn(),
  }),
}));

vi.mock("../../../features/dashboard/hooks/useDashboardPerformance", () => ({
  useDashboardPerformance: (options: { cacheKey?: string; expectedReportingCurrency?: AccountDefaultCurrency | null }) => {
    mocks.dashboardPerformanceCalls.push({
      cacheKey: options.cacheKey,
      expectedReportingCurrency: options.expectedReportingCurrency,
    });
    return {
    cacheStatus: null,
    data: null,
    errorMessage: "",
    isLoading: mocks.performanceIsLoading,
    refresh: mocks.performanceRefresh,
    restoredAt: null,
    restoredFromCache: false,
    };
  },
}));

vi.mock("../../../features/portfolio/hooks/useHoldingAllocationBasis", () => ({
  useHoldingAllocationBasis: () => ({ allocationBasis: "market_value" }),
}));

vi.mock("../../../hooks/useEffectiveRanges", () => ({
  useEffectiveRanges: () => ({ effectiveRanges: ["1M", "3M"], refetch: vi.fn() }),
}));

vi.mock("../../../components/dashboard/DashboardHero", () => ({
  DashboardHero: () => <div data-testid="mock-dashboard-hero" />,
}));

vi.mock("../../../components/dashboard/BiggestMoversCard", () => ({
  BiggestMoversCard: () => <div data-testid="mock-biggest-movers" />,
}));

vi.mock("../../../components/dashboard/DashboardLoading", () => ({
  DashboardLoading: () => <div data-testid="mock-dashboard-loading" />,
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("DashboardClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.dashboardRefresh.mockClear();
    mocks.dashboardRefreshPrices.mockClear();
    mocks.dashboardPerformanceCalls.length = 0;
    mocks.performanceRefresh.mockClear();
    mocks.performanceIsLoading = false;
    mocks.shellReportingCurrency = "USD";
    mocks.dashboardSnapshot.holdings = [];
    mocks.dashboardSnapshot.marketStates = [{
      marketCode: "TW",
      marketState: "closed",
      asOf: "2026-06-17T08:00:00.000Z",
      marketTimeZone: "Asia/Taipei",
      regularSessionOnly: true,
    }];
    mocks.dashboardSnapshot.settings = null;
    mocks.dashboardSnapshot.summary.reportingCurrency = "USD";
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("manual refresh refreshes both dashboard primary data and performance trend data", () => {
    act(() => {
      root.render(<DashboardClient />);
    });

    const button = container.querySelector("[data-testid='dashboard-refresh-button']");
    expect(button).not.toBeNull();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.dashboardRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.performanceRefresh).toHaveBeenCalledTimes(1);
  });

  it("keys dashboard performance cache by the owner/context summary currency", () => {
    mocks.dashboardSnapshot.summary.reportingCurrency = "AUD";
    mocks.shellReportingCurrency = "TWD";

    act(() => {
      root.render(<DashboardClient expectedReportingCurrency="TWD" />);
    });

    expect(mocks.dashboardPerformanceCalls.at(-1)).toMatchObject({
      expectedReportingCurrency: "AUD",
    });
    expect(mocks.dashboardPerformanceCalls.at(-1)?.cacheKey).toContain(":AUD:");
  });

  it("keeps delegated performance cache scoped to the owner/context currency when delegate preference changes", () => {
    mocks.dashboardSnapshot.summary.reportingCurrency = "AUD";
    mocks.shellReportingCurrency = "TWD";

    act(() => {
      root.render(<DashboardClient expectedReportingCurrency="TWD" />);
    });

    expect(mocks.dashboardPerformanceCalls.at(-1)?.cacheKey).toContain(":AUD:");

    mocks.shellReportingCurrency = "USD";
    act(() => {
      root.render(<DashboardClient expectedReportingCurrency="USD" />);
    });

    expect(mocks.dashboardPerformanceCalls.at(-1)?.cacheKey).toContain(":AUD:");
    expect(mocks.dashboardPerformanceCalls.at(-1)?.expectedReportingCurrency).toBe("AUD");
  });

  it("disables manual refresh while performance is already loading", () => {
    mocks.performanceIsLoading = true;

    act(() => {
      root.render(<DashboardClient />);
    });

    const button = container.querySelector("[data-testid='dashboard-refresh-button']") as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
  });

  it("polls price enrichment at the admin intraday interval without refreshing primary dashboard data", () => {
    vi.useFakeTimers();
    mocks.dashboardSnapshot.marketStates = [{
      marketCode: "TW",
      marketState: "open",
      asOf: "2026-06-18T02:00:00.000Z",
      marketTimeZone: "Asia/Taipei",
      regularSessionOnly: true,
    }];
    mocks.dashboardSnapshot.settings = {
      userId: "user-1",
      locale: "en",
      costBasisMethod: "WEIGHTED_AVERAGE",
      quotePollIntervalSeconds: 10,
      effectiveTickerPriceIntradayEnabled: true,
      effectiveTickerPriceIntradayRefreshIntervalMinutes: 5,
    };

    act(() => {
      root.render(<DashboardClient />);
    });

    act(() => {
      vi.advanceTimersByTime(299_999);
    });
    expect(mocks.dashboardRefreshPrices).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mocks.dashboardRefreshPrices).toHaveBeenCalledTimes(1);
    expect(mocks.dashboardRefresh).not.toHaveBeenCalled();
  });

  it("does not poll price enrichment when admin disables intraday freshness", () => {
    vi.useFakeTimers();
    mocks.dashboardSnapshot.marketStates = [{
      marketCode: "TW",
      marketState: "open",
      asOf: "2026-06-18T02:00:00.000Z",
      marketTimeZone: "Asia/Taipei",
      regularSessionOnly: true,
    }];
    mocks.dashboardSnapshot.settings = {
      userId: "user-1",
      locale: "en",
      costBasisMethod: "WEIGHTED_AVERAGE",
      quotePollIntervalSeconds: 10,
      effectiveTickerPriceIntradayEnabled: false,
      effectiveTickerPriceIntradayRefreshIntervalMinutes: 5,
    };

    act(() => {
      root.render(<DashboardClient />);
    });

    act(() => {
      vi.advanceTimersByTime(600_000);
    });

    expect(mocks.dashboardRefreshPrices).not.toHaveBeenCalled();
    expect(mocks.dashboardRefresh).not.toHaveBeenCalled();
  });
});
