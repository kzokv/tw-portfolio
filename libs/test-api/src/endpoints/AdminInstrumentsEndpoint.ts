import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

/**
 * KZO-195 — HTTP-suite endpoint wrapper for the admin /admin/instruments
 * mutation routes (undelete + exclusion toggle). Per
 * `apps/api/src/routes/registerRoutes.ts` (Phase 7) the routes are:
 *
 *   POST /admin/instruments/:ticker/:marketCode/undelete   → 200 / 403
 *   POST /admin/instruments/:ticker/:marketCode/exclude    → 200 / 403
 *     body: { excluded: boolean }
 *
 * Per `service-error-pattern.md`: 403 path returns `{ error, message }` (NOT
 * `code`).
 */
export class AdminInstrumentsEndpoint extends BaseEndpoint {
  undelete = (
    ticker: string,
    marketCode: string,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(
      apiUrl(`/admin/instruments/${encodeURIComponent(ticker)}/${encodeURIComponent(marketCode)}/undelete`),
      headers ? { headers } : {},
    );

  exclude = (
    ticker: string,
    marketCode: string,
    body: { excluded: boolean },
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(
      apiUrl(`/admin/instruments/${encodeURIComponent(ticker)}/${encodeURIComponent(marketCode)}/exclude`),
      {
        data: body,
        ...(headers ? { headers } : {}),
      },
    );
}
