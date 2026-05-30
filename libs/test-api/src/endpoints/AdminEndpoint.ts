import type { APIResponse } from "@playwright/test";
import { BaseEndpoint } from "@vakwen/test-framework/core";
import { apiUrl } from "@vakwen/test-framework/shared";

export interface TAdminInvitesQuery {
  page?: number;
  limit?: number;
  status?: "pending" | "used" | "expired" | "revoked";
  email?: string;
}

export interface TAdminAuditLogQuery {
  page?: number;
  limit?: number;
  action?: string[];
  actorUserId?: string;
  targetUserId?: string;
  fromDate?: string;
  toDate?: string;
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export class AdminEndpoint extends BaseEndpoint {
  listInvites = (query?: TAdminInvitesQuery, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(
      apiUrl(`/admin/invites${toQueryString({
        page: query?.page,
        limit: query?.limit,
        status: query?.status,
        email: query?.email,
      })}`),
      headers ? { headers } : {},
    );

  listAuditLog = (query?: TAdminAuditLogQuery, headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(
      apiUrl(`/admin/audit-log${toQueryString({
        page: query?.page,
        limit: query?.limit,
        action: query?.action?.join(","),
        actorUserId: query?.actorUserId,
        targetUserId: query?.targetUserId,
        fromDate: query?.fromDate,
        toDate: query?.toDate,
      })}`),
      headers ? { headers } : {},
    );

  getAdminSettings = (headers?: Record<string, string>): Promise<APIResponse> =>
    this.request.get(apiUrl("/admin/settings"), headers ? { headers } : {});

  patchAdminSettings = (
    body: TPatchAdminSettingsBody,
    headers?: Record<string, string>,
  ): Promise<APIResponse> =>
    this.request.patch(apiUrl("/admin/settings"), {
      data: body,
      ...(headers ? { headers } : {}),
    });
}

/**
 * KZO-198 — body shape for PATCH /admin/settings. Accepts every field the
 * server's `patchAdminSettingsSchema` allows. Intentionally loose: tests for
 * out-of-range values, Tier 2 keys, and other negative-path scenarios pass
 * unknown values via `Record<string, unknown>` cast.
 */
export interface TPatchAdminSettingsBody {
  // Pre-existing
  repairCooldownMinutes?: number | null;
  dashboardPerformanceRanges?: string[] | null;
  metadataEnrichmentMode?: "unconditional" | "conditional" | null;

  // KZO-198 Tier 1 — rate limits
  marketDataPriceWindowMs?: number | null;
  marketDataPriceLimit?: number | null;
  marketDataSearchWindowMs?: number | null;
  marketDataSearchLimit?: number | null;
  inviteStatusWindowMs?: number | null;
  inviteStatusLimit?: number | null;

  // KZO-198 Tier 1 — provider health
  providerDownNotificationSuppressionMs?: number | null;
  providerErrorTrailRetentionDays?: number | null;
  providerRerunCooldownMs?: number | null;
  // KZO-197 (surfaced in KZO-199 Phase 4): yahoo-finance-au-specific override.
  yahooAuRerunCooldownMs?: number | null;

  // KZO-198 Tier 1 — backfill
  backfillRetryLimit?: number | null;
  backfillRetryDelaySeconds?: number | null;
  backfillFinmind402RetryMs?: number | null;

  // KZO-198 Tier 0 — encrypted secrets (rotation flow)
  finmindApiToken?: string | null;
  twelveDataApiKey?: string | null;

  // KZO-199 Tier 1 — anonymous share token + rate-limit knobs
  anonymousShareTokenCap?: number | null;
  anonymousShareRateLimitMax?: number | null;
  anonymousShareRateLimitWindowMs?: number | null;
}
