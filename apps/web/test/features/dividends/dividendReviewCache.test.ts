import { describe, expect, it } from "vitest";
import type { DividendReviewPrimaryQueryDto } from "@vakwen/shared-types";
import {
  DIVIDEND_REVIEW_ENRICHMENT_CACHE_TAG,
  DIVIDEND_REVIEW_PRIMARY_CACHE_TAG,
  buildDividendReviewEnrichmentCacheKey,
  buildDividendReviewPrimaryCacheKey,
} from "../../../features/dividends/dividendReviewCache";

const baseQuery: DividendReviewPrimaryQueryDto = {
  fromPaymentDate: "2026-01-01",
  toPaymentDate: "2026-12-31",
  accountIds: ["acc-1"],
  tickers: ["2330"],
  marketCode: "TW",
  reconciliationStatus: "open",
  cashStatuses: ["open"],
  stockStatuses: ["needs_calculation"],
  excludeExpected: true,
  sourceComposition: "pending",
  sortBy: "paymentDate",
  sortOrder: "desc",
  page: 1,
  limit: 10,
};

describe("dividend review cache identity", () => {
  it("partitions primary by context and every semantic primary dimension", () => {
    const original = buildDividendReviewPrimaryCacheKey("session:a:context:self", baseQuery);
    const dimensions: Array<DividendReviewPrimaryQueryDto> = [
      { ...baseQuery, fromPaymentDate: "2025-01-01" },
      { ...baseQuery, toPaymentDate: "2026-11-30" },
      { ...baseQuery, accountIds: ["acc-2"] },
      { ...baseQuery, tickers: ["0050", "2886"] },
      { ...baseQuery, marketCode: "US" },
      { ...baseQuery, postingStatus: "posted" },
      { ...baseQuery, reconciliationStatus: "matched" },
      { ...baseQuery, cashStatuses: ["matched"] },
      { ...baseQuery, stockStatuses: ["variance"] },
      { ...baseQuery, excludeExpected: false },
      { ...baseQuery, sourceComposition: undefined },
      { ...baseQuery, sortBy: "ticker" },
      { ...baseQuery, sortOrder: "asc" },
      { ...baseQuery, page: 2 },
      { ...baseQuery, limit: 25 },
    ];

    expect(new Set(dimensions.map((query) => buildDividendReviewPrimaryCacheKey("session:a:context:self", query))).has(original)).toBe(false);
    expect(buildDividendReviewPrimaryCacheKey("session:a:context:owner", baseQuery)).not.toBe(original);
  });

  it("partitions enrichment by context and filters but excludes sort and pagination", () => {
    const original = buildDividendReviewEnrichmentCacheKey("session:a:context:self", baseQuery);

    const sortedAndPagedQuery: DividendReviewPrimaryQueryDto = {
      ...baseQuery,
      sortBy: "ticker",
      sortOrder: "asc",
      page: 3,
      limit: 50,
    };
    expect(buildDividendReviewEnrichmentCacheKey("session:a:context:self", sortedAndPagedQuery)).toBe(original);
    expect(buildDividendReviewEnrichmentCacheKey("session:a:context:self", {
      ...baseQuery,
      sourceComposition: undefined,
    })).not.toBe(original);
    expect(buildDividendReviewEnrichmentCacheKey("session:a:context:self", {
      ...baseQuery,
      stockStatuses: ["variance"],
    })).not.toBe(original);
    expect(DIVIDEND_REVIEW_PRIMARY_CACHE_TAG).not.toBe(DIVIDEND_REVIEW_ENRICHMENT_CACHE_TAG);
  });
});
