import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardPerformanceDto } from "@vakwen/shared-types";
import {
  DASHBOARD_PERFORMANCE_REFRESH_TIMEOUT_MS,
  useDashboardPerformance,
} from "../../../../features/dashboard/hooks/useDashboardPerformance";

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
  enabled = true,
  timeoutMessage = "Localized dashboard timeout",
}: {
  enabled?: boolean;
  timeoutMessage?: string;
}) {
  result = useDashboardPerformance({ range: "1M", enabled, timeoutMessage });
  return null;
}

describe("useDashboardPerformance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
});
