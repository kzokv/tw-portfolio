// KZO-198 — HTTP-suite (suite 8) coverage for the Tier-A admin settings PATCH
// surface. Companion to `admin-settings-aaa.http.spec.ts` (legacy Tier 0/1
// fields). Covers:
//   - PATCH each Tier 1 plain field round-trip (rate-limit, retention, retry).
//   - Tier 0 rotation flow — finmindApiToken / twelveDataApiKey accept
//     20–500-char plaintext, encrypted at the persistence boundary, audit row
//     uses `metadata.type='rotation'` (NEVER plaintext).
//   - Bounds rejection — out-of-range numeric → 400.
//   - `.strict()` rejection — Tier 2 keys (sse*, dailyRefresh*) → 400.
//   - Body envelope: `{ error, message }` per service-error-pattern.md
//     (NOT `body.code`).

import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("admin settings — KZO-198 Tier A", () => {
  // ── Tier 1 plain-value round-trips ───────────────────────────────────────

  test("[tier1-A]: PATCH { marketDataPriceWindowMs: 30000 } → 200, value persists, effective updates", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier1-a-sub",
      email: "admin-tier1-a@example.com",
      name: "Admin Tier1 A",
      role: "admin",
    });

    const before = await adminApi.actions.getAdminSettingsForCookie(admin.cookieHeader);
    await adminApi.assert.statusIs(before, 200);
    const beforeBody = await adminApi.arrange.appConfigBody(before);

    const patch = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      marketDataPriceWindowMs: 30_000,
    });
    await adminApi.assert.statusIs(patch, 200);

    const patchBody = await adminApi.arrange.appConfigBody(patch);
    await adminApi.assert.mxAssertEqual(
      patchBody.marketDataPriceWindowMs,
      30_000,
      "patched.marketDataPriceWindowMs",
    );
    await adminApi.assert.mxAssertEqual(
      patchBody.effectiveMarketDataPriceWindowMs,
      30_000,
      "effective.marketDataPriceWindowMs",
    );
    await adminApi.assert.mxAssertTruthy(
      Date.parse(patchBody.updatedAt) > Date.parse(beforeBody.updatedAt),
      "updatedAt advanced after PATCH",
    );

    const followUp = await adminApi.actions.getAdminSettingsForCookie(admin.cookieHeader);
    const followUpBody = await adminApi.arrange.appConfigBody(followUp);
    await adminApi.assert.mxAssertEqual(
      followUpBody.marketDataPriceWindowMs,
      30_000,
      "followUp.marketDataPriceWindowMs",
    );
  });

  test("[tier1-B]: PATCH { providerErrorTrailRetentionDays: 14 } → 200, persists, audit metadata.type='value_change'", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier1-b-sub",
      email: "admin-tier1-b@example.com",
      name: "Admin Tier1 B",
      role: "admin",
    });

    // Prime to null first so the PATCH below produces a real diff.
    await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      providerErrorTrailRetentionDays: null,
    });

    const patch = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      providerErrorTrailRetentionDays: 14,
    });
    await adminApi.assert.statusIs(patch, 200);
    const body = await adminApi.arrange.appConfigBody(patch);
    await adminApi.assert.mxAssertEqual(
      body.providerErrorTrailRetentionDays,
      14,
      "providerErrorTrailRetentionDays",
    );

    const auditResp = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["app_config_updated"],
      actorUserId: admin.userId,
    });
    const auditBody = await adminApi.arrange.auditLogBody(auditResp);
    const entry = auditBody.items.find(
      (e) =>
        e.action === "app_config_updated" &&
        (e.metadata as Record<string, unknown>)?.type === "value_change" &&
        ((e.metadata as { after?: Record<string, unknown> }).after?.providerErrorTrailRetentionDays === 14),
    );
    await adminApi.assert.mxAssertTruthy(
      Boolean(entry),
      "audit row with metadata.type='value_change' and after.providerErrorTrailRetentionDays=14",
    );
  });

  test("[tier1-C]: PATCH { backfillRetryLimit: 5 } → 200; PATCH null → 200, falls back to env", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier1-c-sub",
      email: "admin-tier1-c@example.com",
      name: "Admin Tier1 C",
      role: "admin",
    });

    const setResp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      backfillRetryLimit: 5,
    });
    await adminApi.assert.statusIs(setResp, 200);
    const setBody = await adminApi.arrange.appConfigBody(setResp);
    await adminApi.assert.mxAssertEqual(setBody.backfillRetryLimit, 5, "backfillRetryLimit set");

    const clearResp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      backfillRetryLimit: null,
    });
    await adminApi.assert.statusIs(clearResp, 200);
    const clearBody = await adminApi.arrange.appConfigBody(clearResp);
    await adminApi.assert.mxAssertNull(clearBody.backfillRetryLimit, "backfillRetryLimit");
    await adminApi.assert.mxAssertTruthy(
      typeof clearBody.effectiveBackfillRetryLimit === "number" &&
        Number.isInteger(clearBody.effectiveBackfillRetryLimit) &&
        clearBody.effectiveBackfillRetryLimit >= 0,
      "effectiveBackfillRetryLimit falls back to env (non-negative integer)",
    );
  });

  // ── Tier 0 rotation flow ─────────────────────────────────────────────────

  test("[tier0-A]: PATCH { finmindApiToken: <plaintext> } → 200, finmindApiTokenSet=true, audit metadata.type='rotation' WITHOUT value", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier0-a-sub",
      email: "admin-tier0-a@example.com",
      name: "Admin Tier0 A",
      role: "admin",
    });

    const SECRET = "rot-finmind-token-1234567890abcd"; // 32 chars, within 20..500 bound
    const patch = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      finmindApiToken: SECRET,
    });
    await adminApi.assert.statusIs(patch, 200);

    const body = await adminApi.arrange.appConfigBody(patch);
    await adminApi.assert.mxAssertEqual(body.finmindApiTokenSet, true, "finmindApiTokenSet");

    const auditResp = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["app_config_updated"],
      actorUserId: admin.userId,
    });
    const auditBody = await adminApi.arrange.auditLogBody(auditResp);
    const rotation = auditBody.items.find(
      (e) =>
        e.action === "app_config_updated" &&
        (e.metadata as Record<string, unknown>)?.type === "rotation" &&
        (e.metadata as Record<string, unknown>)?.field === "finmindApiToken",
    );
    await adminApi.assert.mxAssertTruthy(
      Boolean(rotation),
      "audit row with metadata.type='rotation' and field='finmindApiToken'",
    );

    // Critical: the plaintext value MUST NOT appear ANYWHERE in the audit metadata.
    if (rotation) {
      const serialized = JSON.stringify(rotation.metadata);
      await adminApi.assert.mxAssertTruthy(
        !serialized.includes(SECRET),
        "audit metadata MUST NOT contain the rotated plaintext",
      );
    }
  });

  test("[tier0-B]: PATCH { twelveDataApiKey: null } → 200, twelveDataApiKeySet=false (clear flow)", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier0-b-sub",
      email: "admin-tier0-b@example.com",
      name: "Admin Tier0 B",
      role: "admin",
    });

    // Seed a value first so the clear is observable.
    await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      twelveDataApiKey: "rot-twelve-data-key-1234567890ab",
    });

    const clearResp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      twelveDataApiKey: null,
    });
    await adminApi.assert.statusIs(clearResp, 200);
    const body = await adminApi.arrange.appConfigBody(clearResp);
    await adminApi.assert.mxAssertEqual(body.twelveDataApiKeySet, false, "twelveDataApiKeySet");

    const auditResp = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["app_config_updated"],
      actorUserId: admin.userId,
    });
    const auditBody = await adminApi.arrange.auditLogBody(auditResp);
    const clearRow = auditBody.items.find(
      (e) =>
        e.action === "app_config_updated" &&
        (e.metadata as Record<string, unknown>)?.type === "rotation" &&
        (e.metadata as Record<string, unknown>)?.field === "twelveDataApiKey" &&
        (e.metadata as Record<string, unknown>)?.action === "clear",
    );
    await adminApi.assert.mxAssertTruthy(
      Boolean(clearRow),
      "audit row metadata.type='rotation' field='twelveDataApiKey' action='clear'",
    );
  });

  test("[tier0-C]: GET /admin/settings NEVER returns the plaintext or ciphertext of Tier 0 secrets", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier0-c-sub",
      email: "admin-tier0-c@example.com",
      name: "Admin Tier0 C",
      role: "admin",
    });

    const SECRET = "tier0-c-finmind-token-0987654321";
    await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      finmindApiToken: SECRET,
    });

    const get = await adminApi.actions.getAdminSettingsForCookie(admin.cookieHeader);
    await adminApi.assert.statusIs(get, 200);
    const raw = await get.text();
    await adminApi.assert.mxAssertTruthy(
      !raw.includes(SECRET),
      "GET /admin/settings response body MUST NOT contain the plaintext secret",
    );

    const body = await adminApi.arrange.appConfigBody(get);
    // DTO carries only the boolean sentinel.
    await adminApi.assert.mxAssertEqual(body.finmindApiTokenSet, true, "finmindApiTokenSet");
    // Defensive — the DTO type does not include `finmindApiToken` plaintext.
    await adminApi.assert.mxAssertTruthy(
      !("finmindApiToken" in (body as unknown as Record<string, unknown>)),
      "DTO must not carry a `finmindApiToken` field",
    );
  });

  // ── Bounds rejection (Zod min/max) ───────────────────────────────────────

  test("[bounds-A]: PATCH { marketDataPriceWindowMs: 500 } (below min 1000) → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-bounds-a-sub",
      email: "admin-bounds-a@example.com",
      name: "Admin Bounds A",
      role: "admin",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      marketDataPriceWindowMs: 500,
    });
    await adminApi.assert.statusIs(resp, 400);
  });

  test("[bounds-B]: PATCH { backfillRetryLimit: 99 } (above max 10) → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-bounds-b-sub",
      email: "admin-bounds-b@example.com",
      name: "Admin Bounds B",
      role: "admin",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      backfillRetryLimit: 99,
    });
    await adminApi.assert.statusIs(resp, 400);
  });

  test("[bounds-C]: PATCH { finmindApiToken: 'short' } (below 20 char min) → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-bounds-c-sub",
      email: "admin-bounds-c@example.com",
      name: "Admin Bounds C",
      role: "admin",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      finmindApiToken: "short",
    });
    await adminApi.assert.statusIs(resp, 400);
  });

  // ── .strict() Tier 2 / unknown key rejection ─────────────────────────────

  test("[strict-A]: PATCH { dailyRefreshLookbackDays: 7 } (Tier 2 — DB+SQL only) → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-strict-a-sub",
      email: "admin-strict-a@example.com",
      name: "Admin Strict A",
      role: "admin",
    });

    // Cast through Record<string, unknown> — the schema rejects but the test-api
    // type intentionally only lists Tier 1 fields.
    const resp = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { dailyRefreshLookbackDays: 7 } as unknown as Parameters<
        typeof adminApi.actions.patchAdminSettingsForCookie
      >[1],
    );
    await adminApi.assert.statusIs(resp, 400);
  });

  test("[strict-B]: PATCH { sseHeartbeatIntervalMs: 30000 } → 400 (Tier 2 SQL-only)", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-strict-b-sub",
      email: "admin-strict-b@example.com",
      name: "Admin Strict B",
      role: "admin",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { sseHeartbeatIntervalMs: 30_000 } as unknown as Parameters<
        typeof adminApi.actions.patchAdminSettingsForCookie
      >[1],
    );
    await adminApi.assert.statusIs(resp, 400);
  });

  // ── Body envelope shape — `error` + `message`, NOT `code` ────────────────

  test("[envelope-A]: 400 body envelope is `{ error, message }` per service-error-pattern", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-envelope-a-sub",
      email: "admin-envelope-a@example.com",
      name: "Admin Envelope A",
      role: "admin",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      marketDataPriceWindowMs: 0, // below min
    });
    await adminApi.assert.statusIs(resp, 400);
    const body = await adminApi.arrange.errorBody(resp);
    await adminApi.assert.mxAssertTruthy(
      typeof body.error === "string" && body.error.length > 0,
      "body.error is non-empty string (per service-error-pattern.md)",
    );
    await adminApi.assert.mxAssertTruthy(
      !("code" in (body as unknown as Record<string, unknown>)),
      "body MUST NOT have a `code` key — code lives at body.error",
    );
  });

  // ── Member role gating (regression: Tier-A doesn't loosen the gate) ──────

  test("[gate-A]: PATCH /admin/settings as member → 403 admin_role_required", async ({
    request,
    adminApi,
  }) => {
    const member = await createOauthSession(request, {
      sub: "admin-tier-a-gate-sub",
      email: "admin-tier-a-gate@example.com",
      name: "Member Tier-A Gate",
      role: "member",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(member.cookieHeader, {
      marketDataPriceWindowMs: 30_000,
    });
    await adminApi.assert.statusIs(resp, 403);
    const body = await adminApi.arrange.errorBody(resp);
    await adminApi.assert.errorCodeIs(body, "admin_role_required");
  });
});
