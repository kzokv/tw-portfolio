import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

/**
 * KZO-169: shape accepted by `POST /__e2e/seed-instruments`. Mirrors the
 * route's Zod schema at `apps/api/src/routes/registerRoutes.ts:1452-1462`.
 */
export interface SeedInstrumentInput {
  ticker: string;
  name: string | null;
  instrumentType: string | null;
  marketCode: string;
  barsBackfillStatus: string;
  lastRepairAt?: string | null;
  delistedAt?: string;
  industryCategoryRaw?: string | null;
  gicsIndustryGroup?: string | null;
}

export type InstrumentsMarketFilter = "TW" | "US" | "AU" | "ALL";

/**
 * KZO-169: HTTP-suite endpoint wrapper for `/instruments` (catalog read) and
 * `/__e2e/seed-instruments` (test-only seed for multi-market scenarios).
 */
export class InstrumentsEndpoint extends BaseEndpoint {
  list = (
    marketCode?: InstrumentsMarketFilter,
    headers?: Record<string, string>,
  ): Promise<APIResponse> => {
    const path = marketCode
      ? `/instruments?market_code=${marketCode}`
      : "/instruments";
    return this.request.get(apiUrl(path), headers !== undefined ? { headers } : {});
  };

  seedInstruments = (
    instruments: SeedInstrumentInput[],
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/seed-instruments"), {
      data: { instruments },
      ...(headers ? { headers } : {}),
    });
}
