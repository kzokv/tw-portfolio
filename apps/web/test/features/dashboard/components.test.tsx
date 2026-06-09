import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  DashboardPerformanceDto,
  DashboardOverviewHoldingDto,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import { AllocationSnapshotCard } from "../../../components/dashboard/AllocationSnapshotCard";
import { BiggestMoversCard } from "../../../components/dashboard/BiggestMoversCard";
import { DashboardCommandModules } from "../../../components/dashboard/DashboardClient";
import { DashboardHero } from "../../../components/dashboard/DashboardHero";
import { DashboardHoldingsPreview } from "../../../components/dashboard/DashboardHoldingsPreview";
import { PortfolioTrendCard } from "../../../components/dashboard/PortfolioTrendCard";
import { RecentTransactionsCard } from "../../../components/dashboard/RecentTransactionsCard";
// Phase 5d — SummarySection deleted; the dashboard hero is now a slim
// 2-metric layout (DashboardHero + BiggestMoversCard). Tile-order behavior
// no longer exists; the obsolete test below is also removed.
import { AddTransactionCard } from "../../../components/portfolio/AddTransactionCard";
import { HoldingsTable } from "../../../components/portfolio/HoldingsTable";
import { TransactionHistoryTable } from "../../../components/portfolio/TransactionHistoryTable";
import { buildHoldingGroupsFromHoldings } from "../../../features/portfolio/holdingGroups";
import { getDictionary } from "../../../lib/i18n";

vi.mock("recharts", () => ({
  Cell: () => null,
  Area: () => null,
  Pie: () => null,
  PieChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ComposedChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Legend: () => null,
  Line: () => null,
  LineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ReferenceDot: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const dict = getDictionary("en");

// Phase 5d — `summary` fixture removed alongside SummarySection deletion.

const holdings: DashboardOverviewHoldingDto[] = [
  {
    accountId: "acc-1",
    accountName: "Main Brokerage",
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
    accountName: "Main Brokerage",
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
  } as TransactionHistoryItemDto & { accountName: string },
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

  // Phase 5d — "renders summary cards in the requested order" removed.
  // The 7-tile SummarySection was deleted; the new DashboardHero is a
  // slim 2-card layout (total + day Δ). Hero rendering is covered by
  // the new E2E spec in Phase 5f (commit 5f).

  it("shows reporting currency controls and per-market hero links", () => {
    const groups = buildHoldingGroupsFromHoldings({ holdings })
      .map((group) => ({
        ...group,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        children: group.children.map((child) => ({
          ...child,
          reportingCurrency: "AUD" as const,
          reportingMarketValueAmount: 60_000,
          reportingCostBasisAmount: 58_000,
        })),
      }));

    const html = renderToStaticMarkup(
      <DashboardHero
        fxRates={[{
          fromCurrency: "TWD",
          toCurrency: "AUD",
          rate: 0.049,
          asOf: "2026-06-08",
        }]}
        holdingGroups={groups}
        summary={{
          asOf: "2026-06-08",
          accountCount: 1,
          holdingCount: 1,
          totalCostAmount: 58_000,
          reportingCurrency: "AUD",
          fxStatus: "complete",
          marketValueAmount: 60_000,
          unrealizedPnlAmount: 2_000,
          dailyChangeAmount: 120,
          dailyChangePercent: 0.2,
          upcomingDividendCount: 0,
          upcomingDividendAmount: null,
          openIssueCount: 0,
        }}
        locale="en"
        dict={dict}
        onCurrencyChange={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="dashboard-hero-currency"');
    expect(html).toContain("Current report baseline is AUD");
    expect(html).toContain('data-testid="dashboard-hero-fx-rates"');
    expect(html).toContain("TWD to AUD");
    expect(html).toContain("0.049");
    expect(html).toContain('data-testid="dashboard-hero-market-strip"');
    expect(html).toContain('href="/reports?tab=market&amp;scope=TW&amp;currencyMode=specified&amp;currency=AUD&amp;range=1Y"');
    expect(html).toContain("AUD");
  });

  it("renders dashboard holdings as a compact reporting-currency preview with native price disclosure", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
      })),
    };

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        fxRates={[{
          fromCurrency: "TWD",
          toCurrency: "AUD",
          rate: 0.049,
          asOf: "2026-06-08",
        }]}
        groups={[reportingGroup]}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(html).toContain('data-testid="dashboard-holdings-preview"');
    expect(html).toContain('data-testid="dashboard-holdings-fx-rates"');
    expect(html).toContain("FX used for visible holdings");
    expect(html).toContain("Prices and values below are converted to AUD.");
    expect(html).toContain("TWD to AUD");
    expect(html).toContain("0.049");
    expect(html).toContain("1 visible holding");
    expect(html).toContain("Price (AUD)");
    expect(html).toContain("Market value (AUD)");
    expect(html).toContain('href="/tickers/2330?marketCode=TW"');
    expect(html).toContain("AUD 60K");
    expect(html).toContain("A$30.00");
    expect(html).toContain("Native NT$610");
    expect(html).toContain("Open Portfolio Report");
    expect(html).not.toContain('data-testid="holdings-table"');
  });

  it("prefers explicit server-provided reporting unit prices in dashboard holdings preview", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      reportingCurrentUnitPrice: 30.5,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
      })),
    };

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={[reportingGroup]}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(html).toContain("A$30.50");
    expect(html).not.toContain("A$30.00");
  });

  it("does not relabel stale reporting unit prices from a different currency", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const staleReportingGroup = {
      ...group,
      reportingCurrency: "USD" as const,
      reportingCurrentUnitPrice: 30.5,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "USD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
      })),
    };

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={[staleReportingGroup]}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(html).not.toContain("A$30.50");
    expect(html).not.toContain("A$30.00");
  });

  it("does not render native market values as selected reporting-currency holdings values", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const untranslatedGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingCurrentUnitPrice: null,
      reportingMarketValueAmount: null,
      reportingCostBasisAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingAllocationPercent: null,
      fxStatus: "missing" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingCurrentUnitPrice: null,
        reportingMarketValueAmount: null,
        reportingCostBasisAmount: null,
        reportingUnrealizedPnlAmount: null,
        reportingAllocationPercent: null,
        fxStatus: "missing" as const,
      })),
    };

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={[untranslatedGroup]}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(html).toContain("Missing");
    expect(html).not.toContain("AUD 1.22M");
    expect(html).not.toContain("A$1.22M");
    expect(html).not.toContain("A$610.00");
  });

  it("does not label native holding values as reporting-currency market values", () => {
    const groups = buildHoldingGroupsFromHoldings({ holdings })
      .map((group) => ({
        ...group,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: null,
        reportingCostBasisAmount: null,
        children: group.children.map((child) => ({
          ...child,
          reportingCurrency: "AUD" as const,
          reportingMarketValueAmount: null,
          reportingCostBasisAmount: null,
        })),
      }));

    const html = renderToStaticMarkup(
      <DashboardHero
        holdingGroups={groups}
        summary={{
          asOf: "2026-06-08",
          accountCount: 1,
          holdingCount: 1,
          totalCostAmount: 0,
          reportingCurrency: "AUD",
          fxStatus: "missing",
          marketValueAmount: null,
          unrealizedPnlAmount: null,
          dailyChangeAmount: null,
          dailyChangePercent: null,
          upcomingDividendCount: 0,
          upcomingDividendAmount: null,
          openIssueCount: 0,
        }}
        locale="en"
        dict={dict}
        onCurrencyChange={() => undefined}
      />,
    );

    expect(html).toContain(dict.dashboardHome.noMarketValue);
    expect(html).not.toContain('data-testid="dashboard-hero-market-TW"');
  });

  it("renders the priority command modules without duplicating the old intro panel", () => {
    const groups = buildHoldingGroupsFromHoldings({ holdings });
    const html = renderToStaticMarkup(
      <DashboardCommandModules
        groups={groups}
        locale="en"
        summary={{
          asOf: "2026-06-08",
          accountCount: 1,
          holdingCount: 1,
          totalCostAmount: 58_000,
          reportingCurrency: "AUD",
          fxStatus: "complete",
          marketValueAmount: 60_000,
          unrealizedPnlAmount: 2_000,
          dailyChangeAmount: 120,
          dailyChangePercent: 0.2,
          upcomingDividendCount: 1,
          upcomingDividendAmount: 12,
          openIssueCount: 0,
        }}
      />,
    );

    expect(html).toContain('data-testid="dashboard-command-modules"');
    expect(html).toContain('data-testid="dashboard-command-today"');
    expect(html).toContain('data-testid="dashboard-command-market-pulse"');
    expect(html).toContain('data-testid="dashboard-command-portfolio-health"');
    expect(html).toContain('href="/reports?tab=daily-review&amp;scope=all&amp;currencyMode=specified&amp;currency=AUD&amp;range=1Y"');
    expect(html).not.toContain('data-testid="dashboard-intro"');
  });

  it("renders holdings with a current-price column and history link", () => {
    const html = renderToStaticMarkup(<HoldingsTable holdings={holdings} dict={dict} locale="en" />);

    expect(html).toContain("Price");
    expect(html).toContain("Market Value");
    expect(html).toContain("P&amp;L");
    expect(html).toContain("Total Cost");
    expect(html).toContain("Last Posted");
    expect(html).toContain("href=\"/tickers/2330?marketCode=TW\"");
    expect(html).toContain("href=\"/tickers/2330?marketCode=TW&amp;accountId=acc-1\"");
    expect(html).toContain("NT$610");
    expect(html).toContain("NT$1,220,000");
    expect(html).toContain("NT$1,185,472");
  });

  it("renders unavailable daily change without labeling current quotes as missing", () => {
    const currentWithoutPreviousClose: DashboardOverviewHoldingDto[] = [
      {
        ...holdings[0]!,
        change: null,
        changePercent: null,
        previousClose: null,
        quoteStatus: "current",
      },
    ];

    const html = renderToStaticMarkup(
      <HoldingsTable holdings={currentWithoutPreviousClose} dict={dict} locale="en" />,
    );

    expect(html).toContain('data-testid="holding-group-daily-change-2330-TW"');
    expect(html).not.toContain(dict.dashboardHome.quoteStatusMissing);
  });

  it("uses reporting-currency P&L amounts for grouped and child holding rows", () => {
    const usdHolding: DashboardOverviewHoldingDto = {
      ...holdings[0]!,
      accountId: "acc-us",
      accountName: "US Brokerage",
      ticker: "AAPL",
      quantity: 10,
      costBasisAmount: 1_000,
      currency: "USD",
      averageCostPerShare: 100,
      currentUnitPrice: 120,
      marketValueAmount: 1_200,
      unrealizedPnlAmount: 200,
    };
    const group = buildHoldingGroupsFromHoldings({ holdings: [usdHolding] })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "TWD" as const,
      reportingCostBasisAmount: 32_000,
      reportingMarketValueAmount: 38_400,
      reportingUnrealizedPnlAmount: 6_400,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "TWD" as const,
        reportingCostBasisAmount: 32_000,
        reportingMarketValueAmount: 38_400,
        reportingUnrealizedPnlAmount: 6_400,
      })),
    };

    const html = renderToStaticMarkup(
      <HoldingsTable holdings={[usdHolding]} holdingGroups={[reportingGroup]} dict={dict} locale="en" />,
    );

    expect(html).toContain("NT$6,400");
    expect(html).not.toContain("NT$200");
  });

  it("formats biggest mover daily change in native quote currency", () => {
    const usdHolding: DashboardOverviewHoldingDto = {
      ...holdings[0]!,
      ticker: "AAPL",
      currency: "USD",
      currentUnitPrice: 120,
      change: 2.5,
      changePercent: 2.13,
      quoteStatus: "current",
    };
    const group = buildHoldingGroupsFromHoldings({ holdings: [usdHolding] })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "TWD" as const,
      reportingMarketValueAmount: 3_840,
      reportingUnrealizedPnlAmount: 640,
    };

    const html = renderToStaticMarkup(
      <BiggestMoversCard groups={[reportingGroup]} locale="en" dict={dict} />,
    );

    expect(html).toContain("$2.50");
    expect(html).not.toContain("NT$2.50");
  });

  it("aggregates account counts in compact holdings rows", () => {
    const compactHoldings: DashboardOverviewHoldingDto[] = [
      holdings[0]!,
      {
        ...holdings[0]!,
        accountId: "acc-2",
        accountName: "Retirement Brokerage",
        quantity: 500,
        costBasisAmount: 296_368,
        marketValueAmount: 305_000,
        unrealizedPnlAmount: 8_632,
      },
    ];
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={compactHoldings} dict={dict} locale="en" variant="compact" />,
    );

    expect(html).toContain("Accounts");
    expect(html).toContain("2");
    expect(html).toContain("TWD");
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
    const allocationHtml = renderToStaticMarkup(
      <AllocationSnapshotCard
        groups={buildHoldingGroupsFromHoldings({ holdings })}
        dict={dict}
        locale="en"
        allocationBasis="market_value"
      />,
    );
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
    expect(recentTransactionsHtml).toContain("Main Brokerage");
  });

  it("renders symbol history empty and populated states", () => {
    const emptyHtml = renderToStaticMarkup(<TransactionHistoryTable transactions={[]} dict={dict} locale="en" />);
    expect(emptyHtml).toContain("No historical transactions were found");

    const populatedHtml = renderToStaticMarkup(<TransactionHistoryTable transactions={transactions} dict={dict} locale="en" />);
    expect(populatedHtml).toContain("Default Broker");
    expect(populatedHtml).toContain("Main Brokerage");
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
