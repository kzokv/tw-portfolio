import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "../../../../features/dashboard/types";
import { useDashboardPrimaryData } from "../../../../features/dashboard/hooks/useDashboardData";

vi.mock("../../../../features/dashboard/services/dashboardService", () => ({
  fetchDashboardEnrichmentData: vi.fn(),
  fetchDashboardPrimaryData: vi.fn(),
}));

import {
  fetchDashboardEnrichmentData,
  fetchDashboardPrimaryData,
} from "../../../../features/dashboard/services/dashboardService";

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

function Harness({ initialData = null }: { initialData?: DashboardSnapshot | null }) {
  result = useDashboardPrimaryData({
    initialTransaction,
    initialPrimaryData: initialData,
  });
  return null;
}

describe("useDashboardPrimaryData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
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
});
