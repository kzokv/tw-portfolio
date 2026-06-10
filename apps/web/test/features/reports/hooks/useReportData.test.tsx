import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDefaultCurrency, DailyReviewReportDto } from "@vakwen/shared-types";
import { REPORT_CLIENT_REFRESH_TIMEOUT_MS, useReportData } from "../../../../features/reports/hooks/useReportData";
import type { ReportRouteState } from "../../../../features/reports/reportState";
import { buildRouteDtoCacheKey, readRouteDtoCache, writeRouteDtoCache } from "../../../../lib/routeDtoCache";

vi.mock("../../../../features/reports/services/reportService", () => ({
  fetchReport: vi.fn(),
}));

import { fetchReport } from "../../../../features/reports/services/reportService";

const state: ReportRouteState = {
  tab: "daily-review",
  scope: "all",
  range: "1Y",
};
const defaultCacheScope = "session:user-a:context:self";
const locale = "en";

let result: ReturnType<typeof useReportData>;

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

function buildReport(
  title: string,
  asOf: string,
  reportState: ReportRouteState = state,
  reportingCurrency: AccountDefaultCurrency = "AUD",
): DailyReviewReportDto {
  return {
    query: {
      scope: reportState.scope,
      currencyMode: "auto",
      currency: null,
      reportingCurrency,
      nativeCurrency: null,
      range: reportState.range,
      asOf,
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
      reportingCurrency,
      nativeCurrencies: [reportingCurrency],
      missingRatePairs: [],
    },
    dataHealth: {
      holdingCount: 0,
      missingQuoteCount: 0,
      provisionalQuoteCount: 0,
      missingFxCount: 0,
      staleQuoteCount: 0,
    },
    diagnostics: {
      scope: reportState.scope,
      reportingCurrency,
      requestedAsOf: asOf,
      lastValuationDate: asOf,
      marketDataStaleSince: null,
      latestSnapshotDate: asOf,
      latestReliableValuationDate: asOf,
      expectedLatestValuationDate: asOf,
      staleSinceDate: null,
      missingQuoteCount: 0,
      provisionalQuoteCount: 0,
      staleQuoteCount: 0,
      missingFxCount: 0,
      missingProviderSourceCount: 0,
      knownGapReasons: [],
      rowCounts: {
        holdingsTotal: 0,
        holdingsReturned: 0,
        topMovers: 0,
        suggestions: 1,
      },
    },
    suggestions: [{ code: "daily", severity: "info", title, detail: title }],
    topMovers: [],
    holdings: { total: 0, limit: 25, offset: 0, rows: [] },
  };
}

function reportCacheKey(cacheScope = defaultCacheScope, reportState: ReportRouteState = state) {
  return buildRouteDtoCacheKey(
    "reports",
    reportState.tab,
    cacheScope,
    locale,
    reportState.scope,
    reportState.range,
  );
}

function Harness({
  cacheScope = defaultCacheScope,
  contextRefreshSignal,
  initialReport,
  stateOverride = state,
}: {
  cacheScope?: string;
  contextRefreshSignal: number;
  initialReport: DailyReviewReportDto | null;
  stateOverride?: ReportRouteState;
}) {
  result = useReportData({
    cacheScope,
    contextRefreshSignal,
    initialReport,
    locale,
    state: stateOverride,
  });
  return null;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("useReportData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installLocalStorageMock();
    window.localStorage.clear();
    vi.mocked(fetchReport).mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("accepts refreshed matching server reports and refreshes the route cache", async () => {
    const first = buildReport("First seed", "2026-06-08");
    const second = buildReport("Second seed", "2026-06-09");

    act(() => {
      root.render(<Harness contextRefreshSignal={0} initialReport={first} />);
    });
    await act(async () => {});

    expect((result.data as DailyReviewReportDto | null)?.suggestions[0]?.title).toBe("First seed");
    expect(fetchReport).not.toHaveBeenCalled();

    act(() => {
      root.render(<Harness contextRefreshSignal={0} initialReport={second} />);
    });
    await act(async () => {});

    expect((result.data as DailyReviewReportDto | null)?.suggestions[0]?.title).toBe("Second seed");
    expect(readRouteDtoCache<DailyReviewReportDto>(reportCacheKey())?.payload.suggestions[0]?.title).toBe("Second seed");
    expect(fetchReport).not.toHaveBeenCalled();
  });

  it("revalidates instead of caching a stale server report after context changes", async () => {
    const first = buildReport("Self seed", "2026-06-08");
    const staleOwnerSeed = buildReport("Stale self seed", "2026-06-08");
    const ownerReport = buildReport("Owner refresh", "2026-06-09");
    const ownerCacheScope = "session:user-a:context:owner-1";
    vi.mocked(fetchReport).mockResolvedValue(ownerReport);

    act(() => {
      root.render(<Harness contextRefreshSignal={0} initialReport={first} />);
    });
    await act(async () => {});

    act(() => {
      root.render(
        <Harness
          cacheScope={ownerCacheScope}
          contextRefreshSignal={1}
          initialReport={staleOwnerSeed}
        />,
      );
    });
    await act(async () => {});

    expect(fetchReport).toHaveBeenCalledTimes(1);
    expect((result.data as DailyReviewReportDto | null)?.suggestions[0]?.title).toBe("Owner refresh");
    expect(readRouteDtoCache<DailyReviewReportDto>(reportCacheKey(ownerCacheScope))?.payload.suggestions[0]?.title).toBe("Owner refresh");
  });

  it("restores cached reports after mount instead of during the first render", async () => {
    const cached = buildReport("Cached report", "2026-06-08");
    const refreshed = buildReport("Fresh report", "2026-06-09");
    writeRouteDtoCache(reportCacheKey(), cached);
    vi.mocked(fetchReport).mockResolvedValue(refreshed);

    act(() => {
      flushSync(() => {
        root.render(<Harness contextRefreshSignal={0} initialReport={null} />);
      });
      expect(result.data).toBeNull();
      expect(result.isBootstrapping).toBe(true);
      expect(result.restoredFromCache).toBe(false);
    });

    await act(async () => {});

    expect((result.data as DailyReviewReportDto | null)?.suggestions[0]?.title).toBe("Fresh report");
    expect(result.isBootstrapping).toBe(false);
    expect(result.restoredFromCache).toBe(false);
    expect(readRouteDtoCache<DailyReviewReportDto>(reportCacheKey())?.payload.suggestions[0]?.title).toBe("Fresh report");
  });

  it("uses the backend-resolved currency from the report DTO without partitioning route state by currency", async () => {
    const audReport = buildReport("Auto AUD seed", "2026-06-08", state, "AUD");

    act(() => {
      root.render(<Harness contextRefreshSignal={0} initialReport={audReport} stateOverride={state} />);
    });
    await act(async () => {});

    const cached = readRouteDtoCache<DailyReviewReportDto>(reportCacheKey(defaultCacheScope, state))?.payload;
    expect(cached?.suggestions[0]?.title).toBe("Auto AUD seed");
    expect(cached?.query.reportingCurrency).toBe("AUD");
  });

  it("times out initial client refreshes instead of leaving reports bootstrapped forever", async () => {
    vi.useFakeTimers();
    vi.mocked(fetchReport).mockImplementation(((
      _tab: typeof state.tab,
      _state: ReportRouteState,
      options?: { signal?: AbortSignal },
    ) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    }) as never);

    act(() => {
      root.render(<Harness contextRefreshSignal={0} initialReport={null} />);
    });

    expect(result.isBootstrapping).toBe(true);
    expect(result.isRefreshing).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REPORT_CLIENT_REFRESH_TIMEOUT_MS);
    });
    await act(async () => {});

    expect(result.isBootstrapping).toBe(false);
    expect(result.isRefreshing).toBe(false);
    expect(result.errorMessage).toBe("Report refresh timed out. Try refreshing again.");
    expect(result.data).toBeNull();
  });
});
