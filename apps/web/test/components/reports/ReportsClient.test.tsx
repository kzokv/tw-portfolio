import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DailyReviewReportDto } from "@vakwen/shared-types";
import { ReportsClient } from "../../../components/reports/ReportsClient";
import { parseReportRouteState } from "../../../features/reports/reportState";

const refreshMock = vi.hoisted(() => vi.fn());
const searchParamsMock = vi.hoisted(() => ({ value: "tab=daily-review&scope=all&currencyMode=specified&currency=AUD&range=1Y" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsMock.value),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useAppShellData: () => ({
    locale: "en",
    uiDict: {
      navigation: {
        reportsLabel: "Reports",
        reportsDescription: "Structured reports",
      },
    },
  }),
}));

vi.mock("../../../features/reports/hooks/useReportData", () => ({
  useReportData: ({ initialReport }: { initialReport: DailyReviewReportDto }) => ({
    data: initialReport,
    errorMessage: "",
    isBootstrapping: false,
    isRefreshing: false,
    refresh: refreshMock,
    restoredFromCache: false,
    restoredAt: null,
  }),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const fixture: DailyReviewReportDto = {
  query: {
    scope: "all",
    currencyMode: "specified",
    currency: "AUD",
    reportingCurrency: "AUD",
    nativeCurrency: null,
    range: "1Y",
    asOf: "2026-06-08",
  },
  summary: {
    costBasisAmount: 1000,
    marketValueAmount: 1200,
    unrealizedPnlAmount: 200,
    realizedPnlAmount: 30,
    dailyChangeAmount: 10,
    dailyChangePercent: 0.8,
    incomeAmount: 15,
  },
  fxStatus: {
    status: "complete",
    reportingCurrency: "AUD",
    nativeCurrencies: ["AUD"],
    missingRatePairs: [],
  },
  dataHealth: {
    holdingCount: 1,
    missingQuoteCount: 0,
    provisionalQuoteCount: 0,
    missingFxCount: 0,
    staleQuoteCount: 0,
  },
  suggestions: [{ code: "coverage", severity: "info", title: "Coverage looks complete", detail: "All rows resolved." }],
  topMovers: [],
  holdings: {
    total: 1,
    limit: 25,
    offset: 0,
    rows: [{
      ticker: "BHP",
      marketCode: "AU",
      accountCount: 1,
      quantity: 5,
      reportingCurrency: "AUD",
      reportingCostBasisAmount: 1000,
      reportingMarketValueAmount: 1200,
      reportingUnrealizedPnlAmount: 200,
      reportingAllocationPercent: 100,
      dailyChangeAmount: 10,
      dailyChangePercent: 0.8,
      quoteStatus: "current",
      fxStatus: "complete",
      freshness: "current",
    }],
  },
};

describe("ReportsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    refreshMock.mockReset();
    searchParamsMock.value = "tab=daily-review&scope=all&currencyMode=specified&currency=AUD&range=1Y";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders daily report summary, controls, and mobile detail rows", async () => {
    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.body.textContent).toContain("Reports");
    expect(document.body.textContent).toContain("Daily Review");
    expect(document.body.textContent).toContain("AUD");
    expect(document.body.textContent).toContain("Coverage looks complete");
    expect(document.querySelector("[data-testid='reports-mobile-row-BHP-AU']")).not.toBeNull();
    const sectionRefresh = document.querySelector("[data-testid='reports-today-refresh']");
    expect(sectionRefresh).not.toBeNull();
    act(() => {
      sectionRefresh?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(refreshMock).toHaveBeenCalledWith({ bypassCache: true });
  });

  it("links tickers, colors finance values, and renders optional fx rates", async () => {
    const rateFixture = {
      ...fixture,
      summary: {
        ...fixture.summary,
        unrealizedPnlAmount: -200,
        realizedPnlAmount: -30,
        dailyChangeAmount: -10,
        dailyChangePercent: -0.8,
      },
      fxRates: [
        {
          fromCurrency: "USD",
          toCurrency: "AUD",
          rate: 1.52,
          asOf: "2026-06-08",
        },
      ],
      holdings: {
        ...fixture.holdings,
        rows: [{
          ...fixture.holdings.rows[0]!,
          reportingUnrealizedPnlAmount: -200,
          dailyChangeAmount: -10,
          dailyChangePercent: -0.8,
        }],
      },
    } as DailyReviewReportDto;

    act(() => {
      root.render(<ReportsClient initialReport={rateFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const tickerLinks = Array.from(document.querySelectorAll("a")).map((anchor) => anchor.getAttribute("href"));
    expect(tickerLinks).toContain("/tickers/BHP?marketCode=AU");

    const negativeValue = Array.from(document.querySelectorAll("p, span, h3")).find((node) => node.textContent?.includes("AUD -10"));
    expect(negativeValue?.className).toContain("text-rose-600");

    const fxRates = document.querySelector("[data-testid='reports-fx-rates']");
    expect(fxRates?.textContent).toContain("USD to AUD");
    expect(fxRates?.textContent).toContain("1.52");

    const viewDetailsButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("View details"));
    expect(viewDetailsButton).not.toBeUndefined();
    act(() => {
      viewDetailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Daily change %");
    const detailPercent = Array.from(document.querySelectorAll("span")).find((node) => node.textContent?.includes("-0.8%"));
    expect(detailPercent?.className).toContain("text-rose-600");
  });

  it("does not render a stale daily-review DTO as another report tab", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&currencyMode=specified&currency=AUD&range=1Y";

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-loading-skeleton']")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Performance trend");
  });
});
