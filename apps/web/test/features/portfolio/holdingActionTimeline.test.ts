import { describe, expect, it } from "vitest";
import { applySplitPreviewToLineItems, buildHoldingActionTimelineItems, buildSplitPreview } from "../../../features/portfolio/holdingActionTimeline";
import type { DividendLedgerEntryDetails } from "../../../features/dividends/types";
import type { TransactionHistoryItemDto } from "@vakwen/shared-types";

describe("buildHoldingActionTimelineItems", () => {
  it("orders stock dividends before later same-day trades when timestamps exist", () => {
    const dividendEntries: DividendLedgerEntryDetails[] = [{
      id: "DLE-1",
      dividendEventId: "DE-1",
      accountId: "acct-a",
      accountName: "Brokerage A",
      ticker: "2330",
      tickerName: "TSMC",
      marketCode: "TW",
      bookedAt: "2026-08-12T09:00:00.000Z",
      instrumentType: "STOCK",
      eventType: "STOCK",
      paymentDate: "2026-08-12",
      exDividendDate: "2026-07-20",
      cashCurrency: "TWD",
      postingStatus: "posted",
      reconciliationStatus: "open",
      sourceCompositionStatus: "unknown_pending_disclosure",
      version: 1,
      expectedCashAmount: 0,
      receivedCashAmount: 0,
      expectedStockQuantity: 300,
      receivedStockQuantity: 300,
      eligibleQuantity: 2000,
      sourceLines: [],
      deductions: [],
    }];
    const transactions: TransactionHistoryItemDto[] = [{
      id: "TRD-1",
      accountId: "acct-a",
      accountName: "Brokerage A",
      ticker: "2330",
      marketCode: "TW",
      priceCurrency: "TWD",
      type: "SELL",
      quantity: 100,
      unitPrice: 1000,
      commissionAmount: 0,
      taxAmount: 0,
      feeProfileName: "Default",
      feeProfileId: "fee-1",
      instrumentType: "STOCK",
      bookingSequence: 1,
      isDayTrade: false,
      feesSource: "CALCULATED",
      tradeDate: "2026-08-12",
      tradeTimestamp: "2026-08-12T13:22:00.000Z",
      bookedAt: "2026-08-12T13:22:00.000Z",
      realizedPnlAmount: 0,
      realizedPnlCurrency: "TWD",
    }];

    const result = buildHoldingActionTimelineItems({ dividendEntries, transactions });

    expect(result.map((item) => item.id)).toEqual(["stock-dividend:DLE-1", "trade:TRD-1"]);
    expect(result[0]).toMatchObject({
      badgeLabel: "stock_dividend",
      linkedDividendId: "DLE-1",
      title: "stock_dividend_posted",
    });
  });

  it("orders position effects before same-day trades when trade timestamps are absent", () => {
    const dividendEntries: DividendLedgerEntryDetails[] = [{
      id: "DLE-1",
      dividendEventId: "DE-1",
      accountId: "acct-a",
      accountName: "Brokerage A",
      ticker: "2330",
      tickerName: "TSMC",
      marketCode: "TW",
      bookedAt: "2026-08-12T09:00:00.000Z",
      instrumentType: "STOCK",
      eventType: "STOCK",
      paymentDate: "2026-08-12",
      exDividendDate: "2026-07-20",
      cashCurrency: "TWD",
      postingStatus: "posted",
      reconciliationStatus: "open",
      sourceCompositionStatus: "unknown_pending_disclosure",
      version: 1,
      expectedCashAmount: 0,
      receivedCashAmount: 0,
      expectedStockQuantity: 300,
      receivedStockQuantity: 300,
      eligibleQuantity: 2000,
      sourceLines: [],
      deductions: [],
    }];
    const transactions: TransactionHistoryItemDto[] = [{
      id: "TRD-1",
      accountId: "acct-a",
      accountName: "Brokerage A",
      ticker: "2330",
      marketCode: "TW",
      priceCurrency: "TWD",
      type: "SELL",
      quantity: 100,
      unitPrice: 1000,
      commissionAmount: 0,
      taxAmount: 0,
      feeProfileName: "Default",
      feeProfileId: "fee-1",
      instrumentType: "STOCK",
      bookingSequence: 1,
      isDayTrade: false,
      feesSource: "CALCULATED",
      tradeDate: "2026-08-12",
      tradeTimestamp: null,
      bookedAt: "2026-08-12T13:22:00.000Z",
      realizedPnlAmount: 0,
      realizedPnlCurrency: "TWD",
    }];

    const result = buildHoldingActionTimelineItems({ dividendEntries, transactions });

    expect(result.map((item) => item.id)).toEqual(["stock-dividend:DLE-1", "trade:TRD-1"]);
    expect(result[1]?.timeLabel).toBeNull();
  });
});

describe("buildSplitPreview", () => {
  it("blocks reverse-split posting until cash-in-lieu is provided for fractional shares", () => {
    const result = buildSplitPreview({
      costBasis: 100000,
      currentQuantity: 2300,
      numerator: 1,
      denominator: 3,
      cashInLieuAmount: null,
    });

    expect(result.afterQuantity).toBe(766);
    expect(result.fractionalQuantity).toBeCloseTo(0.666667, 6);
    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("fractional_cash_in_lieu_required");
  });

  it("floors retained shares when cash-in-lieu is supplied for fractional shares", () => {
    const result = buildSplitPreview({
      costBasis: 500,
      currentQuantity: 5,
      numerator: 1,
      denominator: 2,
      cashInLieuAmount: 25,
    });

    expect(result.afterQuantity).toBe(2);
    expect(result.fractionalQuantity).toBe(0.5);
    expect(result.averageCost).toBe(250);
    expect(result.blocked).toBe(false);
  });

  it("blocks reducing split previews without cash-in-lieu because aggregate quantity can hide lot-level fractions", () => {
    const result = buildSplitPreview({
      costBasis: 200,
      currentQuantity: 2,
      numerator: 1,
      denominator: 2,
      cashInLieuAmount: null,
    });

    expect(result.afterQuantity).toBe(1);
    expect(result.fractionalQuantity).toBe(0);
    expect(result.blocked).toBe(true);
    expect(result.blockingReason).toBe("fractional_cash_in_lieu_required");
  });

  it("allows reducing split previews when cash-in-lieu is supplied for possible lot-level fractions", () => {
    const result = buildSplitPreview({
      costBasis: 200,
      currentQuantity: 2,
      numerator: 1,
      denominator: 2,
      cashInLieuAmount: 50,
    });

    expect(result.afterQuantity).toBe(1);
    expect(result.fractionalQuantity).toBe(0);
    expect(result.blocked).toBe(false);
  });

  it("updates per-account preview rows with the split ratio", () => {
    const rows = applySplitPreviewToLineItems([
      { accountId: "acct-a", accountLabel: "A", beforeQuantity: 2000, afterQuantity: 2000, fractionalQuantity: 0 },
      { accountId: "acct-b", accountLabel: "B", beforeQuantity: 300, afterQuantity: 300, fractionalQuantity: 0 },
    ], 1, 3);

    expect(rows).toEqual([
      { accountId: "acct-a", accountLabel: "A", beforeQuantity: 2000, afterQuantity: 666, fractionalQuantity: 0.666667 },
      { accountId: "acct-b", accountLabel: "B", beforeQuantity: 300, afterQuantity: 100, fractionalQuantity: 0 },
    ]);
  });
});
