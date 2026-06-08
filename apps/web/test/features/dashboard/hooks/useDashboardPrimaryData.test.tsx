import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "../../../../features/dashboard/types";
import { useDashboardPrimaryData } from "../../../../features/dashboard/hooks/useDashboardData";
import { buildRouteDtoCacheKey, readRouteDtoCache, writeRouteDtoCache } from "../../../../lib/routeDtoCache";

vi.mock("../../../../features/dashboard/services/dashboardService", () => ({
  fetchDashboardEnrichmentData: vi.fn(),
  fetchDashboardPrimaryData: vi.fn(),
}));

import {
  fetchDashboardEnrichmentData,
  fetchDashboardPrimaryData,
} from "../../../../features/dashboard/services/dashboardService";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
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
  },
  holdings: [],
  holdingGroups: [],
  dividends: { upcoming: [], recent: [] },
  actions: { integrityIssue: null, recomputeAvailable: true },
  instruments: [],
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
};

function snapshotWithMarketValue(marketValueAmount: number): DashboardSnapshot {
  return {
    ...initialPrimaryData,
    summary: {
      ...initialPrimaryData.summary,
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
  initialData = null,
}: {
  cacheScope?: string;
  initialData?: DashboardSnapshot | null;
}) {
  result = useDashboardPrimaryData({
    cacheKey: buildRouteDtoCacheKey("dashboard-primary", cacheScope),
    initialTransaction,
    initialPrimaryData: initialData,
  });
  return null;
}

describe("useDashboardPrimaryData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installLocalStorageMock();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    vi.mocked(fetchDashboardEnrichmentData).mockResolvedValue(initialPrimaryData);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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

  it("restores cached primary data before refreshing in the background", async () => {
    const cached = snapshotWithMarketValue(1750);
    const refreshed = snapshotWithMarketValue(2100);
    writeRouteDtoCache(buildRouteDtoCacheKey("dashboard-primary", "self"), cached);
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
