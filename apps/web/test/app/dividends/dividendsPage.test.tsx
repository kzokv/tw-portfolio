import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../lib/auth", () => ({
  requireSession: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../lib/sidebar-cookie", () => ({
  readSidebarStateCookie: vi.fn(),
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
  DividendsTabsClient: ({
    initialTab,
    initialCalendarSnapshot,
    initialReviewData,
    initialYears,
    accounts,
  }: {
    initialTab: string;
    initialCalendarSnapshot: unknown;
    initialReviewData: unknown;
    initialYears: unknown[];
    accounts: unknown[];
  }) => (
    <div
      data-testid="dividends-tabs-client"
      data-initial-tab={initialTab}
      data-has-calendar-snapshot={String(initialCalendarSnapshot !== null)}
      data-has-review-data={String(initialReviewData !== null)}
      data-years-count={String(initialYears.length)}
      data-accounts-count={String(accounts.length)}
    />
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
import {
  fetchDividendCalendarSnapshot,
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
} from "../../../features/dividends/services/dividendService";
import DividendsPage from "../../../app/dividends/page";

const requireSessionMock = vi.mocked(requireSession);
const getJsonMock = vi.mocked(getJson);
const readSidebarStateCookieMock = vi.mocked(readSidebarStateCookie);
const fetchDividendCalendarSnapshotMock = vi.mocked(fetchDividendCalendarSnapshot);
const fetchDividendLedgerReviewMock = vi.mocked(fetchDividendLedgerReview);
const fetchDividendLedgerYearsMock = vi.mocked(fetchDividendLedgerYears);

describe("DividendsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ isDemo: false } as never);
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/settings") return { locale: "en" };
      if (path === "/settings/fee-config") return { accounts: [{ id: "acc-1", name: "Main" }] };
      if (path === "/profile") return {};
      return {};
    }) as never);
    readSidebarStateCookieMock.mockResolvedValue(false as never);
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

  it("plain route renders calendar shell without server-side dividend probes", async () => {
    const result = await DividendsPage({
      searchParams: Promise.resolve({}),
    });

    expect(fetchDividendCalendarSnapshotMock).toHaveBeenCalledWith({
      fromPaymentDate: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      toPaymentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      limit: 500,
    });
    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();
    expect(fetchDividendLedgerYearsMock).not.toHaveBeenCalled();
    expect(getJsonMock).not.toHaveBeenCalledWith("/settings/fee-config");
    expect(result).toBeTruthy();
  });

  it("calendar route server-prefetches the requested month and passes it to the tabs client", async () => {
    const result = await DividendsPage({
      searchParams: Promise.resolve({ month: "2026-07" }),
    });
    const html = renderToStaticMarkup(result);

    expect(fetchDividendCalendarSnapshotMock).toHaveBeenCalledWith({
      fromPaymentDate: "2026-07-01",
      toPaymentDate: "2026-07-31",
      limit: 500,
    });
    expect(html).toContain('data-has-calendar-snapshot="true"');
  });

  it("ledger route preserves the requested tab without server-side dividend reads", async () => {
    const result = await DividendsPage({
      searchParams: Promise.resolve({ view: "ledger" }),
    });
    const html = renderToStaticMarkup(result);

    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();
    expect(fetchDividendLedgerYearsMock).not.toHaveBeenCalled();
    expect(fetchDividendCalendarSnapshotMock).not.toHaveBeenCalled();
    expect(getJsonMock).toHaveBeenCalledWith("/settings/fee-config");
    expect(html).toContain('data-accounts-count="1"');
    expect(result).toBeTruthy();
  });

  it("does not block the plain route on review counts before first paint", async () => {
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

    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();
    expect(fetchDividendLedgerYearsMock).not.toHaveBeenCalled();
    expect(fetchDividendCalendarSnapshotMock).toHaveBeenCalledTimes(1);
    expect(result).toBeTruthy();
  });
});
