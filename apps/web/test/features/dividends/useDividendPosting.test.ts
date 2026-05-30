import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { ApiError } from "../../../lib/api";
import {
  useDividendPosting,
} from "../../../features/dividends/hooks/useDividendPosting";
import type { DividendPostingPayload, DividendPostingResult } from "../../../features/dividends/types";

const submitDividendPostingMock = vi.fn<(payload: DividendPostingPayload) => Promise<DividendPostingResult>>();

vi.mock("../../../features/dividends/services/dividendService", () => ({
  submitDividendPosting: (payload: DividendPostingPayload) => submitDividendPostingMock(payload),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const options = {
  versionConflictMessage: "This dividend was updated elsewhere — refresh to see latest.",
  stockEditNotAllowedMessage: "Only cash dividends can be edited in place.",
};

const payload: DividendPostingPayload = {
  dividendEventId: "event-1",
  accountId: "acc-1",
  receivedCashAmount: 120,
  receivedStockQuantity: 0,
  deductions: [],
  sourceCompositionStatus: "provided",
  sourceLines: [
    {
      sourceBucket: "DIVIDEND_INCOME",
      amount: 120,
      currencyCode: "TWD",
      source: "issuer_statement",
    },
  ],
};

let result!: ReturnType<typeof useDividendPosting>;

function Harness() {
  result = useDividendPosting(options);
  return null;
}

describe("useDividendPosting", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    submitDividendPostingMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(createElement(Harness));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("returns the posting result on success", async () => {
    submitDividendPostingMock.mockResolvedValue({
      dividendLedgerEntry: {
        id: "ledger-1",
        accountId: "acc-1",
        dividendEventId: "event-1",
        version: 1,
        reconciliationStatus: "open",
        sourceCompositionStatus: "provided",
      },
    });

    await act(async () => {
      const response = await result.submit(payload);
      expect(response?.dividendLedgerEntry.id).toBe("ledger-1");
    });

    expect(result.errorMessage).toBe("");
    expect(result.isSubmitting).toBe(false);
  });

  it("maps version conflicts to the dedicated message", async () => {
    submitDividendPostingMock.mockRejectedValue(
      new ApiError("conflict", 409, "dividend_version_conflict"),
    );

    await act(async () => {
      const response = await result.submit(payload);
      expect(response).toBeNull();
    });

    expect(result.errorMessage).toBe(options.versionConflictMessage);
    expect(result.isSubmitting).toBe(false);
  });

  it("maps stock edit rejections to the dedicated message", async () => {
    submitDividendPostingMock.mockRejectedValue(
      new ApiError("unsupported", 422, "stock_dividend_in_place_edit_unsupported"),
    );

    await act(async () => {
      const response = await result.submit(payload);
      expect(response).toBeNull();
    });

    expect(result.errorMessage).toBe(options.stockEditNotAllowedMessage);
  });
});
