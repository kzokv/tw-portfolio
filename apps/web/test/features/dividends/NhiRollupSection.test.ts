import { describe, expect, it } from "vitest";
import { aggregateEtfSourceLines } from "../../../features/dividends/components/NhiRollupSection";
import type { DividendLedgerEntryDetails } from "../../../features/dividends/types";

function buildEntry(overrides: Partial<DividendLedgerEntryDetails>): DividendLedgerEntryDetails {
  return {
    id: overrides.id ?? "ledger-1",
    dividendEventId: overrides.dividendEventId ?? "event-1",
    accountId: overrides.accountId ?? "acc-1",
    ticker: overrides.ticker ?? "0050",
    marketCode: overrides.marketCode ?? "TW",
    instrumentType: overrides.instrumentType ?? "ETF",
    eventType: overrides.eventType ?? "CASH",
    paymentDate: overrides.paymentDate ?? "2026-04-20",
    exDividendDate: overrides.exDividendDate ?? "2026-04-10",
    cashCurrency: overrides.cashCurrency ?? "TWD",
    postingStatus: overrides.postingStatus ?? "posted",
    reconciliationStatus: overrides.reconciliationStatus ?? "open",
    sourceCompositionStatus: overrides.sourceCompositionStatus ?? "provided",
    version: overrides.version ?? 1,
    reconciliationNote: overrides.reconciliationNote ?? null,
    expectedCashAmount: overrides.expectedCashAmount ?? 100,
    receivedCashAmount: overrides.receivedCashAmount ?? 100,
    expectedStockQuantity: overrides.expectedStockQuantity ?? 0,
    receivedStockQuantity: overrides.receivedStockQuantity ?? 0,
    eligibleQuantity: overrides.eligibleQuantity ?? 1_000,
    sourceLines: overrides.sourceLines ?? [],
    deductions: overrides.deductions ?? [],
  };
}

describe("aggregateEtfSourceLines", () => {
  it("returns correct bucket totals across multiple ETF entries", () => {
    const entries: DividendLedgerEntryDetails[] = [
      buildEntry({
        id: "l1",
        instrumentType: "ETF",
        sourceCompositionStatus: "provided",
        sourceLines: [
          { id: "s1", dividendLedgerEntryId: "l1", sourceBucket: "DIVIDEND_INCOME", amount: 900, currencyCode: "TWD", source: "issuer" },
          { id: "s2", dividendLedgerEntryId: "l1", sourceBucket: "INTEREST_INCOME", amount: 300, currencyCode: "TWD", source: "issuer" },
          { id: "s3", dividendLedgerEntryId: "l1", sourceBucket: "CAPITAL_RETURN", amount: 100, currencyCode: "TWD", source: "issuer" },
        ],
      }),
      buildEntry({
        id: "l2",
        instrumentType: "ETF",
        sourceCompositionStatus: "provided",
        sourceLines: [
          { id: "s4", dividendLedgerEntryId: "l2", sourceBucket: "DIVIDEND_INCOME", amount: 15_000, currencyCode: "TWD", source: "issuer" },
          { id: "s5", dividendLedgerEntryId: "l2", sourceBucket: "REVENUE_EQUALIZATION", amount: 200, currencyCode: "TWD", source: "issuer" },
        ],
      }),
    ];

    const result = aggregateEtfSourceLines(entries);

    expect(result.bucketAggregates).toHaveLength(4);
    const dividendBucket = result.bucketAggregates.find((a) => a.bucket === "DIVIDEND_INCOME");
    expect(dividendBucket?.totalAmount).toBe(15_900);
    expect(dividendBucket?.isNhiSubject).toBe(true);

    const interestBucket = result.bucketAggregates.find((a) => a.bucket === "INTEREST_INCOME");
    expect(interestBucket?.totalAmount).toBe(300);
    expect(interestBucket?.isNhiSubject).toBe(true);

    const capitalBucket = result.bucketAggregates.find((a) => a.bucket === "CAPITAL_RETURN");
    expect(capitalBucket?.totalAmount).toBe(100);
    expect(capitalBucket?.isNhiSubject).toBe(false);

    const revEqBucket = result.bucketAggregates.find((a) => a.bucket === "REVENUE_EQUALIZATION");
    expect(revEqBucket?.totalAmount).toBe(200);
    expect(revEqBucket?.isNhiSubject).toBe(false);
  });

  it("counts entries with unknown_pending_disclosure", () => {
    const entries: DividendLedgerEntryDetails[] = [
      buildEntry({ id: "l1", sourceCompositionStatus: "provided", sourceLines: [
        { id: "s1", dividendLedgerEntryId: "l1", sourceBucket: "DIVIDEND_INCOME", amount: 100, currencyCode: "TWD", source: "issuer" },
      ] }),
      buildEntry({ id: "l2", sourceCompositionStatus: "unknown_pending_disclosure", sourceLines: [] }),
      buildEntry({ id: "l3", sourceCompositionStatus: "unknown_pending_disclosure", sourceLines: [] }),
    ];

    const result = aggregateEtfSourceLines(entries);
    expect(result.pendingCount).toBe(2);
  });

  it("computes NHI-subject total from only DIVIDEND_INCOME and INTEREST_INCOME", () => {
    const entries: DividendLedgerEntryDetails[] = [
      buildEntry({
        id: "l1",
        sourceLines: [
          { id: "s1", dividendLedgerEntryId: "l1", sourceBucket: "DIVIDEND_INCOME", amount: 900, currencyCode: "TWD", source: "issuer" },
          { id: "s2", dividendLedgerEntryId: "l1", sourceBucket: "INTEREST_INCOME", amount: 300, currencyCode: "TWD", source: "issuer" },
          { id: "s3", dividendLedgerEntryId: "l1", sourceBucket: "REVENUE_EQUALIZATION", amount: 200, currencyCode: "TWD", source: "issuer" },
          { id: "s4", dividendLedgerEntryId: "l1", sourceBucket: "CAPITAL_RETURN", amount: 100, currencyCode: "TWD", source: "issuer" },
        ],
      }),
    ];

    const result = aggregateEtfSourceLines(entries);
    // NHI-subject = DIVIDEND_INCOME (900) + INTEREST_INCOME (300) = 1200
    expect(result.nhiSubjectTotal).toBe(1_200);
  });

  it("computes projected premium as nhiSubjectTotal × 0.0211", () => {
    const entries: DividendLedgerEntryDetails[] = [
      buildEntry({
        id: "l1",
        sourceLines: [
          { id: "s1", dividendLedgerEntryId: "l1", sourceBucket: "DIVIDEND_INCOME", amount: 25_000, currencyCode: "TWD", source: "issuer" },
          { id: "s2", dividendLedgerEntryId: "l1", sourceBucket: "INTEREST_INCOME", amount: 5_000, currencyCode: "TWD", source: "issuer" },
        ],
      }),
    ];

    const result = aggregateEtfSourceLines(entries);
    // NHI-subject = 30_000; premium = 30_000 × 0.0211 = 633
    expect(result.nhiSubjectTotal).toBe(30_000);
    expect(result.projectedPremium).toBe(633);
  });

  it("returns empty aggregates when no ETF/BOND_ETF entries exist", () => {
    const entries: DividendLedgerEntryDetails[] = [
      buildEntry({
        id: "l1",
        instrumentType: "STOCK",
        sourceLines: [
          { id: "s1", dividendLedgerEntryId: "l1", sourceBucket: "DIVIDEND_INCOME", amount: 50_000, currencyCode: "TWD", source: "issuer" },
        ],
      }),
    ];

    const result = aggregateEtfSourceLines(entries);
    expect(result.bucketAggregates).toHaveLength(0);
    expect(result.nhiSubjectTotal).toBe(0);
    expect(result.projectedPremium).toBe(0);
    expect(result.pendingCount).toBe(0);
  });

  it("includes BOND_ETF entries in aggregation", () => {
    const entries: DividendLedgerEntryDetails[] = [
      buildEntry({
        id: "l1",
        instrumentType: "BOND_ETF",
        sourceLines: [
          { id: "s1", dividendLedgerEntryId: "l1", sourceBucket: "INTEREST_INCOME", amount: 22_000, currencyCode: "TWD", source: "issuer" },
        ],
      }),
    ];

    const result = aggregateEtfSourceLines(entries);
    expect(result.nhiSubjectTotal).toBe(22_000);
    // 22_000 × 0.0211 = 464.2 → rounds to 464
    expect(result.projectedPremium).toBe(464);
  });

  it("skips buckets with zero total amount", () => {
    const entries: DividendLedgerEntryDetails[] = [
      buildEntry({
        id: "l1",
        sourceLines: [
          { id: "s1", dividendLedgerEntryId: "l1", sourceBucket: "DIVIDEND_INCOME", amount: 1_000, currencyCode: "TWD", source: "issuer" },
        ],
      }),
    ];

    const result = aggregateEtfSourceLines(entries);
    // Only DIVIDEND_INCOME has a non-zero amount
    expect(result.bucketAggregates).toHaveLength(1);
    expect(result.bucketAggregates[0]!.bucket).toBe("DIVIDEND_INCOME");
  });
});
