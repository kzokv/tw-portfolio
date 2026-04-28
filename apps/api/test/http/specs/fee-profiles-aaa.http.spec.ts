import { feeProfilePayload, transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

test.describe("fee-profiles", () => {
  test("isolates seeded default fee profiles between users", async ({
    feeProfilesApi,
    sessionApi,
  }) => {
    const userASessionResponse = await sessionApi.actions.createOauthSessionForClaims({
      sub: "fee-profiles-user-a",
      email: "user-a@example.com",
    });
    await sessionApi.assert.statusIs(userASessionResponse, 200);
    const userACookie = await sessionApi.arrange.sessionCookieHeader(userASessionResponse);

    const userBSessionResponse = await sessionApi.actions.createOauthSessionForClaims({
      sub: "fee-profiles-user-b",
      email: "user-b@example.com",
    });
    await sessionApi.assert.statusIs(userBSessionResponse, 200);
    const userBCookie = await sessionApi.arrange.sessionCookieHeader(userBSessionResponse);

    const userAProfilesResponse = await feeProfilesApi.actions.listFeeProfilesForCookie(userACookie);
    await feeProfilesApi.assert.statusIs(userAProfilesResponse, 200);
    const userAProfiles = await feeProfilesApi.arrange.feeProfiles(userAProfilesResponse);
    const userAProfile = await feeProfilesApi.arrange.firstFeeProfile(userAProfiles);

    const patchResponse = await feeProfilesApi.actions.patchFeeProfileForCookie(
      userACookie,
      String(userAProfile.id),
      {
        ...userAProfile,
        name: "User A Broker",
      },
    );
    await feeProfilesApi.assert.statusIs(patchResponse, 200);

    const userBProfilesResponse = await feeProfilesApi.actions.listFeeProfilesForCookie(userBCookie);
    await feeProfilesApi.assert.statusIs(userBProfilesResponse, 200);
    const userBProfiles = await feeProfilesApi.arrange.feeProfiles(userBProfilesResponse);
    const userBProfile = await feeProfilesApi.arrange.firstFeeProfile(userBProfiles);
    await feeProfilesApi.assert.fieldEquals(userBProfile, "name", "Default Broker");
  });

  test("prevents deleting fee profiles referenced by historical transactions", async ({
    accountsApi,
    feeProfilesApi,
    settingsApi,
    transactionsApi,
  }) => {
    const accountsResponse = await accountsApi.actions.listAccounts();
    await accountsApi.assert.statusIs(accountsResponse, 200);
    const accounts = await accountsApi.arrange.accounts(accountsResponse);
    const account = await accountsApi.arrange.firstAccount(accounts);
    const originalFeeProfileId = account.feeProfileId;
    if (typeof originalFeeProfileId !== "string") {
      throw new Error("Expected seeded account feeProfileId to be a string");
    }

    const createdProfileResponse = await feeProfilesApi.actions.createFeeProfile(
      feeProfilePayload({ name: "Tx Profile", boardCommissionRate: 0.2 }),
    );
    await feeProfilesApi.assert.statusIs(createdProfileResponse, 200);
    const createdProfile = (await feeProfilesApi.arrange.body(createdProfileResponse)) as Record<string, unknown>;

    const updateFeeConfigResponse = await settingsApi.actions.updateFeeConfig({
      accounts: [{ id: "acc-1", feeProfileId: createdProfile.id }],
      feeProfileBindings: [],
    });
    await settingsApi.assert.statusIs(updateFeeConfigResponse, 200);

    const transactionResponse = await transactionsApi.actions.createTransaction(
      transactionPayload({ quantity: 1 }),
      "k-delete-in-use-profile",
    );
    await transactionsApi.assert.statusIs(transactionResponse, 200);

    const restoreDefaultResponse = await settingsApi.actions.updateFeeConfig({
      accounts: [{ id: "acc-1", feeProfileId: originalFeeProfileId }],
      feeProfileBindings: [],
    });
    await settingsApi.assert.statusIs(restoreDefaultResponse, 200);

    const deleteResponse = await feeProfilesApi.actions.deleteFeeProfile(String(createdProfile.id));
    await feeProfilesApi.assert.statusIs(deleteResponse, 409);
    const deleteBody = (await feeProfilesApi.arrange.body(deleteResponse)) as Record<string, unknown>;
    await feeProfilesApi.assert.errorEquals(deleteBody, "fee_profile_in_use");
  });

  test("rejects the legacy commissionDiscountBps payload shape", async ({ feeProfilesApi }) => {
    const response = await feeProfilesApi.actions.createFeeProfile({
      name: "Legacy Shape",
      boardCommissionRate: 1.425,
      commissionDiscountBps: 10000,
      minimumCommissionAmount: 20,
      commissionRoundingMode: "FLOOR",
      taxRoundingMode: "FLOOR",
      stockSellTaxRateBps: 30,
      stockDayTradeTaxRateBps: 15,
      etfSellTaxRateBps: 10,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT",
    });

    await feeProfilesApi.assert.statusIs(response, 400);
  });
});
