import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/auth", () => ({
  requireSession: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../lib/sidebar-cookie", () => ({
  readSidebarStateCookie: vi.fn(),
}));

vi.mock("../../../features/dashboard/services/dashboardService", () => ({
  fetchDashboardSnapshot: vi.fn(),
}));

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendCalendarSnapshot: vi.fn(),
  fetchDividendLedgerReview: vi.fn(),
  fetchDividendLedgerYears: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-app-shell">{children}</div>,
}));

vi.mock("../../../components/dashboard/DashboardLoading", () => ({
  DashboardLoading: () => <div data-testid="dashboard-loading" />,
}));

vi.mock("../../../components/dividends/DividendsTabsClient", () => ({
  DividendsTabsClient: ({ initialTab }: { initialTab: string }) => (
    <div data-testid="dividends-tabs-client" data-initial-tab={initialTab} />
  ),
}));

vi.mock("../../../components/dividends/DividendCalendarClient", () => ({
  DividendCalendarClient: () => <div data-testid="dividend-calendar-client" />,
}));

vi.mock("../../../components/dividends/DividendReviewClient", () => ({
  DividendReviewClient: () => <div data-testid="dividend-review-client" />,
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { fetchDashboardSnapshot } from "../../../features/dashboard/services/dashboardService";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
} from "../../../features/dividends/services/dividendService";
import DividendsPage from "../../../app/dividends/page";

const requireSessionMock = vi.mocked(requireSession);
const getJsonMock = vi.mocked(getJson);
const readSidebarStateCookieMock = vi.mocked(readSidebarStateCookie);
const fetchDashboardSnapshotMock = vi.mocked(fetchDashboardSnapshot);
const fetchDividendCalendarSnapshotMock = vi.mocked(fetchDividendCalendarSnapshot);
const fetchDividendLedgerReviewMock = vi.mocked(fetchDividendLedgerReview);
const fetchDividendLedgerYearsMock = vi.mocked(fetchDividendLedgerYears);

describe("DividendsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ isDemo: false } as never);
    getJsonMock.mockResolvedValue({} as never);
    readSidebarStateCookieMock.mockResolvedValue(false as never);
    fetchDashboardSnapshotMock.mockResolvedValue({
      settings: { locale: "en" },
      accounts: [{ id: "acc-1", name: "Main" }],
    } as never);
    fetchDividendCalendarSnapshotMock.mockResolvedValue({ events: [], ledgerEntries: [] } as never);
    fetchDividendLedgerReviewMock.mockResolvedValue({
      ledgerEntries: [],
      total: 0,
      aggregates: {
        totalExpectedCashAmount: {},
        totalReceivedCashAmount: {},
        openCount: 0,
        byMonth: {},
        byTicker: {},
      },
    } as never);
    fetchDividendLedgerYearsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("plain route probes review once before falling back to calendar", async () => {
    await DividendsPage({
      searchParams: Promise.resolve({}),
    });

    expect(fetchDividendCalendarSnapshotMock).toHaveBeenCalledTimes(1);
    expect(fetchDividendLedgerReviewMock).toHaveBeenCalledTimes(1);
    expect(fetchDividendLedgerYearsMock).not.toHaveBeenCalled();
  });

  it("ledger first render skips inactive calendar fetches", async () => {
    await DividendsPage({
      searchParams: Promise.resolve({ view: "ledger" }),
    });

    expect(fetchDividendLedgerReviewMock).toHaveBeenCalledTimes(1);
    expect(fetchDividendLedgerYearsMock).toHaveBeenCalledTimes(1);
    expect(fetchDividendCalendarSnapshotMock).not.toHaveBeenCalled();
  });

  it("defaults to review when open review items exist on the plain route", async () => {
    fetchDividendLedgerReviewMock.mockResolvedValueOnce({
      ledgerEntries: [{ id: "entry-1" }],
      total: 1,
      aggregates: {
        totalExpectedCashAmount: {},
        totalReceivedCashAmount: {},
        openCount: 2,
        byMonth: {},
        byTicker: {},
      },
    } as never);

    const result = await DividendsPage({
      searchParams: Promise.resolve({}),
    });

    expect(fetchDividendLedgerReviewMock).toHaveBeenCalledTimes(1);
    expect(fetchDividendLedgerYearsMock).toHaveBeenCalledTimes(1);
    expect(fetchDividendCalendarSnapshotMock).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
