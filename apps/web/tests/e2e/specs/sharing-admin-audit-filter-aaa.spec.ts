import { test } from "@vakwen/test-e2e/fixtures/appPages";
import { seedResolvedShareFromAdmin, seedUser } from "./helpers/sharing";

test.describe("admin audit log — sharing filter", () => {
  test("[admin audit]: Sharing group filter surfaces share_granted entries", async ({
    appShell,
  }) => {
    const grantee = await seedUser({
      sub: "e2e-audit-filter-grantee-sub",
      email: "audit-filter-grantee@example.com",
      name: "Audit Filter Grantee",
      role: "viewer",
    });
    await seedResolvedShareFromAdmin(grantee.email);

    await appShell.actions.navigateToRoute("/admin/audit-log");
    await appShell.assert.adminAuditLogPageIsVisible();

    await appShell.actions.clickAdminAuditToggleFilters();
    await appShell.actions.clickAdminAuditActionFilter("share_granted");

    await appShell.assert.adminAuditLogTableContains("Granted share");
    await appShell.assert.adminAuditLogTableContains(grantee.email);
  });
});
