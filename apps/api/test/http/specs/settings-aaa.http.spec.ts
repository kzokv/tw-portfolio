import { feeProfilePayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

test.describe("settings", () => {
  test("merges partial PATCH into existing settings", async ({ settingsApi }) => {
    const beforeResponse = await settingsApi.actions.getSettings();
    await settingsApi.assert.statusIs(beforeResponse, 200);
    const beforeBody = await settingsApi.arrange.settingsBody(beforeResponse);
    const nextLocale = await settingsApi.arrange.nextLocale(beforeBody.locale);

    const patchResponse = await settingsApi.actions.patchSettings({ locale: nextLocale });
    await settingsApi.assert.statusIs(patchResponse, 200);
    const patchedBody = await settingsApi.arrange.settingsBody(patchResponse);

    await settingsApi.assert.fieldEquals(patchedBody, "locale", nextLocale);
    await settingsApi.assert.fieldEquals(patchedBody, "costBasisMethod", beforeBody.costBasisMethod);
    await settingsApi.assert.fieldEquals(
      patchedBody,
      "quotePollIntervalSeconds",
      beforeBody.quotePollIntervalSeconds,
    );

    const afterResponse = await settingsApi.actions.getSettings();
    await settingsApi.assert.statusIs(afterResponse, 200);
    const afterBody = await settingsApi.arrange.settingsBody(afterResponse);
    await settingsApi.assert.bodiesEqual(afterBody, patchedBody);
  });

  test("rejects legacy cost basis methods in PATCH /settings", async ({ settingsApi }) => {
    const fifoResponse = await settingsApi.actions.patchSettings({ costBasisMethod: "FIFO" });
    await settingsApi.assert.statusIs(fifoResponse, 400);

    const lifoResponse = await settingsApi.actions.patchSettings({ costBasisMethod: "LIFO" });
    await settingsApi.assert.statusIs(lifoResponse, 400);
  });

  test("rejects legacy cost basis methods in PUT /settings/full", async ({ settingsApi }) => {
    const settingsResponse = await settingsApi.actions.getSettings();
    await settingsApi.assert.statusIs(settingsResponse, 200);
    const settingsBody = await settingsApi.arrange.settingsBody(settingsResponse);

    const feeConfigResponse = await settingsApi.actions.getFeeConfig();
    await settingsApi.assert.statusIs(feeConfigResponse, 200);
    const feeConfigBody = await settingsApi.arrange.feeConfigBody(feeConfigResponse);

    const response = await settingsApi.actions.saveFull({
      settings: {
        locale: settingsBody.locale,
        costBasisMethod: "FIFO",
        quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
      },
      feeProfiles: (feeConfigBody.feeProfiles as Record<string, unknown>[]).map((profile) => ({ ...profile })),
      accounts: (feeConfigBody.accounts as Record<string, unknown>[]).map((account) => ({
        id: account.id,
        feeProfileRef: account.feeProfileId,
      })),
      feeProfileBindings: [],
    });

    await settingsApi.assert.statusIs(response, 400);
  });

  test("does not partially apply settings/full when bindings are invalid", async ({ settingsApi }) => {
    const settingsResponse = await settingsApi.actions.getSettings();
    await settingsApi.assert.statusIs(settingsResponse, 200);
    const settingsBody = await settingsApi.arrange.settingsBody(settingsResponse);

    const feeConfigResponse = await settingsApi.actions.getFeeConfig();
    await settingsApi.assert.statusIs(feeConfigResponse, 200);
    const feeConfigBody = await settingsApi.arrange.feeConfigBody(feeConfigResponse);
    const feeProfiles = feeConfigBody.feeProfiles as Record<string, unknown>[];
    const accounts = feeConfigBody.accounts as Record<string, unknown>[];

    const failedSaveResponse = await settingsApi.actions.saveFull({
      settings: {
        locale: await settingsApi.arrange.nextLocale(settingsBody.locale),
        costBasisMethod: settingsBody.costBasisMethod,
        quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
      },
      feeProfiles: feeProfiles.map((profile) => ({ ...profile })),
      accounts: accounts.map((account) => ({
        id: account.id,
        feeProfileRef: account.feeProfileId,
      })),
      feeProfileBindings: [
        {
          accountId: "acc-missing",
          ticker: "2330",
          feeProfileRef: feeProfiles[0]?.id,
        },
      ],
    });

    await settingsApi.assert.statusIs(failedSaveResponse, 400);
    const failedSaveBody = (await settingsApi.arrange.body(failedSaveResponse)) as Record<string, unknown>;
    await settingsApi.assert.errorEquals(failedSaveBody, "invalid_account");

    const settingsAfterResponse = await settingsApi.actions.getSettings();
    await settingsApi.assert.statusIs(settingsAfterResponse, 200);
    const settingsAfterBody = await settingsApi.arrange.settingsBody(settingsAfterResponse);
    await settingsApi.assert.bodiesEqual(settingsAfterBody, settingsBody);
  });

  test("does not partially apply settings/fee-config when bindings are invalid", async ({
    feeProfilesApi,
    settingsApi,
  }) => {
    const feeConfigBeforeResponse = await settingsApi.actions.getFeeConfig();
    await settingsApi.assert.statusIs(feeConfigBeforeResponse, 200);
    const feeConfigBeforeBody = await settingsApi.arrange.feeConfigBody(feeConfigBeforeResponse);
    const account = (feeConfigBeforeBody.accounts as Record<string, unknown>[])[0]!;

    const createdProfileResponse = await feeProfilesApi.actions.createFeeProfile(
      feeProfilePayload({ name: "Alt Profile", boardCommissionRate: 0.1 }),
    );
    await feeProfilesApi.assert.statusIs(createdProfileResponse, 200);
    const createdProfile = (await feeProfilesApi.arrange.body(createdProfileResponse)) as Record<string, unknown>;

    const failedUpdateResponse = await settingsApi.actions.updateFeeConfig({
      accounts: [{ id: account.id, feeProfileId: createdProfile.id }],
      feeProfileBindings: [
        {
          accountId: "acc-missing",
          ticker: "2330",
          feeProfileId: createdProfile.id,
        },
      ],
    });
    await settingsApi.assert.statusIs(failedUpdateResponse, 400);
    const failedUpdateBody = (await settingsApi.arrange.body(failedUpdateResponse)) as Record<string, unknown>;
    await settingsApi.assert.errorEquals(failedUpdateBody, "invalid_account");

    const feeConfigAfterResponse = await settingsApi.actions.getFeeConfig();
    await settingsApi.assert.statusIs(feeConfigAfterResponse, 200);
    const feeConfigAfterBody = await settingsApi.arrange.feeConfigBody(feeConfigAfterResponse);
    await settingsApi.assert.accountFeeProfileEquals(
      feeConfigAfterBody,
      String(account.id),
      account.feeProfileId,
    );
  });

  test("generates profile UUIDs from temp IDs in full-save flow", async ({ settingsApi }) => {
    const settingsResponse = await settingsApi.actions.getSettings();
    await settingsApi.assert.statusIs(settingsResponse, 200);
    const settingsBody = await settingsApi.arrange.settingsBody(settingsResponse);

    const feeConfigResponse = await settingsApi.actions.getFeeConfig();
    await settingsApi.assert.statusIs(feeConfigResponse, 200);
    const feeConfigBody = await settingsApi.arrange.feeConfigBody(feeConfigResponse);
    const feeProfiles = feeConfigBody.feeProfiles as Record<string, unknown>[];
    const accounts = feeConfigBody.accounts as Record<string, unknown>[];

    const saveFullResponse = await settingsApi.actions.saveFull({
      settings: {
        locale: settingsBody.locale,
        costBasisMethod: settingsBody.costBasisMethod,
        quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
      },
      feeProfiles: [
        ...feeProfiles.map((profile) => ({ ...profile })),
        {
          tempId: "tmp-new-profile",
          name: "Temp Profile",
          boardCommissionRate: 1.425,
          commissionDiscountPercent: 60,
          minimumCommissionAmount: 20,
          commissionRoundingMode: "FLOOR",
          taxRoundingMode: "FLOOR",
          stockSellTaxRateBps: 30,
          stockDayTradeTaxRateBps: 15,
          etfSellTaxRateBps: 10,
          bondEtfSellTaxRateBps: 0,
          commissionChargeMode: "CHARGED_UPFRONT",
        },
      ],
      accounts: accounts.map((account, index) => ({
        id: account.id,
        feeProfileRef: index === 0 ? "tmp-new-profile" : account.feeProfileId,
      })),
      feeProfileBindings: [],
    });
    await settingsApi.assert.statusIs(saveFullResponse, 200);
    const saveFullBody = await settingsApi.arrange.feeConfigBody(saveFullResponse);

    const firstAccount = (saveFullBody.accounts as Record<string, unknown>[])[0]!;
    await settingsApi.assert.accountFeeProfileDiffers(
      saveFullBody,
      String(firstAccount.id),
      "tmp-new-profile",
    );
    await settingsApi.assert.feeProfileExists(saveFullBody, firstAccount.feeProfileId);
    await settingsApi.assert.feeProfileFieldEquals(
      saveFullBody,
      firstAccount.feeProfileId,
      "commissionDiscountPercent",
      60,
    );
  });
});
