import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyReviewReportDto } from "@vakwen/shared-types";
import { useReportData } from "../../../../features/reports/hooks/useReportData";
import type { ReportRouteState } from "../../../../features/reports/reportState";
import { buildRouteDtoCacheKey, readRouteDtoCache } from "../../../../lib/routeDtoCache";

vi.mock("../../../../features/reports/services/reportService", () => ({
  fetchReport: vi.fn(),
}));

import { fetchReport } from "../../../../features/reports/services/reportService";

const state: ReportRouteState = {
  tab: "daily-review",
  scope: "all",
  currencyMode: "specified",
  currency: "AUD",
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

function buildReport(title: string, asOf: string): DailyReviewReportDto {
  return {
    query: {
      scope: state.scope,
      currencyMode: state.currencyMode,
      currency: state.currency,
      reportingCurrency: state.currency,
      nativeCurrency: null,
      range: state.range,
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
      reportingCurrency: state.currency,
      nativeCurrencies: [state.currency],
      missingRatePairs: [],
    },
    dataHealth: {
      holdingCount: 0,
      missingQuoteCount: 0,
      provisionalQuoteCount: 0,
      missingFxCount: 0,
      staleQuoteCount: 0,
    },
    suggestions: [{ code: "daily", severity: "info", title, detail: title }],
    topMovers: [],
    holdings: { total: 0, limit: 25, offset: 0, rows: [] },
  };
}

function reportCacheKey(cacheScope = defaultCacheScope) {
  return buildRouteDtoCacheKey(
    "reports",
    state.tab,
    cacheScope,
    locale,
    state.scope,
    state.currencyMode,
    state.currency,
    state.range,
  );
}

function Harness({
  cacheScope = defaultCacheScope,
  contextRefreshSignal,
  initialReport,
}: {
  cacheScope?: string;
  contextRefreshSignal: number;
  initialReport: DailyReviewReportDto;
}) {
  result = useReportData({
    cacheScope,
    contextRefreshSignal,
    initialReport,
    locale,
    state,
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
});
