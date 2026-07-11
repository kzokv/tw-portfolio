import type {
  DividendLedgerHistoryPageDto,
  DividendReviewPageLimit,
  DividendUpcomingPageDto,
  TickerDividendOpenListDto,
  TickerDividendPostedHistoryDto,
  TickerDividendUpcomingListDto,
  MarketCode,
} from "@vakwen/shared-types";
import { getJson } from "../../../lib/api";

export interface TickerDividendQuery {
  accountId?: string;
  accountIds?: string[];
  marketCode?: MarketCode | string;
  page?: number;
  limit?: DividendReviewPageLimit;
}

interface TickerDividendRequestOptions {
  signal?: AbortSignal;
}

function buildTickerDividendQuery(params: TickerDividendQuery): string {
  const query = new URLSearchParams();

  if (params.accountId) query.set("accountId", params.accountId);
  if (params.accountIds?.length) query.set("accountIds", params.accountIds.join(","));
  if (params.marketCode) query.set("marketCode", params.marketCode);
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));

  return query.toString();
}

function buildTickerDividendPath(ticker: string, suffix: string, params: TickerDividendQuery): string {
  const query = buildTickerDividendQuery(params);
  return `/tickers/${encodeURIComponent(ticker)}/dividends/${suffix}${query ? `?${query}` : ""}`;
}

export async function fetchTickerUpcomingDividends(
  ticker: string,
  params: TickerDividendQuery,
  options: TickerDividendRequestOptions = {},
): Promise<DividendUpcomingPageDto> {
  const payload = await getJson<TickerDividendUpcomingListDto>(
    buildTickerDividendPath(ticker, "upcoming", params),
    { signal: options.signal },
  );
  return payload.upcomingDividends;
}

export async function fetchTickerOpenReconciliation(
  ticker: string,
  params: TickerDividendQuery,
  options: TickerDividendRequestOptions = {},
): Promise<DividendLedgerHistoryPageDto> {
  const payload = await getJson<TickerDividendOpenListDto>(
    buildTickerDividendPath(ticker, "open-reconciliation", params),
    { signal: options.signal },
  );
  return payload.openReconciliation;
}

export async function fetchTickerPostedDividendHistory(
  ticker: string,
  params: TickerDividendQuery,
  options: TickerDividendRequestOptions = {},
): Promise<DividendLedgerHistoryPageDto> {
  const payload = await getJson<TickerDividendPostedHistoryDto>(
    buildTickerDividendPath(ticker, "posted-history", params),
    { signal: options.signal },
  );
  return payload.postedHistory;
}
