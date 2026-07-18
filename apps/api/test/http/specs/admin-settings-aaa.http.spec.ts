import type { AiConnectorPolicySettingsDto } from "@vakwen/shared-types";
import { TestEnv } from "@vakwen/config/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const mcpAdminFreshAuthUrl = new URL("/admin/mcp/fresh-auth", TestEnv.apiBaseUrl).href;
const mcpAdminSettingsUrl = new URL("/admin/mcp/settings", TestEnv.apiBaseUrl).href;

test.describe("admin settings API (KZO-142)", () => {
  test("[admin settings]: GET /admin/settings as admin → 200 with AppConfigDto shape", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-get-shape-sub",
      email: "admin-settings-get-shape@example.com",
      name: "Admin Settings Get",
      role: "admin",
    });

    const response = await adminApi.actions.getAdminSettingsForCookie(admin.cookieHeader);
    await adminApi.assert.statusIs(response, 200);

    const body = await adminApi.arrange.appConfigBody(response);
    await adminApi.assert.appConfigShape(body);
  });

  test("[admin settings]: PATCH { 60 } → 200, value persists, updatedAt advances", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-patch-60-sub",
      email: "admin-settings-patch-60@example.com",
      name: "Admin Settings Patch",
      role: "admin",
    });

    const beforeResponse = await adminApi.actions.getAdminSettingsForCookie(admin.cookieHeader);
    await adminApi.assert.statusIs(beforeResponse, 200);
    const beforeBody = await adminApi.arrange.appConfigBody(beforeResponse);

    const patchResponse = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: 60 },
    );
    await adminApi.assert.statusIs(patchResponse, 200);
    const patchedBody = await adminApi.arrange.appConfigBody(patchResponse);
    await adminApi.assert.appConfigShape(patchedBody);
    await adminApi.assert.mxAssertEqual(patchedBody.repairCooldownMinutes, 60, "patched.repairCooldownMinutes");

    const followUp = await adminApi.actions.getAdminSettingsForCookie(admin.cookieHeader);
    await adminApi.assert.statusIs(followUp, 200);
    const followUpBody = await adminApi.arrange.appConfigBody(followUp);
    await adminApi.assert.mxAssertEqual(
      followUpBody.repairCooldownMinutes,
      60,
      "followUp.repairCooldownMinutes",
    );

    await adminApi.assert.mxAssertTruthy(
      Date.parse(patchedBody.updatedAt) > Date.parse(beforeBody.updatedAt),
      "updatedAt advanced after PATCH",
    );
  });

  test("[admin settings]: PATCH { null } → 200, repairCooldownMinutes=null, effective stays positive integer", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-patch-null-sub",
      email: "admin-settings-patch-null@example.com",
      name: "Admin Settings Null",
      role: "admin",
    });

    // Set a value first so the null-reset is observable
    const seedResponse = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: 120 },
    );
    await adminApi.assert.statusIs(seedResponse, 200);

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: null },
    );
    await adminApi.assert.statusIs(response, 200);
    const body = await adminApi.arrange.appConfigBody(response);
    await adminApi.assert.mxAssertNull(body.repairCooldownMinutes, "repairCooldownMinutes");
    await adminApi.assert.mxAssertTruthy(
      typeof body.effectiveRepairCooldownMinutes === "number"
        && Number.isInteger(body.effectiveRepairCooldownMinutes)
        && body.effectiveRepairCooldownMinutes > 0,
      "effectiveRepairCooldownMinutes falls back to env and is positive integer",
    );
  });

  test("[admin settings]: PATCH route cache TTL null reset validates against default, not previous value", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-route-cache-null-reset-sub",
      email: "admin-settings-route-cache-null-reset@example.com",
      name: "Admin Route Cache Null Reset",
      role: "admin",
    });

    const seedResponse = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      {
        routeCachePolicyMode: "custom",
        routeCacheDashboardPerformanceTtlMs: 900_000,
        routeCacheStaleUsableTtlMs: 900_000,
      },
    );
    await adminApi.assert.statusIs(seedResponse, 200);

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      {
        routeCacheDashboardPerformanceTtlMs: null,
        routeCacheStaleUsableTtlMs: 600_000,
      },
    );
    await adminApi.assert.statusIs(response, 200);
    const body = await adminApi.arrange.appConfigBody(response);
    await adminApi.assert.mxAssertNull(
      body.routeCacheDashboardPerformanceTtlMs,
      "routeCacheDashboardPerformanceTtlMs",
    );
    await adminApi.assert.mxAssertEqual(
      body.effectiveRouteCachePolicy.dashboardPerformanceTtlMs,
      300_000,
      "effectiveRouteCachePolicy.dashboardPerformanceTtlMs",
    );
  });

  test("[admin settings]: PATCH { 60 } twice in a row → second is no-op; exactly one audit delta", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-noop-sub",
      email: "admin-settings-noop@example.com",
      name: "Admin Settings NoOp",
      role: "admin",
    });

    // Prime state to null so the first PATCH(60) below is guaranteed to write
    // (and the second is guaranteed to be a no-op). Independent of whatever
    // shared memory state exists at test entry.
    const primeResponse = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: null },
    );
    await adminApi.assert.statusIs(primeResponse, 200);

    // Baseline audit count for this admin after priming.
    const baselineResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["app_config_updated"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(baselineResponse, 200);
    const baselineBody = await adminApi.arrange.auditLogBody(baselineResponse);
    const baselineCount = adminApi.arrange.countAuditEntriesByAction(
      baselineBody,
      "app_config_updated",
    );

    const firstPatch = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: 60 },
    );
    await adminApi.assert.statusIs(firstPatch, 200);

    const secondPatch = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: 60 },
    );
    await adminApi.assert.statusIs(secondPatch, 200);

    const afterResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["app_config_updated"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(afterResponse, 200);
    const afterBody = await adminApi.arrange.auditLogBody(afterResponse);
    const afterCount = adminApi.arrange.countAuditEntriesByAction(
      afterBody,
      "app_config_updated",
    );

    await adminApi.assert.mxAssertEqual(
      afterCount - baselineCount,
      1,
      "first PATCH(60) writes; second PATCH(60) is a no-op",
    );
  });

  test("[admin settings]: PATCH { 0 } → 400 (Zod min(1))", async ({ request, adminApi }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-zero-sub",
      email: "admin-settings-zero@example.com",
      name: "Admin Settings Zero",
      role: "admin",
    });

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: 0 },
    );
    await adminApi.assert.statusIs(response, 400);
  });

  test("[admin settings]: PATCH { -1 } → 400", async ({ request, adminApi }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-negative-sub",
      email: "admin-settings-negative@example.com",
      name: "Admin Settings Neg",
      role: "admin",
    });

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: -1 },
    );
    await adminApi.assert.statusIs(response, 400);
  });

  test("[admin settings]: PATCH { 10081 } → 400 (Zod max(10080))", async ({ request, adminApi }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-overmax-sub",
      email: "admin-settings-overmax@example.com",
      name: "Admin Settings Overmax",
      role: "admin",
    });

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: 10081 },
    );
    await adminApi.assert.statusIs(response, 400);
  });

  test("[admin settings]: PATCH { 1.5 } → 400 (Zod int())", async ({ request, adminApi }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-float-sub",
      email: "admin-settings-float@example.com",
      name: "Admin Settings Float",
      role: "admin",
    });

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { repairCooldownMinutes: 1.5 },
    );
    await adminApi.assert.statusIs(response, 400);
  });

  test("[admin MCP settings]: PATCH { postedTransactionMutationBatchLimit: 250 } → 200 and persists without hard cap rejection", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-mutation-batch-limit-sub",
      email: "admin-settings-mutation-batch-limit@example.com",
      name: "Admin Mutation Batch Limit",
      role: "admin",
    });

    const freshAuthResponse = await request.post(mcpAdminFreshAuthUrl, {
      headers: { cookie: admin.cookieHeader },
    });
    await adminApi.assert.statusIs(freshAuthResponse, 200);
    const freshAuth = await freshAuthResponse.json() as { freshAuthToken: string };
    const patchResponse = await request.patch(mcpAdminSettingsUrl, {
      headers: {
        cookie: admin.cookieHeader,
        "content-type": "application/json",
        "x-vakwen-fresh-auth-at": freshAuth.freshAuthToken,
      },
      data: { postedTransactionMutationBatchLimit: 250 },
    });
    await adminApi.assert.statusIs(patchResponse, 200);
    const patchedBody = await patchResponse.json() as AiConnectorPolicySettingsDto;
    await adminApi.assert.mxAssertEqual(
      patchedBody.postedTransactionMutationBatchLimit,
      250,
      "patched.postedTransactionMutationBatchLimit",
    );

    const followUp = await request.get(mcpAdminSettingsUrl, {
      headers: { cookie: admin.cookieHeader },
    });
    await adminApi.assert.statusIs(followUp, 200);
    const followUpBody = await followUp.json() as AiConnectorPolicySettingsDto;
    await adminApi.assert.mxAssertEqual(
      followUpBody.postedTransactionMutationBatchLimit,
      250,
      "followUp.postedTransactionMutationBatchLimit",
    );
  });

  test("[admin settings]: GET /admin/settings as member → 403 admin_role_required", async ({
    request,
    adminApi,
  }) => {
    const member = await createOauthSession(request, {
      sub: "admin-settings-member-get-sub",
      email: "admin-settings-member-get@example.com",
      name: "Member Get",
      role: "member",
    });

    const response = await adminApi.actions.getAdminSettingsForCookie(member.cookieHeader);
    await adminApi.assert.statusIs(response, 403);
    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "admin_role_required");
  });

  test("[admin settings]: PATCH /admin/settings as member → 403 admin_role_required", async ({
    request,
    adminApi,
  }) => {
    const member = await createOauthSession(request, {
      sub: "admin-settings-member-patch-sub",
      email: "admin-settings-member-patch@example.com",
      name: "Member Patch",
      role: "member",
    });

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      member.cookieHeader,
      { repairCooldownMinutes: 60 },
    );
    await adminApi.assert.statusIs(response, 403);
    const body = await adminApi.arrange.errorBody(response);
    await adminApi.assert.errorCodeIs(body, "admin_role_required");
  });

  // ── KZO-189: metadataEnrichmentMode PATCH tests ───────────────────────────

  test("[metadata-enrichment-A]: PATCH { metadataEnrichmentMode: 'unconditional' } → 200, DTO updated", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-meta-enrich-a-sub",
      email: "admin-settings-meta-enrich-a@example.com",
      name: "Admin Meta Enrichment A",
      role: "admin",
    });

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { metadataEnrichmentMode: "unconditional" },
    );
    await adminApi.assert.statusIs(response, 200);

    const body = await adminApi.arrange.appConfigBody(response);
    await adminApi.assert.appConfigShape(body);
    await adminApi.assert.mxAssertEqual(
      body.metadataEnrichmentMode,
      "unconditional",
      "metadataEnrichmentMode",
    );
    await adminApi.assert.mxAssertEqual(
      body.effectiveMetadataEnrichmentMode,
      "unconditional",
      "effectiveMetadataEnrichmentMode",
    );
  });

  test("[metadata-enrichment-B]: PATCH { metadataEnrichmentMode: 'conditional' } → 200, DTO updated", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-meta-enrich-b-sub",
      email: "admin-settings-meta-enrich-b@example.com",
      name: "Admin Meta Enrichment B",
      role: "admin",
    });

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { metadataEnrichmentMode: "conditional" },
    );
    await adminApi.assert.statusIs(response, 200);

    const body = await adminApi.arrange.appConfigBody(response);
    await adminApi.assert.appConfigShape(body);
    await adminApi.assert.mxAssertEqual(
      body.metadataEnrichmentMode,
      "conditional",
      "metadataEnrichmentMode",
    );
  });

  test("[metadata-enrichment-C]: PATCH { metadataEnrichmentMode: null } → 200, effectiveMetadataEnrichmentMode falls back to env", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-meta-enrich-c-sub",
      email: "admin-settings-meta-enrich-c@example.com",
      name: "Admin Meta Enrichment C",
      role: "admin",
    });

    // Set a value first so the null-reset is observable
    const seedResponse = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { metadataEnrichmentMode: "unconditional" },
    );
    await adminApi.assert.statusIs(seedResponse, 200);

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { metadataEnrichmentMode: null },
    );
    await adminApi.assert.statusIs(response, 200);

    const body = await adminApi.arrange.appConfigBody(response);
    await adminApi.assert.mxAssertNull(body.metadataEnrichmentMode, "metadataEnrichmentMode");
    await adminApi.assert.mxAssertTruthy(
      body.effectiveMetadataEnrichmentMode === "unconditional"
        || body.effectiveMetadataEnrichmentMode === "conditional",
      "effectiveMetadataEnrichmentMode falls back to env ('unconditional' | 'conditional')",
    );
  });

  test("[metadata-enrichment-D]: PATCH { metadataEnrichmentMode: 'foo' } → 400", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-meta-enrich-d-sub",
      email: "admin-settings-meta-enrich-d@example.com",
      name: "Admin Meta Enrichment D",
      role: "admin",
    });

    const response = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      // Cast to bypass TypeScript — we're intentionally sending an invalid value
      { metadataEnrichmentMode: "foo" as "unconditional" },
    );
    await adminApi.assert.statusIs(response, 400);
  });

  test("[metadata-enrichment-E]: PATCH 'unconditional' twice → second is no-op; exactly one audit delta", async ({
    request,
    adminApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-settings-meta-enrich-e-sub",
      email: "admin-settings-meta-enrich-e@example.com",
      name: "Admin Meta Enrichment E",
      role: "admin",
    });

    // Prime to null so the first PATCH(unconditional) is guaranteed to write
    const primeResponse = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { metadataEnrichmentMode: null },
    );
    await adminApi.assert.statusIs(primeResponse, 200);

    // Baseline audit count for this actor
    const baselineResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["app_config_updated"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(baselineResponse, 200);
    const baselineBody = await adminApi.arrange.auditLogBody(baselineResponse);
    const baselineCount = adminApi.arrange.countAuditEntriesByAction(
      baselineBody,
      "app_config_updated",
    );

    const firstPatch = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { metadataEnrichmentMode: "unconditional" },
    );
    await adminApi.assert.statusIs(firstPatch, 200);

    const secondPatch = await adminApi.actions.patchAdminSettingsForCookie(
      admin.cookieHeader,
      { metadataEnrichmentMode: "unconditional" },
    );
    await adminApi.assert.statusIs(secondPatch, 200);

    const afterResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["app_config_updated"],
      actorUserId: admin.userId,
    });
    await adminApi.assert.statusIs(afterResponse, 200);
    const afterBody = await adminApi.arrange.auditLogBody(afterResponse);
    const afterCount = adminApi.arrange.countAuditEntriesByAction(
      afterBody,
      "app_config_updated",
    );

    await adminApi.assert.mxAssertEqual(
      afterCount - baselineCount,
      1,
      "first PATCH(unconditional) writes audit entry; second PATCH(unconditional) is a no-op",
    );
  });
});
