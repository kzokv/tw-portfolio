import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDefaultCurrency, RouteCachePolicyDto } from "@vakwen/shared-types";
import type { DashboardSnapshot } from "../../../../features/dashboard/types";
import { useDashboardPrimaryData } from "../../../../features/dashboard/hooks/useDashboardData";
import { buildRouteDtoCacheKey, readRouteDtoCache, writeRouteDtoCache } from "../../../../lib/routeDtoCache";
import { testPriceStateRollup } from "../../../fixtures/priceState";

vi.mock("../../../../features/dashboard/services/dashboardService", () => ({
  fetchDashboardEnrichmentData: vi.fn(),
  fetchDashboardPrimaryData: vi.fn(),
}));

import {
  fetchDashboardEnrichmentData,
  fetchDashboardPrimaryData,
} from "../../../../features/dashboard/services/dashboardService";

function installStorageMocks() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(window, key, { configurable: true, value: storage });
  }
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let result: ReturnType<typeof useDashboardPrimaryData>;

const initialTransaction = {
  accountId: "",
  ticker: "",
  marketCode: null,
  quantity: 1000,
  unitPrice: 100,
  priceCurrency: "TWD" as const,
  tradeDate: "2026-06-02",
  type: "BUY" as const,
  isDayTrade: false,
};

const initialPrimaryData: DashboardSnapshot = {
  settings: null,
  summary: {
    asOf: "2026-06-02",
    accountCount: 1,
    holdingCount: 1,
    totalCostAmount: 1200,
    reportingCurrency: "TWD",
    fxStatus: "complete",
    marketValueAmount: 1500,
    unrealizedPnlAmount: 300,
    dailyChangeAmount: 12,
    dailyChangePercent: 0.8,
    upcomingDividendCount: 0,
    upcomingDividendAmount: null,
    openIssueCount: 0,
    priceStateRollup: testPriceStateRollup({ holdingCount: 1, currentPriceCount: 1 }),
  },
  marketStates: [],
  marketValues: [],
  holdings: [],
  holdingGroups: [],
  dividends: { upcoming: [], recent: [] },
  actions: { integrityIssue: null, recomputeAvailable: true },
  instruments: [],
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
};

function snapshotWithMarketValue(marketValueAmount: number | null): DashboardSnapshot {
  return {
    ...initialPrimaryData,
    summary: {
      ...initialPrimaryData.summary,
      marketValueAmount,
    },
  };
}

function snapshotWithReportingCurrency(
  reportingCurrency: AccountDefaultCurrency,
  marketValueAmount: number,
): DashboardSnapshot {
  return {
    ...initialPrimaryData,
    summary: {
      ...initialPrimaryData.summary,
      reportingCurrency,
      marketValueAmount,
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function Harness({
  cacheScope = "self",
  cachePolicy,
  expectedReportingCurrency,
  initialData = null,
}: {
  cacheScope?: string;
  cachePolicy?: RouteCachePolicyDto | null;
  expectedReportingCurrency?: AccountDefaultCurrency | null;
  initialData?: DashboardSnapshot | null;
}) {
  result = useDashboardPrimaryData({
    cacheKey: buildRouteDtoCacheKey("dashboard-primary", cacheScope),
    cachePolicy,
    expectedReportingCurrency,
    initialTransaction,
    initialPrimaryData: initialData,
  });
  return null;
}

describe("useDashboardPrimaryData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installStorageMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.mocked(fetchDashboardEnrichmentData).mockResolvedValue(initialPrimaryData);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.mocked(fetchDashboardEnrichmentData).mockReset();
    vi.mocked(fetchDashboardPrimaryData).mockReset();
  });

  it("hydrates immediately from server-provided initial primary data", async () => {
    act(() => {
      root.render(<Harness initialData={initialPrimaryData} />);
    });

    await act(async () => {});

    expect(result.isBootstrapping).toBe(false);
    expect(result.summary.marketValueAmount).toBe(1500);
    expect(fetchDashboardPrimaryData).not.toHaveBeenCalled();
    expect(fetchDashboardEnrichmentData).toHaveBeenCalledTimes(1);
  });

  it("fetches primary data when no initial payload is provided", async () => {
    vi.mocked(fetchDashboardPrimaryData).mockResolvedValue(initialPrimaryData);

    act(() => {
      root.render(<Harness />);
    });

    await act(async () => {});

    expect(fetchDashboardPrimaryData).toHaveBeenCalledTimes(1);
    expect(fetchDashboardEnrichmentData).toHaveBeenCalledTimes(1);
    expect(result.isBootstrapping).toBe(false);
    expect(result.summary.marketValueAmount).toBe(1500);
  });

  it("restores fresh cached primary data without fetching again", async () => {
    const cached = snapshotWithMarketValue(1750);
    writeRouteDtoCache(buildRouteDtoCacheKey("dashboard-primary", "self"), cached);

    act(() => {
      root.render(<Harness />);
    });

    expect(result.summary.marketValueAmount).toBe(1750);
    expect(result.restoredFromCache).toBe(true);

    await act(async () => {});

    expect(fetchDashboardPrimaryData).not.toHaveBeenCalled();
    expect(fetchDashboardEnrichmentData).not.toHaveBeenCalled();
    expect(result.summary.marketValueAmount).toBe(1750);
  });

  it("refreshes enrichment when a fresh cached primary-only snapshot is restored", async () => {
    const cached = snapshotWithMarketValue(null);
    const enriched = snapshotWithMarketValue(2200);
    writeRouteDtoCache(buildRouteDtoCacheKey("dashboard-primary", "self"), cached);
    vi.mocked(fetchDashboardEnrichmentData).mockResolvedValue(enriched);

    act(() => {
      root.render(<Harness />);
    });

    expect(result.summary.marketValueAmount).toBeNull();
    expect(result.restoredFromCache).toBe(true);

    await act(async () => {});

    expect(fetchDashboardPrimaryData).not.toHaveBeenCalled();
    expect(fetchDashboardEnrichmentData).toHaveBeenCalledTimes(1);
    expect(result.summary.marketValueAmount).toBe(2200);
  });

  it("writes enrichment results with the dashboard enrichment cache TTL", async () => {
    const cachePolicy: RouteCachePolicyDto = {
      mode: "custom",
      dashboardPrimaryTtlMs: 120_000,
      dashboardEnrichmentTtlMs: 45_000,
      dashboardPerformanceTtlMs: 300_000,
      portfolioTtlMs: 120_000,
      reportsTtlMs: 300_000,
      staleUsableTtlMs: 600_000,
    };
    const cacheKey = buildRouteDtoCacheKey("dashboard-primary", "self");
    const enriched = snapshotWithMarketValue(2200);
    vi.mocked(fetchDashboardEnrichmentData).mockResolvedValue(enriched);

    act(() => {
      root.render(<Harness cachePolicy={cachePolicy} initialData={initialPrimaryData} />);
    });

    await act(async () => {});

    expect(readRouteDtoCache<DashboardSnapshot>(cacheKey)?.payload.summary.marketValueAmount).toBe(2200);
    expect(readRouteDtoCache<DashboardSnapshot>(cacheKey)?.ttlMs).toBe(45_000);
  });

  it("does not let an older primary request overwrite a fresh cache restore after cache key changes", async () => {
    const oldRequest = createDeferred<DashboardSnapshot>();
    const oldSnapshot = snapshotWithMarketValue(900);
    const ownerSnapshot = snapshotWithMarketValue(3100);
    const ownerCacheScope = "owner-1";
    const ownerCacheKey = buildRouteDtoCacheKey("dashboard-primary", ownerCacheScope);
    vi.mocked(fetchDashboardPrimaryData).mockReturnValueOnce(oldRequest.promise);
    writeRouteDtoCache(ownerCacheKey, ownerSnapshot);

    act(() => {
      root.render(<Harness />);
    });

    expect(fetchDashboardPrimaryData).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(<Harness cacheScope={ownerCacheScope} />);
    });

    expect(result.summary.marketValueAmount).toBe(3100);
    expect(result.restoredFromCache).toBe(true);

    await act(async () => {
      oldRequest.resolve(oldSnapshot);
      await oldRequest.promise;
    });

    expect(result.summary.marketValueAmount).toBe(3100);
  });

  it("restores stale cached primary data before refreshing in the background", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-08T12:00:00.000Z");
    const cached = snapshotWithMarketValue(1750);
    const refreshed = snapshotWithMarketValue(2100);
    vi.setSystemTime(now);
    writeRouteDtoCache(buildRouteDtoCacheKey("dashboard-primary", "self"), cached, 1000);
    vi.setSystemTime(new Date(now.getTime() + 1500));
    vi.mocked(fetchDashboardPrimaryData).mockResolvedValue(refreshed);
    vi.mocked(fetchDashboardEnrichmentData).mockResolvedValue(refreshed);

    act(() => {
      root.render(<Harness />);
    });

    expect(result.summary.marketValueAmount).toBe(1750);
    expect(result.restoredFromCache).toBe(true);

    await act(async () => {});

    expect(fetchDashboardPrimaryData).toHaveBeenCalledTimes(1);
    expect(result.summary.marketValueAmount).toBe(2100);
  });

  it("skips cached primary data when reporting currency does not match the expected currency", async () => {
    const cachedAud = snapshotWithReportingCurrency("AUD", 1750);
    const refreshedTwd = snapshotWithReportingCurrency("TWD", 2100);
    writeRouteDtoCache(buildRouteDtoCacheKey("dashboard-primary", "self"), cachedAud);
    vi.mocked(fetchDashboardPrimaryData).mockResolvedValue(refreshedTwd);
    vi.mocked(fetchDashboardEnrichmentData).mockResolvedValue(refreshedTwd);

    act(() => {
      root.render(<Harness expectedReportingCurrency="TWD" />);
    });

    expect(result.isBootstrapping).toBe(true);
    expect(result.summary.reportingCurrency).toBe("TWD");
    expect(result.summary.marketValueAmount).toBeNull();

    await act(async () => {});

    expect(fetchDashboardPrimaryData).toHaveBeenCalledTimes(1);
    expect(result.restoredFromCache).toBe(false);
    expect(result.summary.reportingCurrency).toBe("TWD");
    expect(result.summary.marketValueAmount).toBe(2100);
  });

  it("revalidates instead of caching a stale server seed after cache key changes", async () => {
    const staleSeed = snapshotWithMarketValue(900);
    const ownerSnapshot = snapshotWithMarketValue(2600);
    const ownerCacheScope = "owner-1";
    const ownerCacheKey = buildRouteDtoCacheKey("dashboard-primary", ownerCacheScope);
    vi.mocked(fetchDashboardPrimaryData).mockResolvedValue(ownerSnapshot);
    vi.mocked(fetchDashboardEnrichmentData).mockResolvedValue(ownerSnapshot);

    act(() => {
      root.render(<Harness initialData={initialPrimaryData} />);
    });
    await act(async () => {});

    act(() => {
      root.render(<Harness cacheScope={ownerCacheScope} initialData={staleSeed} />);
    });
    await act(async () => {});

    expect(fetchDashboardPrimaryData).toHaveBeenCalledTimes(1);
    expect(result.summary.marketValueAmount).toBe(2600);
    expect(readRouteDtoCache<DashboardSnapshot>(ownerCacheKey)?.payload.summary.marketValueAmount).toBe(2600);
  });

  it("ignores stale enrichment responses after a newer refresh starts", async () => {
    const staleEnrichment = createDeferred<DashboardSnapshot>();
    const latestEnrichment = createDeferred<DashboardSnapshot>();
    const refreshedPrimary = snapshotWithMarketValue(2200);
    const staleSnapshot = snapshotWithMarketValue(900);
    const latestSnapshot = snapshotWithMarketValue(2400);
    vi.mocked(fetchDashboardPrimaryData).mockResolvedValue(refreshedPrimary);
    vi.mocked(fetchDashboardEnrichmentData)
      .mockReturnValueOnce(staleEnrichment.promise)
      .mockReturnValueOnce(latestEnrichment.promise);

    act(() => {
      root.render(<Harness initialData={initialPrimaryData} />);
    });

    await act(async () => {});

    expect(fetchDashboardEnrichmentData).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.refresh();
    });

    expect(fetchDashboardEnrichmentData).toHaveBeenCalledTimes(2);
    expect(result.summary.marketValueAmount).toBe(2200);

    await act(async () => {
      staleEnrichment.resolve(staleSnapshot);
      await staleEnrichment.promise;
    });

    expect(result.summary.marketValueAmount).toBe(2200);

    await act(async () => {
      latestEnrichment.resolve(latestSnapshot);
      await latestEnrichment.promise;
    });

    expect(result.summary.marketValueAmount).toBe(2400);
  });
});
