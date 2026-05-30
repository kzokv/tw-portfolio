import { test } from "@vakwen/test-e2e/fixtures/appPages";

test("[transactions settings]: rename account inline → selector shows renamed account with fee profile", async ({
  appShell,
  settings,
  transactions,
  page,
}) => {
  test.slow();
  await appShell.actions.navigateToRoute("/transactions");
  await transactions.actions.selectFirstAccount();
  await transactions.assert.selectedAccountOptionContains(/Main/i);

  // Phase 3d iter 2 — Accounts UI lives at /settings/accounts route.
  // KZO-179: AccountsListSection (which hosts the rename-account UI) is
  // mounted by AccountsSettingsClient on that route.
  await appShell.actions.openSettingsSection("accounts");

  await settings.assert.accountNameLabelContains(/Main/i);
  await page.getByTestId("account-rename-icon").first().click();
  await page.getByTestId("account-name-input").fill("Primary Renamed");

  const renameResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/accounts/acc-1") &&
      response.ok(),
  );
  await page.getByTestId("account-rename-save").click();
  await renameResponse;

  await settings.assert.accountNameLabelContains("Primary Renamed");

  await page.getByTestId("account-rename-icon").first().click();
  await page.getByTestId("account-name-input").fill("Should Not Persist");
  await page.getByTestId("account-rename-cancel").click();

  await settings.assert.accountNameLabelContains("Primary Renamed");

  // Phase 3d iter 2 — navigate back to /transactions to verify the rename
  // propagated to the account selector. (Escape no longer "closes a drawer"
  // — it has no effect on /settings/* routes.)
  await appShell.actions.navigateToRoute("/transactions");
  await transactions.assert.selectedAccountOptionContains(/Primary Renamed/);
  await transactions.assert.selectedAccountOptionContains(/Default Broker/i);
});
