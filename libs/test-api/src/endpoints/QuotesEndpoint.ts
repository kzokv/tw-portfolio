import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

export class QuotesEndpoint extends BaseEndpoint {
  getQuotes = (tickers: string[], headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl(`/quotes?tickers=${tickers.join(",")}`), headers !== undefined ? { headers } : {});

  seedDailyBars = (
    bars: {
      ticker: string;
      marketCode?: "TW" | "US" | "AU";
      barDate: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      source?: string;
      ingestedAt?: string;
    }[],
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/seed-daily-bars"), {
      data: { bars },
      ...(headers ? { headers } : {}),
    });
}
