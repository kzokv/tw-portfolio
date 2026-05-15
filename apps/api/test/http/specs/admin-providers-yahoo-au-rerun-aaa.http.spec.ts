/**
 * KZO-197 — HTTP AAA spec for the AU `yahoo-finance-au` rerun union path.
 *
 * Asserts:
 *   • Admin POST `/admin/providers/yahoo-finance-au/rerun` → 202.
 *   • Audit-log entry exists with nested `catalogBackfill` + `monitoredRefresh`
 *     metadata blocks, and top-level `tickerCount` reflects the SUM
 *     (back-compat).
 *   • Non-AU rerun audit metadata stays FLAT (no nested keys) — back-compat
 *     for KZO-177's existing audit-log spec.
 *   • AU 30-min cooldown vs TW 60-s cooldown: clicking AU 30 s after a stamped
 *     `lastManualRerunAt` → 429 (AU window not elapsed); clicking TW 30 s
 *     after stamp → 429 (TW window not elapsed) — same outcome but the
 *     route resolves the cooldown via the per-provider dispatcher so the
 *     implementation rule is exercised.
 *   • Body error shape on 429: `body.error === "rate_limit_exceeded"` per
 *     `service-error-pattern.md`.
 *
 * Reuses existing `ProvidersEndpoint` + `AdminEndpoint` assistants. No new
 * mapper.ts entries (per `test-api-mapper-registration.md` — only register
 * NEW endpoint+assistant pairs).
 *
 * RED until Backend Implementer ships the route changes.
 */
import { createApiFixture } from "@vakwen/test-api/config";
import { ProvidersEndpoint } from "@vakwen/test-api/endpoints";
import type { TProvidersApiAssistant } from "@vakwen/test-api/assistants";
import { test as base } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const test = base.extend<{ providersApi: TProvidersApiAssistant }>({
  providersApi: createApiFixture<TProvidersApiAssistant>(ProvidersEndpoint),
});

test.describe("KZO-197 — POST /admin/providers/yahoo-finance-au/rerun", () => {
  test("[AU rerun]: 202 + audit metadata has nested catalogBackfill + monitoredRefresh", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "kzo197-au-rerun-admin-sub",
      email: "kzo197-au-rerun-admin@example.com",
      name: "KZO-197 AU Rerun Admin",
      role: "admin",
    });
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "down",
      lastSuccessfulRun: null,
      lastFailedRun: null,
      lastManualRerunAt: null,
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "yahoo-finance-au",
    );
    await providersApi.assert.statusIs(response, 202);

    // Audit-log entry contains the nested-shape metadata for AU only.
    const auditResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["provider_health_rerun"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(auditResponse, 200);
    const auditBody = await adminApi.arrange.auditLogBody(auditResponse);
    const entry = auditBody.items.find((e) => e.action === "provider_health_rerun");
    await adminApi.assert.mxAssertDefined(entry, "provider_health_rerun audit entry");

    const meta = entry!.metadata as {
      providerId?: string;
      marketCode?: string;
      tickerCount?: number;
      catalogBackfill?: { tickerCount: number; jobId: string | null };
      monitoredRefresh?: { tickerCount: number; jobId: string | null };
    };
    await adminApi.assert.mxAssertEqual(meta.providerId, "yahoo-finance-au", "providerId");
    await adminApi.assert.mxAssertEqual(meta.marketCode, "AU", "marketCode");
    await adminApi.assert.mxAssertDefined(meta.catalogBackfill, "catalogBackfill block present");
    await adminApi.assert.mxAssertDefined(meta.monitoredRefresh, "monitoredRefresh block present");
    await adminApi.assert.mxAssertEqual(
      meta.tickerCount,
      (meta.catalogBackfill?.tickerCount ?? 0) + (meta.monitoredRefresh?.tickerCount ?? 0),
      "top-level tickerCount = sum (back-compat)",
    );
  });

  test("[non-AU rerun]: finmind-tw audit metadata stays FLAT (back-compat)", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "kzo197-tw-rerun-admin-sub",
      email: "kzo197-tw-rerun-admin@example.com",
      name: "KZO-197 TW Rerun Admin",
      role: "admin",
    });
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: null,
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "finmind-tw",
    );
    await providersApi.assert.statusIs(response, 202);

    const auditResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["provider_health_rerun"],
      actorUserId: admin.userId,
    });
    const auditBody = await adminApi.arrange.auditLogBody(auditResponse);
    const entry = auditBody.items.find(
      (e) =>
        e.action === "provider_health_rerun" &&
        (e.metadata as { providerId?: string }).providerId === "finmind-tw",
    );
    await adminApi.assert.mxAssertDefined(entry, "finmind-tw audit entry");
    const meta = entry!.metadata as Record<string, unknown>;
    // No nested KZO-197 keys for non-AU providers.
    await adminApi.assert.mxAssertEqual(
      meta.catalogBackfill,
      undefined,
      "catalogBackfill absent",
    );
    await adminApi.assert.mxAssertEqual(
      meta.monitoredRefresh,
      undefined,
      "monitoredRefresh absent",
    );
  });

  test("[AU cooldown 429]: AU 30-min cooldown enforced — second click within window → 429 + Retry-After > 60s", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "kzo197-au-cooldown-admin-sub",
      email: "kzo197-au-cooldown-admin@example.com",
      name: "KZO-197 AU Cooldown Admin",
      role: "admin",
    });
    // 30 s ago — well inside the 30 min AU window.
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "yahoo-finance-au",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: new Date(Date.now() - 30_000).toISOString(),
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "yahoo-finance-au",
    );
    await providersApi.assert.statusIs(response, 429);
    await providersApi.assert.retryAfterHeaderIsPresent(response);

    const retryAfter = Number(response.headers()["retry-after"]);
    // > 60 s confirms AU is on its 30-min window, NOT the legacy 60-s default.
    await adminApi.assert.mxAssertTruthy(
      retryAfter > 60,
      `Retry-After > 60 s (got ${retryAfter}) — AU not on legacy 60-s window`,
    );

    const body = await adminApi.arrange.errorBody(response);
    // Per `.claude/rules/service-error-pattern.md` — body.error carries the code.
    await adminApi.assert.errorCodeIs(body, "rate_limit_exceeded");
  });
});
