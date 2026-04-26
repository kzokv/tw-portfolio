import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

export interface FxRateSeedInput {
  date: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  source?: string;
}

export interface FxRefreshRequestBody {
  startDate?: string;
  endDate?: string;
  bases?: ReadonlyArray<string>;
}

/**
 * KZO-164 — AAA endpoint for the FX-rates admin surface + e2e seed route.
 *
 * Mirrors `NotificationsEndpoint` shape: thin wrappers over `request.{post,get}`
 * that build the full URL and propagate optional cookie headers.
 */
export class FxRatesEndpoint extends BaseEndpoint {
  manualRefresh = (
    body: FxRefreshRequestBody,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/admin/fx-rates/refresh"), {
      data: body,
      ...(headers ? { headers } : {}),
    });

  getFreshness = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/admin/fx-rates/freshness"), headers ? { headers } : {});

  seedFxRates = (
    rates: ReadonlyArray<FxRateSeedInput>,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/seed-fx-rates"), {
      data: { rates },
      ...(headers ? { headers } : {}),
    });

  resetFxRates = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/reset-fx-rates"), headers ? { headers } : {});
}
