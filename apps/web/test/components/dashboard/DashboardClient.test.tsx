import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
    },
  } satisfies DashboardSnapshot,
  dashboardRefresh: vi.fn(async () => undefined),
  performanceRefresh: vi.fn(async () => undefined),
  performanceIsLoading: false,
}));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useAppShellData: () => ({
    canUseGlobalQuickActions: true,
    contextRefreshSignal: 0,
    isSharedContext: false,
    locale: "en",
    openQuickActions: vi.fn(),
    openRecomputeConfirm: vi.fn(),
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
    restoredAt: null,
    restoredFromCache: false,
    setErrorMessage: vi.fn(),
    setShowIntegrityDialog: vi.fn(),
    showIntegrityDialog: false,
    synchronizeTransactionDraft: vi.fn(),
  }),
}));

vi.mock("../../../features/dashboard/hooks/useDashboardPerformance", () => ({
  useDashboardPerformance: () => ({
    cacheStatus: null,
    data: null,
    errorMessage: "",
    isLoading: mocks.performanceIsLoading,
    refresh: mocks.performanceRefresh,
    restoredAt: null,
    restoredFromCache: false,
  }),
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
    mocks.performanceRefresh.mockClear();
    mocks.performanceIsLoading = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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

  it("disables manual refresh while performance is already loading", () => {
    mocks.performanceIsLoading = true;

    act(() => {
      root.render(<DashboardClient />);
    });

    const button = container.querySelector("[data-testid='dashboard-refresh-button']") as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
  });
});
