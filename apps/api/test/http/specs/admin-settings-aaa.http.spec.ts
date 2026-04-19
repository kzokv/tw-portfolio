import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

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
});
