import { describe, expect, it } from "vitest";
import { buildDividendCalendarRowFromEntry } from "../../../components/dividends/DividendReviewDrawer";
import type { DividendLedgerEntryDetails } from "../../../features/dividends/types";

function buildEntry(overrides: Partial<DividendLedgerEntryDetails> = {}): DividendLedgerEntryDetails {
  return {
    id: "ledger-1",
    dividendEventId: "event-1",
    accountId: "acc-1",
    accountName: "Main",
    ticker: "2330",
    tickerName: "TSMC",
    marketCode: "TW",
    instrumentType: "STOCK",
    eventType: "STOCK",
    paymentDate: "2026-08-01",
    exDividendDate: "2026-07-01",
    cashCurrency: "TWD",
    postingStatus: "posted",
    reconciliationStatus: "open",
    sourceCompositionStatus: "provided",
    version: 1,
    expectedCashAmount: 0,
    receivedCashAmount: 0,
    expectedStockQuantity: 100,
    receivedStockQuantity: 100,
    eligibleQuantity: 1_000,
    sourceLines: [],
    deductions: [],
    ...overrides,
  };
}

describe("buildDividendCalendarRowFromEntry", () => {
  it("maps the authoritative expected stock par value into the posting form row", () => {
    const row = buildDividendCalendarRowFromEntry(buildEntry({
      expectedStockParValueAmount: 10,
      parValueAmount: null,
    }));

    expect(row.event.parValuePerShare).toBe(10);
  });

  it("maps materialized expected ledger rows to a new posting", () => {
    const row = buildDividendCalendarRowFromEntry(buildEntry({
      rowKind: "ledger",
      postingStatus: "expected",
    }));

    expect(row.event.hasPostedLedgerEntry).toBe(false);
    expect(row.event.dividendLedgerEntryId).toBeNull();
    expect(row.ledgerEntry).toBeNull();
  });

  it("preserves unavailable expected stock quantity instead of coercing it to zero", () => {
    const row = buildDividendCalendarRowFromEntry(buildEntry({
      expectedStockQuantity: null,
      expectedStockCalcState: "needs_action",
      stockDistributionRatioState: "unresolved",
    }));

    expect(row.event.expectedStockQuantity).toBeNull();
  });
});
