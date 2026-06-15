import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDefaultCurrency, DashboardPerformanceDto } from "@vakwen/shared-types";
import {
  DASHBOARD_PERFORMANCE_REFRESH_TIMEOUT_MS,
  useDashboardPerformance,
} from "../../../../features/dashboard/hooks/useDashboardPerformance";
import { writeRouteDtoCache } from "../../../../lib/routeDtoCache";

vi.mock("../../../../features/dashboard/services/dashboardService", () => ({
  fetchDashboardPerformanceEnrichment: vi.fn(),
}));

import { fetchDashboardPerformanceEnrichment } from "../../../../features/dashboard/services/dashboardService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let result: ReturnType<typeof useDashboardPerformance>;

const emptyPerformance: DashboardPerformanceDto = {
  range: "1M",
  points: [],
  rangeStartDate: "2026-05-11",
  rangeEndDate: "2026-06-11",
  reportingCurrency: "USD",
  fxStatus: "complete",
  requestedAsOf: "2026-06-11",
  lastReliableDate: null,
  marketDataStaleSince: "2026-06-10",
  diagnostics: {
    latestSnapshotDate: null,
    latestReliableValuationDate: null,
    expectedLatestValuationDate: "2026-06-11",
    staleSinceDate: "2026-06-10",
    knownGapReasons: ["missing_snapshot"],
  },
};

function Harness({
  cacheKey,
  enabled = true,
  expectedReportingCurrency,
  timeoutMessage = "Localized dashboard timeout",
}: {
  cacheKey?: string;
  enabled?: boolean;
  expectedReportingCurrency?: AccountDefaultCurrency | null;
  timeoutMessage?: string;
}) {
  result = useDashboardPerformance({ cacheKey, range: "1M", enabled, expectedReportingCurrency, timeoutMessage });
  return null;
}

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

describe("useDashboardPerformance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installStorageMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(fetchDashboardPerformanceEnrichment).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("settles empty or incomplete snapshot series as terminal data instead of staying loading", async () => {
    vi.mocked(fetchDashboardPerformanceEnrichment).mockResolvedValue(emptyPerformance);

    act(() => {
      root.render(<Harness />);
    });

    expect(result.isLoading).toBe(true);

    await act(async () => {});

    expect(result.isLoading).toBe(false);
    expect(result.errorMessage).toBe("");
    expect(result.data).toEqual(emptyPerformance);
  });

  it("times out hanging performance refreshes and clears loading state", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchDashboardPerformanceEnrichment).mockImplementation(((
      _range: DashboardPerformanceDto["range"],
      options?: { signal?: AbortSignal },
    ) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      })) as never);

    act(() => {
      root.render(<Harness />);
    });

    expect(result.isLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_PERFORMANCE_REFRESH_TIMEOUT_MS);
    });
    await act(async () => {});

    expect(result.isLoading).toBe(false);
    expect(result.errorMessage).toBe("Localized dashboard timeout");
    expect(result.data).toBeNull();
  });

  it("clears loading state when a fresh performance cache entry is restored", async () => {
    vi.mocked(fetchDashboardPerformanceEnrichment).mockImplementation((() => new Promise(() => {})) as never);

    act(() => {
      root.render(<Harness />);
    });

    expect(result.isLoading).toBe(true);

    const cacheKey = "dashboard-performance:1M";
    writeRouteDtoCache(cacheKey, emptyPerformance);

    act(() => {
      root.render(<Harness cacheKey={cacheKey} />);
    });
    await act(async () => {});

    expect(result.data).toEqual(emptyPerformance);
    expect(result.isLoading).toBe(false);
    expect(result.errorMessage).toBe("");
    expect(fetchDashboardPerformanceEnrichment).toHaveBeenCalledTimes(1);
  });

  it("ignores cached performance data with a different reporting currency", async () => {
    const cacheKey = "dashboard-performance:1M:AUD";
    const audPerformance = { ...emptyPerformance, reportingCurrency: "AUD" as const };
    writeRouteDtoCache(cacheKey, emptyPerformance);
    vi.mocked(fetchDashboardPerformanceEnrichment).mockResolvedValue(audPerformance);

    act(() => {
      root.render(<Harness cacheKey={cacheKey} expectedReportingCurrency="AUD" />);
    });
    await act(async () => {});

    expect(result.data).toEqual(audPerformance);
    expect(result.restoredFromCache).toBe(false);
    expect(fetchDashboardPerformanceEnrichment).toHaveBeenCalledTimes(1);
  });
});
