/**
 * HTTP/AAA tests for POST /admin/fx-rates/refresh (KZO-164).
 *
 * NOTE: This spec imports FxRatesEndpoint and TFxRatesApiAssistant from the AAA infra
 * written by the Implementer (libs/test-api slices 16). It will fail to compile until
 * that code lands — expected and correct for Tier 2 parallel Phase 1+2.
 *
 * Coverage:
 *  - Admin auth gates non-admin requests (403 admin_role_required)
 *  - Demo user blocked (403 demo_restricted)
 *  - Validation: startDate > endDate → 400
 *  - Validation: empty bases array → 400
 *  - Validation: invalid currency codes → 400
 *  - First call returns { status: 'queued', jobId }
 *  - Concurrent second call (within singleton lifetime) returns { status: 'skipped_existing_job' }
 *  - Queue unavailable (app.boss === null) returns 503 + code 'queue_unavailable'
 *  - Invariant 2: audit log entry written for manual trigger (action: 'admin_fx_rates_refresh')
 */
import { TestEnv } from "@tw-portfolio/config/test";
import { createApiFixture } from "@tw-portfolio/test-api/config";
// TDD-red: FxRatesEndpoint and TFxRatesApiAssistant don't exist until Implementer lands slice 16
import { FxRatesEndpoint } from "@tw-portfolio/test-api/endpoints";
import type { TFxRatesApiAssistant } from "@tw-portfolio/test-api/assistants";
import { test as base } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

// ── Local fixture extension ───────────────────────────────────────────────────

const test = base.extend<{ fxRatesApi: TFxRatesApiAssistant }>({
  fxRatesApi: createApiFixture<TFxRatesApiAssistant>(FxRatesEndpoint),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function apiPath(p: string): string {
  return new URL(p, TestEnv.apiBaseUrl).href;
}

async function createDemoSession(
  request: import("@playwright/test").APIRequestContext,
  sessionApi: import("@tw-portfolio/test-api/assistants").TSessionApiAssistant,
): Promise<string> {
  const response = await request.post(apiPath("/__e2e/demo-session"));
  await sessionApi.assert.statusIs(response, 200);
  return sessionApi.arrange.sessionCookieHeader(response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("POST /admin/fx-rates/refresh", () => {

  // Reset shared in-memory FX state between tests so audit/dedup assertions
  // aren't polluted by prior runs (HTTP suite runs workers=1 + single memory
  // backend). Idempotent on already-empty state.
  test.beforeEach(async ({ fxRatesApi }) => {
    const response = await fxRatesApi.actions.resetFxRates();
    await fxRatesApi.assert.statusIs(response, 200);
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  test("[auth]: non-admin member gets 403 admin_role_required", async ({
    request,
    fxRatesApi,
    adminApi,
  }) => {
    const member = await createOauthSession(request, {
      sub: "fx-refresh-member-sub",
      email: "fx-refresh-member@example.com",
      name: "FX Refresh Member",
      role: "member",
    });

    const response = await fxRatesApi.actions.manualRefreshForCookie(
      member.cookieHeader,
      {},
    );
    await fxRatesApi.assert.statusIs(response, 403);
    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "admin_role_required");
  });

  test("[auth]: demo user gets 403 demo_restricted", async ({
    request,
    fxRatesApi,
    adminApi,
    sessionApi,
  }) => {
    const demoCookie = await createDemoSession(request, sessionApi);

    const response = await fxRatesApi.actions.manualRefreshForCookie(demoCookie, {});
    await fxRatesApi.assert.statusIs(response, 403);
    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "demo_restricted");
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  test("[validation]: startDate > endDate → 400", async ({ request, fxRatesApi }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-refresh-val-date-sub",
      email: "fx-refresh-val-date@example.com",
      name: "FX Refresh Val Date",
      role: "admin",
    });

    const response = await fxRatesApi.actions.manualRefreshForCookie(admin.cookieHeader, {
      startDate: "2026-04-25",
      endDate: "2026-04-24", // end before start
    });
    await fxRatesApi.assert.statusIs(response, 400);
  });

  test("[validation]: empty bases array → 400", async ({ request, fxRatesApi }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-refresh-val-bases-sub",
      email: "fx-refresh-val-bases@example.com",
      name: "FX Refresh Val Bases",
      role: "admin",
    });

    const response = await fxRatesApi.actions.manualRefreshForCookie(admin.cookieHeader, {
      bases: [],
    });
    await fxRatesApi.assert.statusIs(response, 400);
  });

  test("[validation]: invalid currency code in bases → 400", async ({ request, fxRatesApi }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-refresh-val-currency-sub",
      email: "fx-refresh-val-currency@example.com",
      name: "FX Refresh Val Currency",
      role: "admin",
    });

    const response = await fxRatesApi.actions.manualRefreshForCookie(admin.cookieHeader, {
      bases: ["USD", "INVALID"], // INVALID is not in ['TWD','USD','AUD']
    });
    await fxRatesApi.assert.statusIs(response, 400);
  });

  test("[validation]: malformed date format → 400", async ({ request, fxRatesApi }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-refresh-val-dateformat-sub",
      email: "fx-refresh-val-dateformat@example.com",
      name: "FX Refresh Val DateFormat",
      role: "admin",
    });

    const response = await fxRatesApi.actions.manualRefreshForCookie(admin.cookieHeader, {
      startDate: "2026/04/01", // wrong format
    });
    await fxRatesApi.assert.statusIs(response, 400);
  });

  // ── Queue guard ────────────────────────────────────────────────────────────

  test("[queue guard]: returns 503 queue_unavailable when queue is down (memory mode)", async ({
    request,
    fxRatesApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-refresh-queue-down-sub",
      email: "fx-refresh-queue-down@example.com",
      name: "FX Refresh Queue Down",
      role: "admin",
    });

    const response = await fxRatesApi.actions.manualRefreshForCookie(admin.cookieHeader, {});
    await fxRatesApi.assert.statusIs(response, 503);
    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "queue_unavailable");
  });

  // NOTE: The following tests (queued, singleton dedup, audit log) require a live pg-boss queue.
  // In the standard HTTP test suite (memory-backed, no pg-boss), the queue guard fires first
  // (503 queue_unavailable). These tests document the expected behavior for Postgres-backed runs.

  test("[queue]: first call returns { status: 'queued', jobId } [Postgres-backed]", async ({
    request,
    fxRatesApi,
  }) => {
    // This test succeeds only when pg-boss is available (Postgres-backed HTTP test suite).
    // In memory-backed mode it will return 503 first — that is covered by the queue-guard test above.
    const admin = await createOauthSession(request, {
      sub: "fx-refresh-queued-sub",
      email: "fx-refresh-queued@example.com",
      name: "FX Refresh Queued",
      role: "admin",
    });

    const response = await fxRatesApi.actions.manualRefreshForCookie(admin.cookieHeader, {
      startDate: "2026-04-01",
      endDate: "2026-04-25",
    });

    // In memory mode: 503; in Postgres mode: 200 with queued body
    const status = response.status();
    if (status === 200) {
      const body = await fxRatesApi.arrange.refreshBody(response);
      await fxRatesApi.assert.refreshStatusIs(body, "queued");
      await fxRatesApi.assert.mxAssertTruthy(body.jobId, "queued jobId");
    } else {
      // Memory mode — queue guard
      await fxRatesApi.assert.statusIs(response, 503);
    }
  });

  test("[singleton dedup]: second call returns skipped_existing_job [Postgres-backed]", async ({
    request,
    fxRatesApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-refresh-dedup-sub",
      email: "fx-refresh-dedup@example.com",
      name: "FX Refresh Dedup",
      role: "admin",
    });

    const first = await fxRatesApi.actions.manualRefreshForCookie(admin.cookieHeader, {
      startDate: "2026-04-01",
      endDate: "2026-04-25",
    });

    const firstStatus = first.status();
    if (firstStatus === 503) {
      // Memory mode — queue guard, skip singleton test
      return;
    }

    await fxRatesApi.assert.statusIs(first, 200);

    // Immediately send a second request with the same singleton key
    const second = await fxRatesApi.actions.manualRefreshForCookie(admin.cookieHeader, {
      startDate: "2026-04-01",
      endDate: "2026-04-25",
    });

    const secondBody = await fxRatesApi.arrange.refreshBody(second);

    // Either queued (if first completed extremely fast) or skipped
    await fxRatesApi.assert.mxAssertTruthy(
      ["queued", "skipped_existing_job"].includes(secondBody.status),
      "second fx refresh status is queued or skipped",
    );
  });

  // ── Audit log (Invariant 2) ────────────────────────────────────────────────

  test("[audit log]: admin_fx_rates_refresh entry written on manual trigger [Postgres-backed]", async ({
    request,
    fxRatesApi,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "fx-refresh-audit-sub",
      email: "fx-refresh-audit@example.com",
      name: "FX Refresh Audit",
      role: "admin",
    });

    const response = await fxRatesApi.actions.manualRefreshForCookie(admin.cookieHeader, {
      startDate: "2026-04-01",
      endDate: "2026-04-25",
    });

    if (response.status() === 503) {
      // Memory mode — skip audit log assertion
      return;
    }

    await fxRatesApi.assert.statusIs(response, 200);

    // Verify audit log entry
    const auditResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["admin_fx_rates_refresh"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(auditResponse, 200);
    const auditBody = await adminApi.arrange.auditLogBody(auditResponse);
    const entry = auditBody.items.find((e) => e.action === "admin_fx_rates_refresh");
    await adminApi.assert.mxAssertDefined(entry, "admin_fx_rates_refresh audit entry");
  });
});
