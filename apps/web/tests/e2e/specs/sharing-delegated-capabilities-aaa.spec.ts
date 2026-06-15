import { test } from "@vakwen/test-e2e/fixtures/appPages";
import {
  seedAccountForUser,
  seedPendingShareFromAdmin,
  seedResolvedShareFromAdmin,
  seedUser,
  switchIdentity,
  updateActiveShareCapabilities,
} from "./helpers/sharing";

test.describe("sharing delegated capabilities", () => {
  test("[sharing permissions]: owner edits active and pending delegated permissions", async ({
    appShell,
    page,
    sharing,
    testUser,
  }) => {
    const grantee = await seedUser({
      sub: "e2e-delegated-permissions-grantee-sub",
      email: "delegated-permissions-grantee@example.com",
      name: "Delegated Permissions Grantee",
      role: "viewer",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, testUser.userId);
    await updateActiveShareCapabilities(shareId, testUser.userId, ["portfolio:mcp_read"]);
    const pending = await seedPendingShareFromAdmin(
      "delegated-permissions-pending@example.com",
      testUser.userId,
      ["portfolio:mcp_read"],
    );

    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();

    await page.getByTestId(`sharing-edit-permissions-${shareId}`).click();
    await appShell.assert.mxAssertTruthy(
      await page.getByTestId("edit-share-permissions-dialog").isVisible(),
      "edit share permissions dialog is visible",
    );
    await page.getByTestId("edit-share-capability-account:manage").click();
    await page.getByTestId("edit-share-capability-transaction:write").click();
    await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === "PATCH"
        && response.url().includes(`/shares/${shareId}/capabilities`)
        && response.ok(),
      ),
      page.getByTestId("edit-share-permissions-save").click(),
    ]);
    await page.getByTestId("edit-share-permissions-dialog").waitFor({ state: "hidden" });
    const activeRowText = await page.getByTestId(`sharing-outbound-row-${shareId}`).textContent();
    await appShell.assert.mxAssertTruthy(
      /Manage accounts and fee settings/.test(activeRowText ?? ""),
      "active share row shows account manage capability",
    );
    await appShell.assert.mxAssertTruthy(
      /Create, edit, and delete transactions/.test(activeRowText ?? ""),
      "active share row shows transaction write capability",
    );

    await page.getByTestId(`sharing-edit-permissions-${pending.inviteCode}`).scrollIntoViewIfNeeded();
    await page.getByTestId(`sharing-edit-permissions-${pending.inviteCode}`).click();
    await page.getByTestId("edit-share-capability-account:manage").click();
    await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === "PATCH"
        && response.url().includes(`/shares/pending/${pending.inviteCode}/capabilities`)
        && response.ok(),
      ),
      page.getByTestId("edit-share-permissions-save").click(),
    ]);
    const pendingRowText = await page.getByTestId(`sharing-outbound-row-${pending.inviteCode}`).textContent();
    await appShell.assert.mxAssertTruthy(
      /Manage accounts and fee settings/.test(pendingRowText ?? ""),
      "pending share row shows account manage capability",
    );
  });

  test("[shared transactions]: transaction form is gated by transaction:write", async ({
    appShell,
    page,
    sharing,
    testUser,
    transactions,
  }) => {
    const grantee = await seedUser({
      sub: "e2e-shared-transaction-grantee-sub",
      email: "shared-transaction-grantee@example.com",
      name: "Shared Transaction Grantee",
      role: "viewer",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, testUser.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "viewer" });
    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await appShell.assert.appIsReady();

    await transactions.actions.navigateToTransactions();
    await transactions.assert.readOnlyMessageIsVisible();

    await updateActiveShareCapabilities(shareId, testUser.userId, ["transaction:write"]);
    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await appShell.assert.appIsReady();

    await transactions.actions.navigateToTransactions();
    await appShell.assert.mxAssertTruthy(
      await page.getByTestId("tx-submit-button").isVisible(),
      "transaction submit button is visible with transaction:write",
    );
  });

  test("[shared accounts]: account management is gated by account:manage and never exposes hard purge", async ({
    appShell,
    page,
    settings,
    sharing,
    testUser,
  }) => {
    const account = await seedAccountForUser(testUser.userId, {
      name: "Delegated Account Scope",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const grantee = await seedUser({
      sub: "e2e-shared-account-grantee-sub",
      email: "shared-account-grantee@example.com",
      name: "Shared Account Grantee",
      role: "viewer",
    });
    const { shareId } = await seedResolvedShareFromAdmin(grantee.email, testUser.userId);

    await switchIdentity(page, { userId: grantee.userId, role: "viewer" });
    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await appShell.assert.appIsReady();

    await appShell.actions.openSettingsSection("accounts");
    await settings.assert.accountCreateFormIsVisible();
    await appShell.assert.mxAssertTruthy(
      await page.getByTestId("account-create-name-input").isDisabled(),
      "account create name input is disabled without account:manage",
    );
    await appShell.assert.mxAssertTruthy(
      await page.getByTestId(`account-delete-btn-${account.id}`).isDisabled(),
      "account delete button is disabled without account:manage",
    );

    await updateActiveShareCapabilities(shareId, testUser.userId, ["account:manage"]);
    await sharing.actions.navigateToSharing();
    await appShell.assert.appIsReady();
    await page.getByTestId(`sharing-open-dashboard-${shareId}`).click();
    await appShell.assert.appIsReady();

    await appShell.actions.openSettingsSection("accounts");
    await settings.assert.accountCreateFormIsVisible();
    await settings.actions.fillAccountCreateName("Delegated Created Account");
    await appShell.assert.mxAssertTruthy(
      await page.getByTestId("account-create-submit").isEnabled(),
      "account create submit is enabled with account:manage",
    );
    await settings.assert.accountDeleteButtonIsVisible(account.id);

    await settings.actions.clickAccountDeleteButton(account.id);
    await settings.assert.softDeleteModalIsVisible();
    await settings.actions.confirmSoftDelete();
    await settings.assert.recentlyDeletedRowIsVisible(account.id);
    await settings.assert.recentlyDeletedRestoreButtonIsVisible(account.id);
    await appShell.assert.mxAssertEqual(
      await page.getByTestId(`recently-deleted-purge-btn-${account.id}`).count(),
      0,
      "hard purge is hidden in shared account-management context",
    );
  });
});
