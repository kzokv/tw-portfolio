import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealizedPnlBreakdownDto, TransactionHistoryItemDto } from "@vakwen/shared-types";
import { RecentTransactionsCard } from "../../../components/dashboard/RecentTransactionsCard";
import { TransactionHistoryTable } from "../../../components/portfolio/TransactionHistoryTable";
import { getDictionary } from "../../../lib/i18n";

let isSmallScreen = false;

vi.mock("../../../lib/hooks/use-small-screen", () => ({
  useIsSmallScreen: () => isSmallScreen,
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

const availableBreakdown: RealizedPnlBreakdownDto = {
  status: "available",
  currency: "TWD",
  preSaleOpenQuantity: 6_000,
  preSaleOpenCostAmount: 447_957,
  exactAverageCostPerShare: 74.6595,
  roundedAverageCostPerShare: 74.66,
  allocatedCostAmount: 373_300,
  grossProceedsAmount: 392_500,
  commissionAmount: 139,
  taxAmount: 1_177,
  netProceedsAmount: 391_184,
  realizedPnlAmount: 17_884,
};

function buildTransaction(overrides: Partial<TransactionHistoryItemDto> = {}): TransactionHistoryItemDto {
  return {
    id: "tx-1",
    accountId: "acc-1",
    accountName: "Main Brokerage",
    ticker: "6910",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "SELL",
    quantity: 5_000,
    unitPrice: 78.5,
    priceCurrency: "TWD",
    tradeDate: "2026-06-20",
    tradeTimestamp: "2026-06-20T01:00:00.000Z",
    bookingSequence: 2,
    commissionAmount: 139,
    taxAmount: 1_177,
    bookedCostAmount: 374_616,
    isDayTrade: false,
    realizedPnlAmount: 17_884,
    realizedPnlCurrency: "TWD",
    realizedPnlBreakdown: availableBreakdown,
    feeProfileId: "fp-1",
    feeProfileName: "Default Broker",
    bookedAt: "2026-06-20T02:00:00.000Z",
    feesSource: "MANUAL",
    ...overrides,
  };
}

function renderNode(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

describe("Realized P&L breakdown UI", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    isSmallScreen = false;
  });

  afterEach(() => {
    if (root) {
      act(() => root!.unmount());
    }
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = "";
  });

  it("renders a SELL desktop trigger with backend-provided math", async () => {
    ({ container, root } = renderNode(
      <TransactionHistoryTable transactions={[buildTransaction()]} dict={dict} locale="en" />,
    ));

    const trigger = container.querySelector("[data-testid='realized-pnl-breakdown-trigger']") as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(container.textContent).toContain("weighted-average cost basis");

    await act(async () => {
      trigger?.click();
    });

    expect(document.body.textContent).toContain("Realized P&L math");
    expect(document.body.textContent).toContain("Pre-sale open cost");
    expect(document.body.textContent).toContain("NT$391,184 - NT$373,300 = NT$17,884");
  });

  it("does not render a breakdown trigger for BUY rows", () => {
    ({ container, root } = renderNode(
      <TransactionHistoryTable
        transactions={[buildTransaction({
          type: "BUY",
          realizedPnlAmount: null,
          realizedPnlCurrency: null,
          realizedPnlBreakdown: null,
        })]}
        dict={dict}
        locale="en"
      />,
    ));

    expect(container.querySelector("[data-testid='realized-pnl-breakdown-trigger']")).toBeNull();
  });

  it("renders mobile inline unavailable details", () => {
    isSmallScreen = true;
    ({ container, root } = renderNode(
      <TransactionHistoryTable
        transactions={[buildTransaction({
          realizedPnlBreakdown: {
            status: "unavailable",
            currency: "TWD",
            reason: "insufficient_quantity",
          },
        })]}
        dict={dict}
        locale="en"
      />,
    ));

    expect(container.querySelector("[data-testid='realized-pnl-breakdown-inline']")).not.toBeNull();
    expect(container.textContent).toContain("Breakdown unavailable");
    expect(container.textContent).toContain("does not have enough pre-sale quantity");
  });

  it("renders booked cost for BUY rows and leaves SELL-only realized P&L unavailable on mobile", () => {
    isSmallScreen = true;
    ({ container, root } = renderNode(
      <TransactionHistoryTable
        transactions={[buildTransaction({
          type: "BUY",
          bookedCostAmount: 12_345,
          realizedPnlAmount: null,
          realizedPnlCurrency: null,
          realizedPnlBreakdown: null,
        })]}
        dict={dict}
        locale="en"
      />,
    ));

    expect(container.textContent).toContain(dict.tickerHistory.bookedCostLabel);
    expect(container.textContent).toContain("NT$12,345");
    expect(container.textContent).toContain(dict.tickerHistory.noRealizedPnl);
  });

  it("renders em-dash booked cost for SELL rows without booked cost on desktop", () => {
    ({ container, root } = renderNode(
      <TransactionHistoryTable
        transactions={[buildTransaction({ bookedCostAmount: null })]}
        dict={dict}
        locale="en"
      />,
    ));

    const table = container.querySelector("[data-testid='ticker-history-table']");
    expect(table?.textContent).toContain(dict.tickerHistory.bookedCostLabel);
    expect(table?.textContent).toContain(dict.tickerHistory.noRealizedPnl);
  });

  it("keeps dashboard recent transactions compact while /transactions shows the table note", () => {
    ({ container, root } = renderNode(
      <RecentTransactionsCard
        items={[buildTransaction()]}
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
      />,
    ));

    expect(container.textContent).not.toContain("weighted-average cost basis");
    act(() => root!.unmount());
    container.remove();

    ({ container, root } = renderNode(
      <RecentTransactionsCard
        items={[buildTransaction()]}
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
        variant="primary"
      />,
    ));

    expect(container.textContent).toContain("weighted-average cost basis");
  });
});
