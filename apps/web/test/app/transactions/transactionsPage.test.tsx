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

vi.mock("../../../features/portfolio/services/portfolioService", () => ({
  fetchTransactionsPrimaryData: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell: ({
    children,
    initialPortfolioConfig,
  }: {
    children: React.ReactNode;
    initialPortfolioConfig?: { accounts?: unknown[] } | null;
  }) => (
    <div
      data-testid="mock-app-shell"
      data-portfolio-config-accounts={String(initialPortfolioConfig?.accounts?.length ?? 0)}
    >
      {children}
    </div>
  ),
}));

vi.mock("../../../components/dashboard/DashboardLoading", () => ({
  DashboardLoading: () => <div data-testid="dashboard-loading" />,
}));

vi.mock("../../../components/transactions/TransactionsClient", () => ({
  TransactionsClient: ({
    initialPrimaryData,
    initialTab,
  }: {
    initialPrimaryData: { recentTransactions?: unknown[] } | null;
    initialTab?: string;
  }) => (
    <div
      data-testid="transactions-client"
      data-has-initial-primary={String(initialPrimaryData !== null)}
      data-recent-count={String(initialPrimaryData?.recentTransactions?.length ?? 0)}
      data-initial-tab={initialTab ?? ""}
    />
  ),
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { fetchTransactionsPrimaryData } from "../../../features/portfolio/services/portfolioService";
import TransactionsPage from "../../../app/transactions/page";

const requireSessionMock = vi.mocked(requireSession);
const getJsonMock = vi.mocked(getJson);
const readSidebarStateCookieMock = vi.mocked(readSidebarStateCookie);
const fetchTransactionsPrimaryDataMock = vi.mocked(fetchTransactionsPrimaryData);

const primaryData = {
  recentTransactions: [{ id: "tx-1" }],
  accountOptions: [{ id: "acc-1", name: "Main", feeProfileName: "Default", defaultCurrency: "USD" }],
  portfolioConfig: {
    accounts: [{ id: "acc-1" }],
    feeProfiles: [{ id: "fee-1" }],
    feeProfileBindings: [],
    integrityIssue: null,
  },
};

describe("TransactionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ isDemo: false } as never);
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/settings") return { locale: "en" };
      if (path === "/profile") return {};
      return {};
    }) as never);
    readSidebarStateCookieMock.mockResolvedValue(false as never);
    fetchTransactionsPrimaryDataMock.mockResolvedValue(primaryData as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("server-seeds transactions primary data and shell portfolio config", async () => {
    const element = await TransactionsPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(fetchTransactionsPrimaryDataMock).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-testid="transactions-client"');
    expect(html).toContain('data-has-initial-primary="true"');
    expect(html).toContain('data-recent-count="1"');
    expect(html).toContain('data-portfolio-config-accounts="1"');
    expect(html).toContain('data-initial-tab="posted"');
  });

  it("falls back cleanly when the transactions primary request fails", async () => {
    fetchTransactionsPrimaryDataMock.mockRejectedValue(new Error("primary unavailable"));

    const element = await TransactionsPage({
      searchParams: Promise.resolve({ tab: "ai-inbox" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-has-initial-primary="false"');
    expect(html).toContain('data-recent-count="0"');
    expect(html).toContain('data-initial-tab="ai-inbox"');
    expect(html).toContain('data-portfolio-config-accounts="0"');
  });
});
