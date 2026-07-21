import type {
  DividendReviewFilterDto,
  DividendReviewPrimaryQueryDto,
} from "@vakwen/shared-types";
import {
  buildRouteDtoCacheKey,
  buildRouteDtoCacheTag,
  clearRouteDtoCacheByTags,
} from "../../lib/routeDtoCache";

export const DIVIDEND_REVIEW_PRIMARY_CACHE_TAG = buildRouteDtoCacheTag("route", "dividend-review-primary");
export const DIVIDEND_REVIEW_ENRICHMENT_CACHE_TAG = buildRouteDtoCacheTag("route", "dividend-review-enrichment");
export const DIVIDEND_REVIEW_CACHE_TAGS = [
  DIVIDEND_REVIEW_PRIMARY_CACHE_TAG,
  DIVIDEND_REVIEW_ENRICHMENT_CACHE_TAG,
] as const;

const FILTER_DIMENSIONS: Array<keyof DividendReviewFilterDto> = [
  "fromPaymentDate",
  "toPaymentDate",
  "accountId",
  "tickers",
  "marketCode",
  "postingStatus",
  "cashStatus",
  "stockStatus",
  "reconciliationStatus",
  "excludeExpected",
  "sourceComposition",
];

function filterIdentity(filters: DividendReviewFilterDto): string[] {
  return FILTER_DIMENSIONS.flatMap((field) => [field, String(filters[field] ?? "*")]);
}

export function buildDividendReviewPrimaryCacheKey(
  contextScope: string,
  query: DividendReviewPrimaryQueryDto,
): string {
  return buildRouteDtoCacheKey(
    "dividend-review-primary",
    contextScope,
    ...filterIdentity(query),
    "sortBy",
    query.sortBy,
    "sortOrder",
    query.sortOrder,
    "page",
    query.page,
    "limit",
    query.limit,
  );
}

export function buildDividendReviewEnrichmentCacheKey(
  contextScope: string,
  filters: DividendReviewFilterDto,
): string {
  return buildRouteDtoCacheKey(
    "dividend-review-enrichment",
    contextScope,
    ...filterIdentity(filters),
  );
}

export function clearDividendReviewCaches(): void {
  clearRouteDtoCacheByTags([...DIVIDEND_REVIEW_CACHE_TAGS]);
}
