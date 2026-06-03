import { test } from "@vakwen/test-e2e/fixtures/appPages";

// In dev_bypass mode, user-1 is auto-created with admin role.
// The base fixture sets tw_e2e_user identity cookie and seeds portfolio data.
// Admin pages are accessible because the default E2E user resolves as admin.
test.describe.configure({ timeout: 60_000 });

test.describe("admin portal — page access", () => {
  test("admin user: /admin renders overview", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin");
    await appShell.assert.pageContainsText("Operator status");
  });

  test("admin user: /admin/users renders user list table", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin/users");
    await appShell.assert.adminUsersPageIsVisible();
    await appShell.assert.adminUsersTableIsVisible();
  });

  test("admin user: /admin/invites renders invite list", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin/invites");
    await appShell.assert.adminInvitesPageIsVisible();
    await appShell.assert.adminInvitesTableIsVisible();
  });

  test("admin user: /admin/audit-log renders audit log table", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin/audit-log");
    await appShell.assert.adminAuditLogPageIsVisible();
    await appShell.assert.adminAuditLogTableIsVisible();
  });
});

test.describe("admin portal — self-operation guard", () => {
  test("admin users page: own row shows '(you)' badge", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin/users");
    await appShell.assert.adminUsersPageIsVisible();
    await appShell.assert.adminYouBadgeIsVisible();
  });

  test("admin users page: action buttons disabled on own row", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin/users");
    await appShell.assert.adminUsersPageIsVisible();
    await appShell.assert.adminYouBadgeIsVisible();
    await appShell.assert.adminOwnRowHasDisabledActions();
  });
});

test.describe("admin portal — user management UI", () => {
  test("admin creates invite → new row in invite list", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin/invites");
    await appShell.assert.adminInvitesPageIsVisible();

    await appShell.actions.fillAdminInviteForm("new-invitee@example.com", "member");
    await appShell.actions.submitAdminInviteForm();

    await appShell.assert.adminInviteFormSuccessIsVisible();
    await appShell.assert.pageContainsText("new-invitee@example.com");
  });

  test("admin revokes pending invite → invite status changes to 'revoked'", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin/invites");
    await appShell.assert.adminInvitesPageIsVisible();

    // Create an invite first
    await appShell.actions.fillAdminInviteForm("to-revoke@example.com", "viewer");
    await appShell.actions.submitAdminInviteForm();
    await appShell.assert.adminInviteFormSuccessIsVisible();

    // Revoke it
    await appShell.actions.clickFirstRevokeButton();
    await appShell.assert.adminConfirmDialogIsVisible();
    await appShell.actions.confirmDialog();

    await appShell.assert.adminInviteStatusBadgeIsVisible("revoked");
  });
});

test.describe("admin portal — audit log UI", () => {
  test("admin audit log page loads with entries", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/admin/audit-log");
    await appShell.assert.adminAuditLogPageIsVisible();
    await appShell.assert.adminAuditLogTableIsVisible();
  });
});

test.describe("admin portal — avatar menu admin link", () => {
  test("admin user sees 'Admin' link in avatar dropdown", async ({ appShell }) => {
    await appShell.actions.navigateToRoute("/dashboard");
    await appShell.assert.appIsReady();
    await appShell.actions.openAvatarMenu();
    await appShell.assert.avatarMenuAdminLinkIsVisible();
  });
});

// FIXME: KZO-144 — multi-user invite redemption E2E requires mock OAuth infrastructure.
// The full flow (admin creates invite → copies URL → second browser redeems via OAuth)
// is deferred. Invite creation/revocation are tested above; invite redemption is covered
// by existing invites.integration.test.ts at the API level.

// FIXME: KZO-144 — non-admin layout guard E2E requires OAuth mode.
// In dev_bypass mode, the default user-1 always resolves as admin. The admin layout
// redirect (non-admin → /dashboard) requires a non-admin user whose role is stored in DB
// and returned by GET /profile during SSR. This is only testable in specs-oauth/ with a
// real OAuth session for a member-role user. API-level 403 enforcement for admin GET
// endpoints is covered in admin-user-management.test.ts ("admin GET endpoints — role enforcement").
