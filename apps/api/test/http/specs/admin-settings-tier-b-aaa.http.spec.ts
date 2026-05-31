// KZO-199 — HTTP-suite (suite 8) coverage for the Tier-B admin settings PATCH surface.
//
// Covers:
//   - PATCH each Tier-1 sharing field round-trip (anonymousShareTokenCap,
//     anonymousShareRateLimitMax, anonymousShareRateLimitWindowMs).
//   - Audit log entry: metadata.type='value_change' with before/after.
//   - Bounds rejection: `anonymousShareTokenCap=0` (below min 1) → 400.
//   - Bounds rejection: `anonymousShareTokenCap=1001` (above max 1000) → 400.
//   - Body envelope: `{ error, message }` per service-error-pattern.md (NOT `body.code`).
//   - Tier-2 fields (anonymousShareTokenRetentionMs, userPreferencesMaxBytes) are
//     NOT accepted by PATCH and must be rejected with 400 (`.strict()` schema).

import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

test.describe("admin settings — KZO-199 Tier B", () => {
  // KZO-199: reset sharing knobs to env-default after each test so subsequent
  // HTTP specs (anon-token-create-cap-429, anon-public-view-rate-limit) see
  // the env-default cap of 20 rather than a value bled in from the prior test.
  // Without this, the post-tier-b state holds a non-default cap (e.g. 8) and
  // any downstream test that seeds tokens for an unrelated owner gets
  // surprised by `cap_exceeded`.
  test.afterEach(async ({ request, adminApi }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-cleanup-sub",
      email: "admin-tier-b-cleanup@example.com",
      name: "Admin Tier-B Cleanup",
      role: "admin",
    });
    await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenCap: null,
      anonymousShareRateLimitMax: null,
      anonymousShareRateLimitWindowMs: null,
    });
  });

  // ── Tier 1 sharing field round-trips ─────────────────────────────────────

  test("[tier-b-1]: PATCH { anonymousShareTokenCap: 10 } → 200, persists, effective updates", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-1-sub",
      email: "admin-tier-b-1@example.com",
      name: "Admin Tier-B 1",
      role: "admin",
    });

    // Prime to null so the PATCH produces a real diff.
    await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenCap: null,
    });

    const before = await adminApi.actions.getAdminSettingsForCookie(admin.cookieHeader);
    await adminApi.assert.statusIs(before, 200);
    const beforeBody = await adminApi.arrange.appConfigBody(before);

    const patch = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenCap: 10,
    });
    await adminApi.assert.statusIs(patch, 200);

    const patchBody = await adminApi.arrange.appConfigBody(patch);
    await adminApi.assert.mxAssertEqual(
      (patchBody as unknown as Record<string, unknown>)["anonymousShareTokenCap"],
      10,
      "patched.anonymousShareTokenCap",
    );
    await adminApi.assert.mxAssertTruthy(
      typeof (patchBody as unknown as Record<string, unknown>)["effectiveAnonymousShareTokenCap"] ===
        "number",
      "effectiveAnonymousShareTokenCap is a number",
    );
    await adminApi.assert.mxAssertEqual(
      (patchBody as unknown as Record<string, unknown>)["effectiveAnonymousShareTokenCap"],
      10,
      "effective.anonymousShareTokenCap",
    );
    await adminApi.assert.mxAssertTruthy(
      Date.parse(patchBody.updatedAt) > Date.parse(beforeBody.updatedAt),
      "updatedAt advanced after PATCH",
    );

    const followUp = await adminApi.actions.getAdminSettingsForCookie(admin.cookieHeader);
    const followUpBody = await adminApi.arrange.appConfigBody(followUp);
    await adminApi.assert.mxAssertEqual(
      (followUpBody as unknown as Record<string, unknown>)["anonymousShareTokenCap"],
      10,
      "followUp.anonymousShareTokenCap",
    );
  });

  test("[tier-b-2]: PATCH { anonymousShareRateLimitMax: 50 } → 200, persists", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-2-sub",
      email: "admin-tier-b-2@example.com",
      name: "Admin Tier-B 2",
      role: "admin",
    });

    const patch = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareRateLimitMax: 50,
    });
    await adminApi.assert.statusIs(patch, 200);

    const body = await adminApi.arrange.appConfigBody(patch);
    await adminApi.assert.mxAssertEqual(
      (body as unknown as Record<string, unknown>)["anonymousShareRateLimitMax"],
      50,
      "anonymousShareRateLimitMax",
    );
    await adminApi.assert.mxAssertTruthy(
      typeof (body as unknown as Record<string, unknown>)["effectiveAnonymousShareRateLimitMax"] ===
        "number",
      "effectiveAnonymousShareRateLimitMax is a number",
    );
  });

  test("[tier-b-3]: PATCH { anonymousShareRateLimitWindowMs: 120000 } → 200, persists", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-3-sub",
      email: "admin-tier-b-3@example.com",
      name: "Admin Tier-B 3",
      role: "admin",
    });

    const patch = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareRateLimitWindowMs: 120_000,
    });
    await adminApi.assert.statusIs(patch, 200);

    const body = await adminApi.arrange.appConfigBody(patch);
    await adminApi.assert.mxAssertEqual(
      (body as unknown as Record<string, unknown>)["anonymousShareRateLimitWindowMs"],
      120_000,
      "anonymousShareRateLimitWindowMs",
    );
  });

  test("[tier-b-4]: PATCH { anonymousShareTokenCap: null } → 200, effectiveAnonymousShareTokenCap falls back to env", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-4-sub",
      email: "admin-tier-b-4@example.com",
      name: "Admin Tier-B 4",
      role: "admin",
    });

    // Set a value first so the null-reset is observable.
    await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenCap: 15,
    });

    const patch = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenCap: null,
    });
    await adminApi.assert.statusIs(patch, 200);

    const body = await adminApi.arrange.appConfigBody(patch);
    await adminApi.assert.mxAssertNull(
      (body as unknown as Record<string, unknown>)["anonymousShareTokenCap"],
      "anonymousShareTokenCap raw is null",
    );
    await adminApi.assert.mxAssertTruthy(
      typeof (body as unknown as Record<string, unknown>)["effectiveAnonymousShareTokenCap"] ===
        "number" &&
        Number.isInteger(
          (body as unknown as Record<string, unknown>)["effectiveAnonymousShareTokenCap"] as number,
        ) &&
        ((body as unknown as Record<string, unknown>)["effectiveAnonymousShareTokenCap"] as number) > 0,
      "effectiveAnonymousShareTokenCap falls back to env and is positive integer",
    );
  });

  // ── Audit log — value_change discriminator ────────────────────────────────

  test("[tier-b-5]: PATCH { anonymousShareTokenCap: 8 } → audit log has metadata.type='value_change'", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-5-sub",
      email: "admin-tier-b-5@example.com",
      name: "Admin Tier-B 5",
      role: "admin",
    });

    // Prime to null so the next PATCH produces a real write.
    await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenCap: null,
    });

    await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenCap: 8,
    });

    const auditResp = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["app_config_updated"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(auditResp, 200);
    const auditBody = await adminApi.arrange.auditLogBody(auditResp);

    const entry = auditBody.items.find(
      (e) =>
        e.action === "app_config_updated" &&
        (e.metadata as Record<string, unknown>)?.type === "value_change" &&
        ((e.metadata as { after?: Record<string, unknown> }).after
          ?.anonymousShareTokenCap === 8),
    );
    await adminApi.assert.mxAssertTruthy(
      Boolean(entry),
      "audit row with metadata.type='value_change' and after.anonymousShareTokenCap=8",
    );
  });

  // ── Bounds rejection ──────────────────────────────────────────────────────

  test("[tier-b-bounds-A]: PATCH { anonymousShareTokenCap: 0 } (below min 1) → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-bounds-a-sub",
      email: "admin-tier-b-bounds-a@example.com",
      name: "Admin Tier-B Bounds A",
      role: "admin",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenCap: 0,
    });
    await adminApi.assert.statusIs(resp, 400);
    // Per service-error-pattern.md: assert body.error (NOT body.code).
    const body = await adminApi.arrange.errorBody(resp);
    await adminApi.assert.mxAssertTruthy(
      typeof body.error === "string" && body.error.length > 0,
      "error body has string `error` field (not `code`)",
    );
  });

  test("[tier-b-bounds-B]: PATCH { anonymousShareTokenCap: 1001 } (above max 1000) → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-bounds-b-sub",
      email: "admin-tier-b-bounds-b@example.com",
      name: "Admin Tier-B Bounds B",
      role: "admin",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenCap: 1001,
    });
    await adminApi.assert.statusIs(resp, 400);
    const body = await adminApi.arrange.errorBody(resp);
    await adminApi.assert.mxAssertTruthy(
      typeof body.error === "string" && body.error.length > 0,
      "error body has string `error` field (not `code`)",
    );
  });

  test("[tier-b-bounds-C]: PATCH { anonymousShareRateLimitWindowMs: 500 } (below min 1000) → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-bounds-c-sub",
      email: "admin-tier-b-bounds-c@example.com",
      name: "Admin Tier-B Bounds C",
      role: "admin",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareRateLimitWindowMs: 500,
    });
    await adminApi.assert.statusIs(resp, 400);
  });

  // ── Strict schema rejects Tier-2 fields ──────────────────────────────────

  test("[tier-b-strict-A]: PATCH { anonymousShareTokenRetentionMs: 86400001 } (Tier-2, not in schema) → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-strict-a-sub",
      email: "admin-tier-b-strict-a@example.com",
      name: "Admin Tier-B Strict A",
      role: "admin",
    });

    // Tier-2 field not in TPatchAdminSettingsBody — cast through unknown
    // (documented pattern, see AdminEndpoint.ts comment on TPatchAdminSettingsBody).
    const resp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      anonymousShareTokenRetentionMs: 86_400_001,
    } as unknown as Parameters<typeof adminApi.actions.patchAdminSettingsForCookie>[1]);
    await adminApi.assert.statusIs(resp, 400);
  });

  test("[tier-b-strict-B]: PATCH { userPreferencesMaxBytes: 4096 } (Tier-2, not in schema) → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-tier-b-strict-b-sub",
      email: "admin-tier-b-strict-b@example.com",
      name: "Admin Tier-B Strict B",
      role: "admin",
    });

    const resp = await adminApi.actions.patchAdminSettingsForCookie(admin.cookieHeader, {
      userPreferencesMaxBytes: 4096,
    } as unknown as Parameters<typeof adminApi.actions.patchAdminSettingsForCookie>[1]);
    await adminApi.assert.statusIs(resp, 400);
  });
});
