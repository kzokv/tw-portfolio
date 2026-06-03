/**
 * KZO-177 — HTTP/AAA tests for `/admin/providers` (list) and
 * `/admin/providers/:id/rerun`.
 *
 * TDD-red until Backend Implementer lands:
 *   • POST /__e2e/seed-provider-health-status (assertE2ESeedEnabled guard)
 *   • GET /admin/providers
 *   • POST /admin/providers/:providerId/rerun
 *   • libs/test-api ProvidersEndpoint registration in mapper.ts
 *
 * Coverage mirrors qa-plan.md §3:
 *   H1 — admin: 200 with full shape (8 providers; errorTrail max 10)
 *   H2 — non-admin viewer: 403 admin_role_required
 *   H3 — anonymous: 401
 *   H4 — empty trail returns []
 *   R1 — admin rerun finmind-tw → 202 + audit log entry
 *   R2 — admin rerun frankfurter (FX path) → 202
 *   R3 — cooldown 429 + Retry-After header
 *   R4 — KR rerun with `resolverMode` payload is accepted (204? 202)
 *   R4b — invalid `resolverMode` payload is rejected
 *   R4c — chart_probe_v1 requires explicit risk acceptance
 *   R4d — resolverMode is rejected for non-KR providers
 *   R5 — non-admin rerun: 403
 *   R6 — anonymous: 401
 *   R7 — unknown provider id: 404 with body.error
 *   R9 — body.error carries the code (per service-error-pattern.md)
 */
import { createApiFixture } from "@vakwen/test-api/config";
import { ProvidersEndpoint } from "@vakwen/test-api/endpoints";
import type { TProvidersApiAssistant } from "@vakwen/test-api/assistants";
import { test as base } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

// ── Local fixture extension ───────────────────────────────────────────────────

const test = base.extend<{ providersApi: TProvidersApiAssistant }>({
  providersApi: createApiFixture<TProvidersApiAssistant>(ProvidersEndpoint),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// KZO-200: `twelve-data-au` row added (KZO-194 catalog provider).
const PROVIDERS = [
  "finmind-tw",
  "finmind-us",
  "yahoo-finance-au",
  "twelve-data-au",
  "yahoo-finance-kr",
  "twelve-data-kr",
  "frankfurter",
  "asx-gics-csv",
] as const;

async function seedAllHealthy(providersApi: TProvidersApiAssistant): Promise<void> {
  for (const id of PROVIDERS) {
    await providersApi.actions.seedProviderHealthStatus({
      providerId: id,
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("GET /admin/providers", () => {
  test("[H1 admin]: 200 with all 8 providers and DTO shape", async ({
    request,
    providersApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-list-admin-sub",
      email: "providers-list-admin@example.com",
      name: "Providers List Admin",
      role: "admin",
    });
    await seedAllHealthy(providersApi);

    const response = await providersApi.actions.listForCookie(admin.cookieHeader);
    await providersApi.assert.statusIs(response, 200);

    const body = await providersApi.arrange.listBody(response);
    await providersApi.assert.hasEightProviders(body);
    await providersApi.assert.providerStatusIs(body, "finmind-tw", "healthy");

    // Each row carries the locked DTO fields.
    for (const row of body.providers) {
      await providersApi.assert.mxAssertDefined(row.providerId, "providerId present");
      await providersApi.assert.mxAssertDefined(row.status, "status present");
      await providersApi.assert.mxAssertDefined(row.errorCount24h, "errorCount24h present");
      await providersApi.assert.mxAssertTruthy(
        Array.isArray(row.recentErrors),
        "recentErrors is an array",
      );
    }
  });

  test("[H2 non-admin]: viewer gets 403 admin_role_required", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const member = await createOauthSession(request, {
      sub: "providers-list-member-sub",
      email: "providers-list-member@example.com",
      name: "Providers List Member",
      role: "member",
    });

    const response = await providersApi.actions.listForCookie(member.cookieHeader);
    await providersApi.assert.statusIs(response, 403);
    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "admin_role_required");
  });

  test("[H3 anonymous]: 401 when no session cookie", async ({ providersApi }) => {
    const response = await providersApi.actions.listAnonymous();
    await providersApi.assert.statusIs(response, 401);
  });

  test("[H4 empty trail]: row with no trail entries → recentErrors === []", async ({
    request,
    providersApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-list-empty-sub",
      email: "providers-list-empty@example.com",
      name: "Providers List Empty",
      role: "admin",
    });
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
    });

    const response = await providersApi.actions.listForCookie(admin.cookieHeader);
    const body = await providersApi.arrange.listBody(response);
    const row = body.providers.find((p) => p.providerId === "finmind-tw");
    await providersApi.assert.mxAssertDefined(row, "finmind-tw row present");
    await providersApi.assert.mxAssertEqual(
      row!.recentErrors.length,
      0,
      "recentErrors empty",
    );
  });
});

test.describe("POST /admin/providers/:providerId/rerun", () => {
  test("[R1 happy finmind-tw]: 202 + audit log entry written", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-rerun-tw-sub",
      email: "providers-rerun-tw@example.com",
      name: "Providers Rerun TW",
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

    // Audit-log entry exists for this actor.
    const auditResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["provider_health_rerun"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(auditResponse, 200);
    const auditBody = await adminApi.arrange.auditLogBody(auditResponse);
    const entry = auditBody.items.find((e) => e.action === "provider_health_rerun");
    await adminApi.assert.mxAssertDefined(entry, "provider_health_rerun audit entry");
  });

  test("[R2 happy frankfurter]: 202 (FX queue path)", async ({
    request,
    providersApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-rerun-fx-sub",
      email: "providers-rerun-fx@example.com",
      name: "Providers Rerun FX",
      role: "admin",
    });
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "frankfurter",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: null,
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "frankfurter",
    );
    await providersApi.assert.statusIs(response, 202);
  });

  test("[R3 cooldown 429]: clicked within 60s → 429 + Retry-After header", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-rerun-cd-sub",
      email: "providers-rerun-cd@example.com",
      name: "Providers Rerun Cooldown",
      role: "admin",
    });
    // 30s ago — still within the 60s cooldown.
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "finmind-tw",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: new Date(Date.now() - 30_000).toISOString(),
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "finmind-tw",
    );
    await providersApi.assert.statusIs(response, 429);
    await providersApi.assert.retryAfterHeaderIsPresent(response);

    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "rate_limit_exceeded");
  });

  test("[R4 kr quote_first]: custom resolver mode is accepted for yahoo-finance-kr", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-rerun-kr-mode-sub",
      email: "providers-rerun-kr-mode@example.com",
      name: "Providers Rerun KR Mode",
      role: "admin",
    });
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "yahoo-finance-kr",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: null,
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "yahoo-finance-kr",
      { resolverMode: "quote_first" },
    );
    await providersApi.assert.statusIs(response, 202);

    const auditResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["provider_health_rerun"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(auditResponse, 200);
    const auditBody = await adminApi.arrange.auditLogBody(auditResponse);
    const entry = auditBody.items.find(
      (e) =>
        e.action === "provider_health_rerun" &&
        (e.metadata as { providerId?: string }).providerId === "yahoo-finance-kr",
    );
    await adminApi.assert.mxAssertDefined(entry, "provider_health_rerun audit entry");
    await adminApi.assert.mxAssertEqual(
      (entry!.metadata as { resolverMode?: string }).resolverMode,
      "quote_first",
      "resolverMode audit metadata",
    );
  });

  test("[R4b kr chart_probe accepted]: repair resolver requires explicit risk acceptance", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-rerun-kr-chart-probe-sub",
      email: "providers-rerun-kr-chart-probe@example.com",
      name: "Providers Rerun KR Chart Probe",
      role: "admin",
    });
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "yahoo-finance-kr",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: null,
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "yahoo-finance-kr",
      { resolverMode: "chart_probe_v1", resolverModeRiskAccepted: true },
    );
    await providersApi.assert.statusIs(response, 202);

    const auditResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["provider_health_rerun"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(auditResponse, 200);
    const auditBody = await adminApi.arrange.auditLogBody(auditResponse);
    const entry = auditBody.items.find(
      (e) =>
        e.action === "provider_health_rerun" &&
        (e.metadata as { providerId?: string }).providerId === "yahoo-finance-kr",
    );
    await adminApi.assert.mxAssertDefined(entry, "provider_health_rerun audit entry");
    await adminApi.assert.mxAssertEqual(
      (entry!.metadata as { resolverMode?: string }).resolverMode,
      "chart_probe_v1",
      "resolverMode audit metadata",
    );
    await adminApi.assert.mxAssertEqual(
      (entry!.metadata as { resolverModeRiskAccepted?: boolean }).resolverModeRiskAccepted,
      true,
      "resolverModeRiskAccepted audit metadata",
    );
  });

  test("[R4c kr chart_probe missing acceptance]: rejects dangerous repair mode without guardrail", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-rerun-kr-chart-probe-missing-ack-sub",
      email: "providers-rerun-kr-chart-probe-missing-ack@example.com",
      name: "Providers Rerun KR Chart Probe Missing Ack",
      role: "admin",
    });
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "yahoo-finance-kr",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: null,
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "yahoo-finance-kr",
      { resolverMode: "chart_probe_v1" },
    );
    await providersApi.assert.statusIs(response, 400);

    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "resolver_mode_risk_acceptance_required");
  });

  test("[R4d non-kr resolver payload]: rejects resolver mode outside yahoo-finance-kr", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-rerun-non-kr-mode-sub",
      email: "providers-rerun-non-kr-mode@example.com",
      name: "Providers Rerun Non KR Mode",
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
      { resolverMode: "quote_first" },
    );
    await providersApi.assert.statusIs(response, 400);

    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "resolver_mode_provider_mismatch");
  });

  test("[R4e kr invalid resolver mode]: rejects payload outside schema", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-rerun-kr-mode-invalid-sub",
      email: "providers-rerun-kr-mode-invalid@example.com",
      name: "Providers Rerun KR Mode Invalid",
      role: "admin",
    });
    await providersApi.actions.seedProviderHealthStatus({
      providerId: "yahoo-finance-kr",
      status: "healthy",
      lastSuccessfulRun: new Date().toISOString(),
      lastManualRerunAt: null,
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "yahoo-finance-kr",
      { resolverMode: "chart-typo" as unknown as "chart_probe_v1" | "quote_first" },
    );
    await providersApi.assert.statusIs(response, 400);

    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.mxAssertTruthy(
      (body as { error?: string; code?: string }).error === "validation_error" ||
        (body as { error?: { code?: string } })?.error?.code === "bad_request" ||
        (body as { code?: string }).code === "bad_request",
      "bad request for invalid resolver mode",
    );
  });

  test("[R6 non-admin]: viewer 403", async ({ request, providersApi, adminApi }) => {
    const member = await createOauthSession(request, {
      sub: "providers-rerun-member-sub",
      email: "providers-rerun-member@example.com",
      name: "Providers Rerun Member",
      role: "member",
    });

    const response = await providersApi.actions.rerunForCookie(
      member.cookieHeader,
      "finmind-tw",
    );
    await providersApi.assert.statusIs(response, 403);
    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "admin_role_required");
  });

  test("[R6 anonymous]: 401", async ({ providersApi }) => {
    const response = await providersApi.actions.rerunAnonymous("finmind-tw");
    await providersApi.assert.statusIs(response, 401);
  });

  test("[R7 unknown provider]: 404 with body.error", async ({
    request,
    providersApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "providers-rerun-404-sub",
      email: "providers-rerun-404@example.com",
      name: "Providers Rerun 404",
      role: "admin",
    });

    const response = await providersApi.actions.rerunForCookie(
      admin.cookieHeader,
      "unknown-provider",
    );
    await providersApi.assert.statusIs(response, 404);

    const body = await adminApi.arrange.errorBody(response);
    // Per .claude/rules/service-error-pattern.md — body.error carries the code.
    await adminApi.assert.mxAssertDefined(body.error, "body.error present");
  });
});
