import { feeProfilePayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

test.describe("accounts", () => {
  test("lists seeded accounts and allows PATCH for name and feeProfileId", async ({
    accountsApi,
    feeProfilesApi,
    settingsApi,
  }) => {
    const listResponse = await accountsApi.actions.listAccounts();
    await accountsApi.assert.statusIs(listResponse, 200);
    const accounts = await accountsApi.arrange.accounts(listResponse);
    await accountsApi.assert.accountCountAtLeast(accounts, 1);
    const account = await accountsApi.arrange.firstAccount(accounts);
    await accountsApi.assert.fieldEquals(account, "id", "acc-1");
    await accountsApi.assert.fieldEquals(account, "name", "Main");
    await accountsApi.assert.fieldEquals(account, "feeProfileId", "fp-default");

    const createdProfileResponse = await feeProfilesApi.actions.createFeeProfile(
      feeProfilePayload({ name: "Alt" }),
    );
    await feeProfilesApi.assert.statusIs(createdProfileResponse, 200);
    const createdProfile = (await feeProfilesApi.arrange.body(createdProfileResponse)) as Record<string, unknown>;

    const patchResponse = await accountsApi.actions.patchAccount("acc-1", {
      name: "Primary",
      feeProfileId: createdProfile.id,
    });
    await accountsApi.assert.statusIs(patchResponse, 200);
    const updatedAccount = (await accountsApi.arrange.body(patchResponse)) as Record<string, unknown>;
    await accountsApi.assert.fieldEquals(updatedAccount, "name", "Primary");
    await accountsApi.assert.fieldEquals(updatedAccount, "feeProfileId", createdProfile.id);

    const feeConfigResponse = await settingsApi.actions.getFeeConfig();
    await settingsApi.assert.statusIs(feeConfigResponse, 200);
    const feeConfigBody = await settingsApi.arrange.feeConfigBody(feeConfigResponse);
    await settingsApi.assert.accountFeeProfileEquals(feeConfigBody, "acc-1", createdProfile.id);
  });
});
