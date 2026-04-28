import { feeProfilePayload, transactionPayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

test.describe("account-scoped fee profiles (KZO-183)", () => {
  test("[fee profiles]: GET /fee-profiles returns flat account-scoped rows", async ({
    feeProfilesApi,
  }) => {
    const response = await feeProfilesApi.actions.listFeeProfiles();
    await feeProfilesApi.assert.statusIs(response, 200);

    const profiles = await feeProfilesApi.arrange.feeProfiles(response);
    if (profiles.length === 0) {
      throw new Error("Expected at least one seeded fee profile");
    }
    for (const profile of profiles) {
      if (typeof profile.accountId !== "string" || profile.accountId.length === 0) {
        throw new Error(`Expected profile ${String(profile.id)} to include accountId`);
      }
      if ("userId" in profile) {
        throw new Error(`Expected FeeProfileDto to omit legacy userId: ${JSON.stringify(profile)}`);
      }
    }
  });

  test("[fee profiles]: account_id filter returns only that account's profiles", async ({
    accountsApi,
    feeProfilesApi,
  }) => {
    const accountResponse = await accountsApi.actions.createAccount({
      name: "Filtered USD",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(accountResponse, 200);
    const account = (await accountsApi.arrange.body(accountResponse)) as Record<string, unknown>;
    if (typeof account.id !== "string") {
      throw new Error("Expected created account id to be a string");
    }

    const filteredResponse = await feeProfilesApi.actions.listFeeProfilesForAccount(account.id);
    await feeProfilesApi.assert.statusIs(filteredResponse, 200);
    const filteredProfiles = await feeProfilesApi.arrange.feeProfiles(filteredResponse);
    if (filteredProfiles.length !== 1) {
      throw new Error(`Expected one auto-seeded profile for account ${account.id}; got ${filteredProfiles.length}`);
    }
    await feeProfilesApi.assert.fieldEquals(filteredProfiles[0]!, "accountId", account.id);
    await feeProfilesApi.assert.fieldEquals(filteredProfiles[0]!, "id", account.feeProfileId);
  });

  test("[fee profiles]: POST requires accountId and creates rows owned by that account", async ({
    feeProfilesApi,
  }) => {
    const missingAccountPayload = { ...feeProfilePayload({ name: "Missing Account" }) } as Record<string, unknown>;
    delete missingAccountPayload.accountId;

    const rejectedResponse = await feeProfilesApi.actions.createFeeProfile(missingAccountPayload);
    await feeProfilesApi.assert.statusIs(rejectedResponse, 400);

    const createdResponse = await feeProfilesApi.actions.createFeeProfile(
      feeProfilePayload({ name: "Account Local" }),
    );
    await feeProfilesApi.assert.statusIs(createdResponse, 200);
    const created = (await feeProfilesApi.arrange.body(createdResponse)) as Record<string, unknown>;
    await feeProfilesApi.assert.fieldEquals(created, "accountId", "acc-1");
  });

  test("[settings]: fee-config rejects cross-account default profile assignment", async ({
    accountsApi,
    settingsApi,
  }) => {
    const accountResponse = await accountsApi.actions.createAccount({
      name: "Cross Account USD",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(accountResponse, 200);
    const secondAccount = (await accountsApi.arrange.body(accountResponse)) as Record<string, unknown>;

    const response = await settingsApi.actions.updateFeeConfig({
      accounts: [{ id: "acc-1", feeProfileId: secondAccount.feeProfileId }],
      feeProfileBindings: [],
    });

    await settingsApi.assert.statusIs(response, 400);
    const body = (await settingsApi.arrange.body(response)) as Record<string, unknown>;
    await settingsApi.assert.errorEquals(body, "invalid_fee_profile");
  });

  test("[settings]: full save rejects cross-account profile ownership", async ({
    accountsApi,
    settingsApi,
  }) => {
    const accountResponse = await accountsApi.actions.createAccount({
      name: "Full Save USD",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(accountResponse, 200);

    const settingsResponse = await settingsApi.actions.getSettings();
    await settingsApi.assert.statusIs(settingsResponse, 200);
    const settingsBody = await settingsApi.arrange.settingsBody(settingsResponse);

    const feeConfigResponse = await settingsApi.actions.getFeeConfig();
    await settingsApi.assert.statusIs(feeConfigResponse, 200);
    const feeConfig = await settingsApi.arrange.feeConfigBody(feeConfigResponse);
    const accounts = feeConfig.accounts as Record<string, unknown>[];
    const profiles = feeConfig.feeProfiles as Record<string, unknown>[];
    const firstAccount = accounts.find((account) => account.id === "acc-1");
    const secondAccount = accounts.find((account) => account.id !== "acc-1");
    if (!firstAccount || !secondAccount) {
      throw new Error("Expected seeded account plus created account");
    }

    const response = await settingsApi.actions.saveFull({
      settings: settingsBody,
      feeProfiles: profiles.map((profile) => ({ ...profile })),
      accounts: accounts.map((account) => ({
        id: account.id,
        feeProfileRef: account.id === firstAccount.id ? secondAccount.feeProfileId : account.feeProfileId,
      })),
      feeProfileBindings: [],
    });

    await settingsApi.assert.statusIs(response, 400);
    const body = (await settingsApi.arrange.body(response)) as Record<string, unknown>;
    await settingsApi.assert.errorEquals(body, "invalid_fee_profile");
  });

  test("[transactions]: market/account mismatch returns trade_market_mismatch", async ({
    accountsApi,
    transactionsApi,
  }) => {
    const accountResponse = await accountsApi.actions.createAccount({
      name: "USD Trade Guard",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    await accountsApi.assert.statusIs(accountResponse, 200);
    const account = (await accountsApi.arrange.body(accountResponse)) as Record<string, unknown>;
    if (typeof account.id !== "string") {
      throw new Error("Expected created account id to be a string");
    }

    const response = await transactionsApi.actions.createTransaction(
      transactionPayload({
        accountId: account.id,
        ticker: "2330",
        priceCurrency: "USD",
        tradeDate: "2026-02-01",
      }),
      "kzo183-trade-market-mismatch",
    );

    await transactionsApi.assert.statusIs(response, 400);
    const body = (await transactionsApi.arrange.body(response)) as Record<string, unknown>;
    if (body["error"] !== "trade_market_mismatch") {
      throw new Error(`Expected body.error "trade_market_mismatch" but got: ${JSON.stringify(body["error"])}`);
    }
  });
});
