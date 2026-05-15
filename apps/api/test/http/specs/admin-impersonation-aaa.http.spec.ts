import { TestEnv } from "@vakwen/config/test";
import { extractCookieValue } from "@vakwen/test-framework/shared";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const IMPERSONATION_COOKIE_NAME = "g_impersonation";

function apiPath(path: string): string {
  return new URL(path, TestEnv.apiBaseUrl).href;
}

function extractImpersonationCookieValue(setCookieHeader: string): string {
  const cookieValue = extractCookieValue(setCookieHeader, IMPERSONATION_COOKIE_NAME);
  if (!cookieValue) {
    throw new Error(`Impersonation cookie "${IMPERSONATION_COOKIE_NAME}" missing from Set-Cookie header`);
  }
  return cookieValue;
}

function combinedCookieHeader(sessionCookieHeader: string, impersonationCookieValue: string): string {
  return `${sessionCookieHeader}; ${IMPERSONATION_COOKIE_NAME}=${impersonationCookieValue}`;
}

test.describe("admin impersonation HTTP contract", () => {
  test("[admin impersonation]: start → session-scoped reads stay admin, store reads switch target, writes block, exit clears cookie", async ({
    request,
    adminApi,
    profileApi,
    settingsApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "admin-impersonation-admin-sub",
      email: "admin-impersonation-admin@example.com",
      name: "Admin Impersonation Admin",
      role: "admin",
    });
    const target = await createOauthSession(request, {
      sub: "admin-impersonation-target-sub",
      email: "admin-impersonation-target@example.com",
      name: "Admin Impersonation Target",
      role: "member",
    });

    const startResponse = await request.post(apiPath(`/admin/users/${target.userId}/impersonate`), {
      headers: { cookie: admin.cookieHeader },
      data: {},
    });
    await adminApi.assert.statusIs(startResponse, 200);

    const startBody = await startResponse.json() as { expiresAt: string; targetEmail: string | null };
    await adminApi.assert.mxAssertEqual(startBody.targetEmail, target.email, "start.targetEmail");

    const impersonationCookieValue = extractImpersonationCookieValue(
      startResponse.headers()["set-cookie"] ?? "",
    );
    const impersonatingCookie = combinedCookieHeader(admin.cookieHeader, impersonationCookieValue);

    const settingsResponse = await settingsApi.actions.getSettingsForCookie(impersonatingCookie);
    await settingsApi.assert.statusIs(settingsResponse, 200);
    const settingsBody = await settingsApi.arrange.settingsBody(settingsResponse);
    await settingsApi.assert.fieldEquals(settingsBody, "userId", target.userId);

    const profileResponse = await profileApi.actions.getProfileForCookie(impersonatingCookie);
    await profileApi.assert.statusIs(profileResponse, 200);
    const profileBody = await profileApi.arrange.profileBody(profileResponse);
    await profileApi.assert.hasShape(profileBody);
    await profileApi.assert.fieldEquals(profileBody, "userId", admin.userId);
    await profileApi.assert.fieldEquals(profileBody, "email", admin.email);
    await profileApi.assert.mxAssertDeepEqual(profileBody.impersonation, {
      active: true,
      targetUserId: target.userId,
      targetEmail: target.email,
      expiresAt: startBody.expiresAt,
    });

    const blockedWrite = await request.patch(apiPath("/profile"), {
      headers: { cookie: impersonatingCookie },
      data: { email: "blocked-while-impersonating@example.com" },
    });
    await profileApi.assert.statusIs(blockedWrite, 403);
    await adminApi.assert.errorCodeIs(
      await blockedWrite.json() as { error: string },
      "impersonation_write_blocked",
    );

    const auditResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["impersonation_start", "impersonation_blocked_write"],
      targetUserId: target.userId,
    });
    await adminApi.assert.statusIs(auditResponse, 200);
    const auditBody = await adminApi.arrange.auditLogBody(auditResponse);
    const startEntry = auditBody.items.find((entry) => entry.action === "impersonation_start");
    const blockedEntry = auditBody.items.find((entry) => entry.action === "impersonation_blocked_write");
    await adminApi.assert.mxAssertDefined(startEntry, "impersonation_start audit entry");
    await adminApi.assert.mxAssertDefined(blockedEntry, "impersonation_blocked_write audit entry");
    await adminApi.assert.mxAssertEqual(startEntry?.metadata.targetEmail, target.email, "impersonation_start.targetEmail");
    await adminApi.assert.mxAssertEqual(blockedEntry?.metadata.method, "PATCH", "impersonation_blocked_write.method");
    await adminApi.assert.mxAssertEqual(blockedEntry?.metadata.path, "/profile", "impersonation_blocked_write.path");

    const exitResponse = await request.delete(apiPath("/admin/impersonation"), {
      headers: { cookie: impersonatingCookie },
    });
    await adminApi.assert.statusIs(exitResponse, 204);
    const exitSetCookieHeader = exitResponse.headers()["set-cookie"] ?? "";
    await adminApi.assert.mxAssertIncludes(exitSetCookieHeader, `${IMPERSONATION_COOKIE_NAME}=;`, "exit set-cookie");
    await adminApi.assert.mxAssertIncludes(exitSetCookieHeader, "Max-Age=0", "exit set-cookie");

    const profileAfterExit = await profileApi.actions.getProfileForCookie(admin.cookieHeader);
    await profileApi.assert.statusIs(profileAfterExit, 200);
    const profileAfterExitBody = await profileApi.arrange.profileBody(profileAfterExit);
    await profileApi.assert.mxAssertNull(profileAfterExitBody.impersonation, "profile.impersonation after exit");

    const exitAuditResponse = await adminApi.actions.listAuditLogForCookie(admin.cookieHeader, {
      action: ["impersonation_end"],
      targetUserId: target.userId,
    });
    await adminApi.assert.statusIs(exitAuditResponse, 200);
    const exitAuditBody = await adminApi.arrange.auditLogBody(exitAuditResponse);
    const exitEntry = exitAuditBody.items.find(
      (entry) => entry.action === "impersonation_end" && entry.metadata.reason === "manual",
    );
    await adminApi.assert.mxAssertDefined(exitEntry, "manual impersonation_end audit entry");
  });

  test("[impersonation session helper]: __e2e endpoint mints cookie that activates target context", async ({
    request,
    settingsApi,
  }) => {
    const admin = await createOauthSession(request, {
      sub: "helper-admin-sub",
      email: "helper-admin@example.com",
      name: "Helper Admin",
      role: "admin",
    });
    const target = await createOauthSession(request, {
      sub: "helper-target-sub",
      email: "helper-target@example.com",
      name: "Helper Target",
      role: "member",
    });

    const helperResponse = await request.post(apiPath("/__e2e/impersonation-session"), {
      data: {
        adminUserId: admin.userId,
        targetUserId: target.userId,
        ttlMinutes: 1,
      },
    });
    await settingsApi.assert.statusIs(helperResponse, 200);

    const impersonationCookieValue = extractImpersonationCookieValue(
      helperResponse.headers()["set-cookie"] ?? "",
    );
    const impersonatingCookie = combinedCookieHeader(admin.cookieHeader, impersonationCookieValue);

    const settingsResponse = await settingsApi.actions.getSettingsForCookie(impersonatingCookie);
    await settingsApi.assert.statusIs(settingsResponse, 200);
    const settingsBody = await settingsApi.arrange.settingsBody(settingsResponse);
    await settingsApi.assert.fieldEquals(settingsBody, "userId", target.userId);
  });
});
