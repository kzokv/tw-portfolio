import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  DashboardOverviewHoldingDto,
  DashboardOverviewSummaryDto,
  SymbolOptionDto,
  TransactionHistoryItemDto,
} from "@tw-portfolio/shared-types";
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
  totalCostCurrency: "TWD",
  marketValueAmount: 1_260_000,
  unrealizedPnlAmount: 60_000,
  upcomingDividendCount: 2,
  upcomingDividendAmount: 3_500,
  openIssueCount: 0,
};

const holdings: DashboardOverviewHoldingDto[] = [
  {
    accountId: "acc-1",
    symbol: "2330",
    quantity: 2_000,
    costBasisAmount: 1_185_472,
    currency: "TWD",
    averageCostPerShare: 593,
    currentUnitPrice: 610,
    marketValueAmount: 1_220_000,
    unrealizedPnlAmount: 34_528,
    allocationPct: 98.2,
    nextDividendDate: null,
    lastDividendPostedDate: "2026-02-20",
  },
];

const transactions: TransactionHistoryItemDto[] = [
  {
    id: "tx-1",
    accountId: "acc-1",
    symbol: "2330",
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
  },
];

const symbolOptions: SymbolOptionDto[] = [
  {
    ticker: "2330",
    instrumentType: "STOCK",
    marketCode: "TW",
    isProvisional: false,
  },
  {
    ticker: "0050",
    instrumentType: "ETF",
    marketCode: "TW",
    isProvisional: false,
  },
  {
    ticker: "00919",
    instrumentType: "ETF",
    marketCode: "TW",
    isProvisional: false,
  },
  {
    ticker: "0056",
    instrumentType: "ETF",
    marketCode: "TW",
    isProvisional: false,
  },
];

describe("dashboard components", () => {
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
    expect(html).toContain("href=\"/symbols/2330?accountId=acc-1\"");
    expect(html).toContain("NT$610");
  });

  it("renders symbol history empty and populated states", () => {
    const emptyHtml = renderToStaticMarkup(<TransactionHistoryTable transactions={[]} dict={dict} locale="en" />);
    expect(emptyHtml).toContain("No historical transactions were found");

    const populatedHtml = renderToStaticMarkup(<TransactionHistoryTable transactions={transactions} dict={dict} locale="en" />);
    expect(populatedHtml).toContain("Default Broker");
    expect(populatedHtml).toContain("Realized P&amp;L");
    expect(populatedHtml).toContain("SELL");
  });

  it("renders the predefined symbol select in the transaction form", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={{
          accountId: "acc-1",
          symbol: "0050",
          quantity: 1,
          unitPrice: 100,
          priceCurrency: "TWD",
          tradeDate: "2026-03-13",
          type: "BUY",
          isDayTrade: false,
        }}
        accountOptions={[{ id: "acc-1", name: "Primary" }]}
        symbolOptions={symbolOptions}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        framed={false}
      />,
    );

    expect(html).toContain("data-testid=\"tx-symbol-select\"");
    expect(html).toContain("2330 (Stock)");
    expect(html).toContain("0050 (ETF)");
    expect(html).toContain("00919 (ETF)");
    expect(html).toContain("0056 (ETF)");
    expect(html).toContain("Choose one of the supported Taiwan symbols.");
  });
});
