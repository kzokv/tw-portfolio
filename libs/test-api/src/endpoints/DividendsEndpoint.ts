import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

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
