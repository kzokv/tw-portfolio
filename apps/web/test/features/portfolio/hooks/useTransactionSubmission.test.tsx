import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionInput } from "../../../../components/portfolio/types";
import { useTransactionSubmission } from "../../../../features/portfolio/hooks/useTransactionSubmission";

vi.mock("../../../../features/portfolio/services/portfolioService", () => ({
  estimateTransaction: vi.fn(),
  fetchMarketDataPrice: vi.fn(),
  fetchSellAvailability: vi.fn(),
  submitTransaction: vi.fn(),
}));

import {
  estimateTransaction,
  fetchMarketDataPrice,
  fetchSellAvailability,
} from "../../../../features/portfolio/services/portfolioService";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const initialValue: TransactionInput = {
  accountId: "acc-tw",
  ticker: "2330",
  marketCode: "TW",
  quantity: 5,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: "2026-07-01",
  type: "SELL",
  isDayTrade: false,
};

let hookValue: ReturnType<typeof useTransactionSubmission>;

function Harness() {
  hookValue = useTransactionSubmission({
    initialValue,
    noAccountsMessage: "no account",
    tickerRequiredMessage: "ticker required",
    successMessage: "ok",
    refresh: async () => undefined,
  });
  return null;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("useTransactionSubmission sell availability", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(fetchMarketDataPrice).mockResolvedValue({
      close: 100,
      date: "2026-07-01",
      source: "test",
      match: "exact",
    });
    vi.mocked(estimateTransaction).mockResolvedValue({
      commissionAmount: 1,
      taxAmount: 1,
    });
    vi.mocked(fetchSellAvailability).mockResolvedValue({
      status: "ready",
      accountId: "acc-tw",
      ticker: "2330",
      marketCode: "TW",
      tradeDate: "2026-07-01",
      availableQuantity: 9,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("enters loading synchronously before the debounce request is sent", async () => {
    await act(async () => {
      root.render(<Harness />);
    });

    expect(hookValue.isSellAvailabilityLoading).toBe(true);
    expect(hookValue.sellAvailability).toBeNull();
    expect(vi.mocked(fetchSellAvailability)).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(399);
    });

    expect(vi.mocked(fetchSellAvailability)).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(vi.mocked(fetchSellAvailability)).toHaveBeenCalledTimes(1);
  });

  it("ignores an out-of-order stale availability response", async () => {
    const first = deferred<Awaited<ReturnType<typeof fetchSellAvailability>>>();
    const second = deferred<Awaited<ReturnType<typeof fetchSellAvailability>>>();
    vi.mocked(fetchSellAvailability)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await act(async () => {
      hookValue.setDraftTransaction((current) => ({ ...current, ticker: "0050" }));
    });

    expect(hookValue.isSellAvailabilityLoading).toBe(true);
    expect(hookValue.sellAvailability).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await act(async () => {
      second.resolve({
        status: "ready",
        accountId: "acc-tw",
        ticker: "0050",
        marketCode: "TW",
        tradeDate: "2026-07-01",
        availableQuantity: 7,
      });
      await Promise.resolve();
    });

    expect(hookValue.sellAvailability).toMatchObject({ ticker: "0050", availableQuantity: 7 });

    await act(async () => {
      first.resolve({
        status: "ready",
        accountId: "acc-tw",
        ticker: "2330",
        marketCode: "TW",
        tradeDate: "2026-07-01",
        availableQuantity: 999,
      });
      await Promise.resolve();
    });

    expect(hookValue.sellAvailability).toMatchObject({ ticker: "0050", availableQuantity: 7 });
  });
});
