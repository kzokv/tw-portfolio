import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

function withQuery(path: string, query?: Record<string, string | number | undefined>): string {
  if (!query) return apiUrl(path);

  const url = new URL(apiUrl(path));
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export class DividendsEndpoint extends BaseEndpoint {
  seedDividendEvent = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/seed-dividend-event"), {
      data,
      ...(headers ? { headers } : {}),
    });

  listEvents = (
    query?: Record<string, string | number | undefined>,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.get(withQuery("/dividend-events", query), {
      ...(headers ? { headers } : {}),
    });

  listLedger = (
    query?: Record<string, string | number | undefined>,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.get(withQuery("/portfolio/dividends/ledger", query), {
      ...(headers ? { headers } : {}),
    });

  listDailyHighlights = (
    query?: Record<string, string | number | undefined>,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.get(withQuery("/portfolio/dividends/daily-highlights", query), {
      ...(headers ? { headers } : {}),
    });

  listReview = (
    query?: Record<string, string | number | undefined>,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.get(withQuery("/portfolio/dividends/review", query), {
      ...(headers ? { headers } : {}),
    });

  listHoldingActivity = (
    ticker: string,
    query?: Record<string, string | number | undefined>,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.get(withQuery(`/portfolio/holdings/${encodeURIComponent(ticker)}/activity-dividends`, query), {
      ...(headers ? { headers } : {}),
    });

  listTickerDividends = (
    ticker: string,
    section: "upcoming" | "open-reconciliation" | "posted-history",
    query?: Record<string, string | number | undefined>,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.get(withQuery(`/tickers/${encodeURIComponent(ticker)}/dividends/${section}`, query), {
      ...(headers ? { headers } : {}),
    });

  previewTradeDelete = (
    tradeEventId: string,
    data: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl(`/portfolio/transactions/${encodeURIComponent(tradeEventId)}/dividend-delete-preview`), {
      data,
      ...(headers ? { headers } : {}),
    });

  confirmTradeDelete = (
    tradeEventId: string,
    data: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl(`/portfolio/transactions/${encodeURIComponent(tradeEventId)}/dividend-delete-confirm`), {
      data,
      ...(headers ? { headers } : {}),
    });

  previewAccountPurge = (
    accountId: string,
    data: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl(`/portfolio/accounts/${encodeURIComponent(accountId)}/purge-rebuild-preview`), {
      data,
      ...(headers ? { headers } : {}),
    });

  confirmAccountPurge = (
    accountId: string,
    data: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl(`/portfolio/accounts/${encodeURIComponent(accountId)}/purge-rebuild-confirm`), {
      data,
      ...(headers ? { headers } : {}),
    });

  createOrUpdatePosting = (data: unknown, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(apiUrl("/portfolio/dividends/postings"), {
      data,
      ...(headers ? { headers } : {}),
    });

  patchReconciliation = (
    dividendLedgerEntryId: string,
    data: unknown,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.patch(apiUrl(`/portfolio/dividends/postings/${dividendLedgerEntryId}/reconciliation`), {
      data,
      ...(headers ? { headers } : {}),
    });
}
