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

  await appShell.actions.openSettingsDrawer();
  // KZO-179: AccountsListSection (which hosts the rename-account UI)
  // relocated from Fees → Accounts tab per scope-todo D1.
  await settings.arrange.openAccountsTab();

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

  await settings.actions.closeWithEscape();
  await transactions.assert.selectedAccountOptionContains(/Primary Renamed/);
  await transactions.assert.selectedAccountOptionContains(/Default Broker/i);
});
