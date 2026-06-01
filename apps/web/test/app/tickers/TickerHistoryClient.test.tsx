import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type {
  AccountDto,
  FeeProfileDto,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import { TickerHistoryClient } from "../../../app/tickers/[ticker]/TickerHistoryClient";
import type { TickerDetailsModel } from "../../../features/portfolio/services/tickerDetailsService";
import { getDictionary } from "../../../lib/i18n";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("recharts", () => ({
  Line: () => null,
  LineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

if (typeof globalThis.IntersectionObserver === "undefined") {
  class StubIntersectionObserver {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  }
  Object.assign(globalThis, { IntersectionObserver: StubIntersectionObserver });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
  }
  root = null;
  container?.remove();
  container = null;
});

const dict = getDictionary("en");

const accounts: AccountDto[] = [
  {
    id: "acc-1",
    userId: "user-1",
    name: "Main Brokerage",
    feeProfileId: "fp-1",
    defaultCurrency: "TWD",
    accountType: "broker",
  },
  {
    id: "acc-2",
    userId: "user-1",
    name: "Scope Brokerage",
    feeProfileId: "fp-2",
    defaultCurrency: "TWD",
    accountType: "broker",
  },
];

const feeProfiles: FeeProfileDto[] = accounts.map((account) => ({
  id: account.feeProfileId,
  accountId: account.id,
  name: `${account.name} Default`,
  boardCommissionRate: 0,
  commissionDiscountPercent: 0,
  minimumCommissionAmount: 0,
  commissionCurrency: account.defaultCurrency,
  commissionRoundingMode: "FLOOR",
  taxRoundingMode: "FLOOR",
  stockSellTaxRateBps: 0,
  stockDayTradeTaxRateBps: 0,
  etfSellTaxRateBps: 0,
  bondEtfSellTaxRateBps: 0,
  commissionChargeMode: "CHARGED_UPFRONT",
}));

const transactions: TransactionHistoryItemDto[] = [
  {
    id: "tx-1",
    accountId: "acc-2",
    accountName: "Scope Brokerage",
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2026-01-02",
    tradeTimestamp: "2026-01-02T00:00:00.000Z",
    bookingSequence: 1,
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    realizedPnlAmount: null,
    realizedPnlCurrency: null,
    feeProfileId: "fp-2",
    feeProfileName: "Scope Brokerage Default",
    bookedAt: "2026-01-02T00:00:00.000Z",
    feesSource: "CALCULATED",
  },
];

const details: TickerDetailsModel = {
  identity: {
    ticker: "2330",
    name: "TSMC",
    marketCode: "TW",
    instrumentType: "STOCK",
    currency: "TWD",
  },
  quote: {
    currentPrice: 110,
    previousClose: 109,
    changeAmount: 1,
    changePercent: 0.92,
    quoteStatus: "current",
    freshness: "current",
    freshnessTooltip: null,
  },
  position: {
    accountScope: "acc-2",
    quantity: 10,
    averageCost: 100,
    costBasis: 1000,
    marketValue: 1100,
    unrealizedPnl: 100,
    realizedPnl: 0,
    transactionsCount: 1,
    nextDividendDate: null,
    lastDividendPostedDate: null,
  },
  chart: { points: [] },
  stats: [],
  dividends: {
    upcomingCount: 0,
    nextPaymentDate: null,
    lastPostedDate: null,
  },
  fundamentals: { panels: [] },
};

describe("TickerHistoryClient", () => {
  it("renders scoped account names instead of account ids in summary panels", () => {
    const element = mount(
      <TickerHistoryClient
        transactions={transactions}
        dict={dict}
        locale="en"
        ticker="2330"
        accountId="acc-2"
        accounts={accounts}
        feeProfiles={feeProfiles}
        feeProfileBindings={[]}
        instrument={{
          ticker: "2330",
          name: "TSMC",
          instrumentType: "STOCK",
          sector: null,
          marketCode: "TW",
          barsBackfillStatus: "complete",
          lastRepairAt: null,
          repairAvailableAt: null,
          gicsIndustryGroup: null,
        }}
        details={details}
        isDemo={false}
        transactionAccountFilter="acc-2"
        holdingGroup={null}
      />,
    );

    const quantityCard = element.querySelector('[data-testid="ticker-history-quantity"]');
    const totalCostCard = element.querySelector('[data-testid="ticker-history-total-cost"]');
    expect(quantityCard?.textContent).toContain("Scope Brokerage");
    expect(quantityCard?.textContent).not.toContain("acc-2");
    expect(totalCostCard?.textContent).toContain("Scope Brokerage");
    expect(totalCostCard?.textContent).not.toContain("acc-2");
  });
});
