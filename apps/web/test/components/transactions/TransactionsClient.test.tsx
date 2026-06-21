import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getDictionary } from "../../../lib/i18n";
import { AppShellDataProvider, type AppShellData } from "../../../components/layout/AppShellDataContext";
import { TransactionsClient } from "../../../components/transactions/TransactionsClient";
import { deriveSharedContextPermissions } from "../../../features/sharing/capabilities";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
const historyRefreshMock = vi.hoisted(() => vi.fn());
const searchParamsValue = vi.hoisted(() => ({ value: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(searchParamsValue.value),
}));

vi.mock("../../../features/portfolio/hooks/useTransactionsPrimaryData", () => ({
  useTransactionsPrimaryData: () => ({
    data: {
      recentTransactions: [],
      accountOptions: [],
    },
    isBootstrapping: false,
    restoredAt: null,
    restoredFromCache: false,
    isRefreshing: false,
    refresh: refreshMock,
    errorMessage: "",
  }),
}));

vi.mock("../../../components/layout/CardLayoutResetContext", () => ({
  useCardLayoutResetCount: () => 0,
}));

vi.mock("../../../components/layout/SortableCardGrid", () => ({
  SortableCardGrid: ({
    cards,
    children,
  }: {
    cards: Array<{ slug: string }>;
    children: (slug: string) => React.ReactNode;
  }) => (
    <div data-testid="mock-sortable-grid">
      {cards.map((card) => <div key={card.slug}>{children(card.slug)}</div>)}
    </div>
  ),
}));

vi.mock("../../../components/transactions/AiInboxPanel", () => ({
  AiInboxPanel: () => <div data-testid="mock-ai-inbox-panel" />,
}));

vi.mock("../../../components/portfolio/AddTransactionCard", () => ({
  AddTransactionCard: () => <div data-testid="mock-add-transaction-card" />,
}));

vi.mock("../../../features/portfolio/hooks/useTransactionHistory", () => ({
  useTransactionHistory: () => ({
    data: {
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      aggregates: {
        realizedPnlByCurrency: [],
      },
    },
    errorMessage: "",
    isLoading: false,
    refresh: historyRefreshMock,
  }),
}));

vi.mock("../../../components/transactions/TransactionHistoryBrowser", () => ({
  TransactionHistoryBrowser: () => <div data-testid="mock-transaction-history-browser" />,
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildShellData(capabilities: AppShellData["currentSharedCapabilities"], contextRefreshSignal = 0): AppShellData {
  return {
    uiDict: getDictionary("en"),
    locale: "en",
    sessionUserId: "delegate-user",
    sessionUserRole: "viewer",
    routeCachePolicy: null,
    isSharedContext: true,
    currentSharedCapabilities: capabilities,
    sharedContextPermissions: deriveSharedContextPermissions(capabilities),
    canUseGlobalQuickActions: false,
    openQuickActions: vi.fn(),
    reportingCurrency: "TWD",
    saveReportingCurrency: vi.fn(),
    isReportingCurrencySaving: false,
    reportingCurrencyError: "",
    transactionSubmission: {
      draftTransaction: {},
      setDraftTransaction: vi.fn(),
      setMessage: vi.fn(),
      markUnitPriceEdited: vi.fn(),
      submit: vi.fn(),
      isSubmitting: false,
      priceHint: null,
      showPriceUnavailableHint: false,
      feeEstimate: null,
    } as never,
    mutations: {} as never,
    recomputeAction: {} as never,
    openRecomputeConfirm: vi.fn(),
    transactionAccountOptions: [],
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
    refreshPortfolioConfig: vi.fn(),
    isPortfolioConfigLoading: false,
    integrityIssue: null,
    showIntegrityDialog: false,
    setShowIntegrityDialog: vi.fn(),
    generateSnapshots: vi.fn(),
    isGeneratingSnapshots: false,
    contextRefreshSignal,
  };
}

describe("TransactionsClient shared AI Inbox visibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    historyRefreshMock.mockReset();
    searchParamsValue.value = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("hides AI Inbox for shared delegates without portfolio:mcp_read", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([])}>
          <TransactionsClient initialTab="ai-inbox" />
        </AppShellDataProvider>,
      );
    });

    expect(document.querySelector("[data-testid='transactions-tab-ai-inbox']")).toBeNull();
    expect(document.querySelector("[data-testid='mock-ai-inbox-panel']")).toBeNull();
    expect(document.querySelector("[data-testid='transactions-tab-posted']")).not.toBeNull();
  });

  it("shows AI Inbox for shared delegates with portfolio:mcp_read", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData(["portfolio:mcp_read"])}>
          <TransactionsClient initialTab="ai-inbox" />
        </AppShellDataProvider>,
      );
    });

    expect(document.querySelector("[data-testid='transactions-tab-ai-inbox']")).not.toBeNull();
    expect(document.querySelector("[data-testid='mock-ai-inbox-panel']")).not.toBeNull();
  });

  it("normalizes BUY + realized URLs to SELL with router.replace", () => {
    searchParamsValue.value = "type=BUY&pnl=realized";

    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([])}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    expect(replaceMock).toHaveBeenCalledWith("/transactions?type=SELL&pnl=realized", { scroll: false });
  });

  it("refreshes transaction history when the shell refresh signal changes on the posted tab", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([], 0)}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    expect(refreshMock).not.toHaveBeenCalled();
    expect(historyRefreshMock).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([], 1)}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(historyRefreshMock).toHaveBeenCalledTimes(1);
  });
});
