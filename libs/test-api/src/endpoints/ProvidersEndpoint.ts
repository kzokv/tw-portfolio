import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@tw-portfolio/test-framework/core";
import { apiUrl } from "@tw-portfolio/test-framework/shared";

// KZO-177 (M1): error_count_24h / error_count_7d / rate_limit_count_24h are
// computed-on-read from `market_data.provider_error_trail` and are NOT
// accepted by the `/__e2e/seed-provider-health-status` Zod schema. Same for
// `recentErrors` — trail rows are inserted via `recordOutcome`, not via the
// seed route. To pre-stage rate-limit / error count signals, drive them via
// `recordOutcome({ kind: "rate_limit" })` or `{ kind: "error" }` instead.
export interface ProviderHealthSeedInput {
  providerId: string;
  status?: "healthy" | "degraded" | "down";
  lastSuccessfulRun?: string | null;
  lastFailedRun?: string | null;
  lastErrorMessage?: string | null;
  lastManualRerunAt?: string | null;
  lastDownNotificationAt?: string | null;
}

/**
 * KZO-177 — AAA endpoint for the admin provider-health surface +
 * test-only seed route.
 */
export class ProvidersEndpoint extends BaseEndpoint {
  list = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/admin/providers"), headers ? { headers } : {});

  rerun = (providerId: string, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.post(
      apiUrl(`/admin/providers/${encodeURIComponent(providerId)}/rerun`),
      {
        data: {},
        ...(headers ? { headers } : {}),
      },
    );

  /**
   * Test-only seed via `/__e2e/seed-provider-health-status`. Gated by
   * `assertE2ESeedEnabled()` (NODE_ENV=development|test +
   * PERSISTENCE_BACKEND=memory). Body upserts a `provider_health_status` row
   * and optional trail entries.
   */
  seedProviderHealthStatus = (
    input: ProviderHealthSeedInput,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.post(apiUrl("/__e2e/seed-provider-health-status"), {
      data: input,
      ...(headers ? { headers } : {}),
    });
}
