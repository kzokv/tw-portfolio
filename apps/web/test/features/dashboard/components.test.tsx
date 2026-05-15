import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  DashboardPerformanceDto,
  DashboardOverviewHoldingDto,
  DashboardOverviewSummaryDto,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import { AllocationSnapshotCard } from "../../../components/dashboard/AllocationSnapshotCard";
import { PortfolioTrendCard } from "../../../components/dashboard/PortfolioTrendCard";
import { RecentTransactionsCard } from "../../../components/dashboard/RecentTransactionsCard";
import { SummarySection } from "../../../components/dashboard/SummarySection";
import { AddTransactionCard } from "../../../components/portfolio/AddTransactionCard";
import { HoldingsTable } from "../../../components/portfolio/HoldingsTable";
import { TransactionHistoryTable } from "../../../components/portfolio/TransactionHistoryTable";
import { getDictionary } from "../../../lib/i18n";

const dict = getDictionary("en");

const summary: DashboardOverviewSummaryDto = {
  asOf: "2026-03-13T00:00:00.000Z",
  accountCount: 3,
  holdingCount: 7,
  totalCostAmount: 1_200_000,
  // KZO-180: reportingCurrency replaces broken-by-design totalCostCurrency.
  reportingCurrency: "TWD",
  fxStatus: "complete",
  marketValueAmount: 1_260_000,
  unrealizedPnlAmount: 60_000,
  dailyChangeAmount: 1_200,
  dailyChangePercent: 0.0952,
  upcomingDividendCount: 2,
  upcomingDividendAmount: 3_500,
  openIssueCount: 0,
};

const holdings: DashboardOverviewHoldingDto[] = [
  {
    accountId: "acc-1",
    ticker: "2330",
    quantity: 2_000,
    costBasisAmount: 1_185_472,
    currency: "TWD",
    averageCostPerShare: 593,
    currentUnitPrice: 610,
    marketValueAmount: 1_220_000,
    unrealizedPnlAmount: 34_528,
    allocationPct: 98.2,
    change: 5,
    changePercent: 0.82,
    previousClose: 605,
    quoteStatus: "current",
    nextDividendDate: null,
    lastDividendPostedDate: "2026-02-20",
    freshness: "current",
    freshnessTooltip: null,
  },
];

const transactions: TransactionHistoryItemDto[] = [
  {
    id: "tx-1",
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "SELL",
    quantity: 500,
    unitPrice: 650,
    priceCurrency: "TWD",
    tradeDate: "2026-03-12",
    tradeTimestamp: "2026-03-12T01:00:00.000Z",
    bookingSequence: 2,
    commissionAmount: 20,
    taxAmount: 975,
    isDayTrade: false,
    realizedPnlAmount: 12_000,
    realizedPnlCurrency: "TWD",
    feeProfileId: "fp-default",
    feeProfileName: "Default Broker",
    bookedAt: "2026-03-12T08:00:00.000Z",
    feesSource: "CALCULATED",
  },
];

const performance: DashboardPerformanceDto = {
  range: "1M",
  // KZO-180: response-level reporting currency + fxStatus rollup.
  reportingCurrency: "TWD",
  fxStatus: "complete",
  points: [
    {
      date: "2026-03-01",
      totalCostAmount: 1_200_000,
      marketValueAmount: 1_210_000,
      unrealizedPnlAmount: 10_000,
      cumulativeRealizedPnlAmount: 0,
      cumulativeDividendsAmount: 0,
      fxAvailable: true,
    },
    {
      date: "2026-03-13",
      totalCostAmount: 1_200_000,
      marketValueAmount: 1_260_000,
      unrealizedPnlAmount: 60_000,
      cumulativeRealizedPnlAmount: 0,
      cumulativeDividendsAmount: 0,
      fxAvailable: true,
    },
  ],
};

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function input(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (!setter) {
    throw new Error("HTMLInputElement.value setter is unavailable");
  }
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("dashboard components", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
  });

  it("renders summary cards in the requested order", () => {
    const html = renderToStaticMarkup(<SummarySection summary={summary} dict={dict} locale="en" />);

    expect(html.indexOf("Market Value")).toBeLessThan(html.indexOf("Unrealized P&amp;L"));
    expect(html.indexOf("Unrealized P&amp;L")).toBeLessThan(html.indexOf("Upcoming Dividends"));
    expect(html.indexOf("Upcoming Dividends")).toBeLessThan(html.indexOf("Total Cost"));
    expect(html.indexOf("Total Cost")).toBeLessThan(html.indexOf("Open Positions"));
    expect(html.indexOf("Open Positions")).toBeLessThan(html.indexOf("Accounts"));
  });

  it("renders holdings with a current-price column and history link", () => {
    const html = renderToStaticMarkup(<HoldingsTable holdings={holdings} dict={dict} locale="en" />);

    expect(html).toContain("Current Price");
    expect(html).toContain("Market Value");
    expect(html).toContain("Unrealized P&amp;L");
    expect(html).toContain("href=\"/tickers/2330?accountId=acc-1\"");
    expect(html).toContain("NT$610");
  });

  it("renders freshness badge for stale_amber holdings when showFreshnessBadge=true", () => {
    const stale: DashboardOverviewHoldingDto[] = [
      { ...holdings[0]!, freshness: "stale_amber", freshnessTooltip: "Last quote 3 days ago" },
    ];
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={stale} dict={dict} locale="en" showFreshnessBadge={true} />,
    );

    expect(html).toContain("holdings-freshness-badge-acc-1-2330");
    expect(html).toMatch(/bg-amber-500/);
  });

  it("renders freshness badge for stale_red holdings", () => {
    const stale: DashboardOverviewHoldingDto[] = [
      { ...holdings[0]!, freshness: "stale_red", freshnessTooltip: "Last quote 14 days ago" },
    ];
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={stale} dict={dict} locale="en" showFreshnessBadge={true} />,
    );

    expect(html).toContain("holdings-freshness-badge-acc-1-2330");
    expect(html).toMatch(/bg-rose-500/);
  });

  it("does not render freshness badge when showFreshnessBadge=false", () => {
    const stale: DashboardOverviewHoldingDto[] = [
      { ...holdings[0]!, freshness: "stale_amber", freshnessTooltip: "Stale" },
    ];
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={stale} dict={dict} locale="en" showFreshnessBadge={false} />,
    );

    expect(html).not.toContain("holdings-freshness-badge-");
  });

  it("does not render freshness badge when freshness=current", () => {
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={holdings} dict={dict} locale="en" showFreshnessBadge={true} />,
    );

    expect(html).not.toContain("holdings-freshness-badge-");
  });

  it("renders performance range controls and chart legend", () => {
    const html = renderToStaticMarkup(
      <PortfolioTrendCard
        data={performance}
        range="1M"
        currency="TWD"
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
        onRangeChange={() => undefined}
      />,
    );

    expect(html).toContain("Portfolio Trend");
    expect(html).toContain("dashboard-performance-range-1m");
    expect(html).toContain("Market Value");
    expect(html).toContain("Total Cost");
  });

  it("renders allocation snapshot legend and recent transactions card", () => {
    const allocationHtml = renderToStaticMarkup(<AllocationSnapshotCard holdings={holdings} dict={dict} locale="en" />);
    expect(allocationHtml).toContain("Allocation Snapshot");
    expect(allocationHtml).toContain("2330");

    const recentTransactionsHtml = renderToStaticMarkup(
      <RecentTransactionsCard
        items={transactions}
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
      />,
    );
    expect(recentTransactionsHtml).toContain("Recent Transactions");
    expect(recentTransactionsHtml).toContain("href=\"/tickers/2330?accountId=acc-1\"");
  });

  it("renders symbol history empty and populated states", () => {
    const emptyHtml = renderToStaticMarkup(<TransactionHistoryTable transactions={[]} dict={dict} locale="en" />);
    expect(emptyHtml).toContain("No historical transactions were found");

    const populatedHtml = renderToStaticMarkup(<TransactionHistoryTable transactions={transactions} dict={dict} locale="en" />);
    expect(populatedHtml).toContain("Default Broker");
    expect(populatedHtml).toContain("Realized P&amp;L");
    expect(populatedHtml).toContain("SELL");
  });

  it("renders the instrument combobox in the transaction form", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={{
          accountId: "acc-1",
          ticker: "0050",
          // KZO-169: TransactionInput now carries marketCode (TW for legacy
          // 0050 fixture). null = "All" mode (chip-derived).
          marketCode: "TW",
          quantity: 1,
          unitPrice: 100,
          priceCurrency: "TWD",
          tradeDate: "2026-03-13",
          type: "BUY",
          isDayTrade: false,
        }}
        accountOptions={[{
          id: "acc-1",
          name: "Primary",
          feeProfileName: "Default Broker",
          // KZO-169: defaultCurrency drives chip default + dropdown filter.
          defaultCurrency: "TWD",
          accountType: "broker",
        }]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );

    expect(html).toContain("data-testid=\"tx-ticker-combobox\"");
    expect(html).toContain("placeholder=\"Search by ticker or name...\"");
    expect(html).toContain("value=\"0050\"");
    expect(html).toContain("Primary — Default Broker");
    expect(html).not.toContain("data-testid=\"tx-ticker-select\"");
  });

  it("marks manual unit-price edits only from the unit-price input handler", () => {
    const onChange = vi.fn();
    const onUnitPriceEdited = vi.fn();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <AddTransactionCard
          value={{
            accountId: "acc-1",
            ticker: "0050",
            // KZO-169: marketCode required field; TWD account ⇒ TW.
            marketCode: "TW",
            quantity: 1,
            unitPrice: 100,
            priceCurrency: "TWD",
            tradeDate: "2026-03-13",
            type: "BUY",
            isDayTrade: false,
          }}
          accountOptions={[{
            id: "acc-1",
            name: "Primary",
            feeProfileName: "Default Broker",
            defaultCurrency: "TWD",
            accountType: "broker",
          }]}
          pending={false}
          onChange={onChange}
          onUnitPriceEdited={onUnitPriceEdited}
          onSubmit={async () => undefined}
          dict={dict}
          locale="en"
          framed={false}
          priceHint={null}
          showPriceUnavailableHint={false}
          feeEstimate={null}
        />,
      );
    });

    const quantityInput = container.querySelector('[data-testid="tx-quantity-input"]') as HTMLInputElement | null;
    const unitPriceInput = container.querySelector('[data-testid="unit-price-input"]') as HTMLInputElement | null;

    expect(quantityInput).not.toBeNull();
    expect(unitPriceInput).not.toBeNull();

    input(quantityInput!, "2");
    expect(onUnitPriceEdited).not.toHaveBeenCalled();

    input(unitPriceInput!, "101");
    expect(onUnitPriceEdited).toHaveBeenCalledTimes(1);
  });
});
