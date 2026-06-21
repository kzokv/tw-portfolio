import { act, type AnchorHTMLAttributes } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { TransactionHistoryItemDto } from "@vakwen/shared-types";
import { getDictionary } from "../../../lib/i18n";
import { TransactionHistoryTable } from "../../../components/transactions/TransactionHistoryTable";

const isSmallScreenValue = vi.hoisted(() => ({ value: false }));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../../../lib/hooks/use-small-screen", () => ({
  useIsSmallScreen: () => isSmallScreenValue.value,
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const item: TransactionHistoryItemDto = {
  id: "tx-1",
  accountId: "acc-1",
  accountName: "Main",
  ticker: "MSFT",
  marketCode: "US",
  instrumentType: "STOCK",
  type: "SELL" as const,
  quantity: 10,
  unitPrice: 100,
  priceCurrency: "USD",
  tradeDate: "2026-06-01",
  tradeTimestamp: null,
  bookingSequence: 1,
  commissionAmount: 1,
  taxAmount: 2,
  isDayTrade: false,
  realizedPnlAmount: 25,
  realizedPnlCurrency: "USD",
  realizedPnlBreakdown: null,
  feeProfileId: "fee-1",
  feeProfileName: "Default",
  bookedAt: "2026-06-01",
  feesSource: "CALCULATED" as const,
};

describe("TransactionHistoryTable", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    isSmallScreenValue.value = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders compact mode without the extra full-history columns", () => {
    act(() => {
      root.render(
        <TransactionHistoryTable
          dict={getDictionary("en")}
          items={[item]}
          locale="en"
          mode="compact"
          tableTestId="compact-history"
        />,
      );
    });

    expect(document.querySelector("[data-testid='compact-history']")?.textContent).toContain("MSFT");
    expect(document.querySelector("[data-testid='compact-history']")?.textContent).not.toContain("Commission");
  });

  it("renders full mode with sortable-history columns and account-aware ticker links", () => {
    act(() => {
      root.render(
        <TransactionHistoryTable
          dict={getDictionary("en")}
          items={[item]}
          locale="en"
          mode="full"
          sortBy="tradeDate"
          sortOrder="desc"
          onSort={vi.fn()}
          tableTestId="full-history"
        />,
      );
    });

    expect(document.querySelector("[data-testid='full-history']")?.textContent).toContain("Commission");
    expect(document.querySelector("a")?.getAttribute("href")).toBe("/tickers/MSFT?marketCode=US&accountId=acc-1");
  });
});
