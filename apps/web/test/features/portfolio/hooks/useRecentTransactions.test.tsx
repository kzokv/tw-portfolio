import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionHistoryItemDto } from "@vakwen/shared-types";
import { useRecentTransactions } from "../../../../features/portfolio/hooks/useRecentTransactions";

vi.mock("../../../../features/portfolio/services/portfolioService", () => ({
  fetchTransactionHistory: vi.fn(),
}));

import { fetchTransactionHistory } from "../../../../features/portfolio/services/portfolioService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let result: ReturnType<typeof useRecentTransactions>;

const recentItem: TransactionHistoryItemDto = {
  id: "trade-1",
  accountId: "acc-1",
  accountName: "Main",
  ticker: "2330",
  marketCode: "TW",
  instrumentType: "STOCK",
  type: "BUY",
  quantity: 10,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: "2026-06-02",
  tradeTimestamp: null,
  bookingSequence: null,
  commissionAmount: 20,
  taxAmount: 0,
  isDayTrade: false,
  realizedPnlAmount: null,
  realizedPnlCurrency: null,
  feeProfileId: "fee-1",
  feeProfileName: "Default",
  bookedAt: "2026-06-02T09:00:00.000Z",
  feesSource: "CALCULATED",
};

function Harness({ initialItems = null }: { initialItems?: TransactionHistoryItemDto[] | null }) {
  result = useRecentTransactions({
    limit: 12,
    enabled: true,
    initialItems,
  });
  return null;
}

describe("useRecentTransactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(fetchTransactionHistory).mockReset();
  });

  it("hydrates from server-provided recent transactions without an initial fetch", async () => {
    act(() => {
      root.render(<Harness initialItems={[recentItem]} />);
    });

    await act(async () => {});

    expect(result.isLoading).toBe(false);
    expect(result.items).toEqual([recentItem]);
    expect(fetchTransactionHistory).not.toHaveBeenCalled();
  });

  it("fetches recent transactions when no initial payload is provided", async () => {
    vi.mocked(fetchTransactionHistory).mockResolvedValue([recentItem]);

    act(() => {
      root.render(<Harness />);
    });

    await act(async () => {});

    expect(fetchTransactionHistory).toHaveBeenCalledWith({ limit: 12 });
    expect(result.isLoading).toBe(false);
    expect(result.items).toEqual([recentItem]);
  });
});
