import { feeProfilePayload } from "../../helpers/fixtures.js";
import { test } from "../fixtures.js";

// ui-reshape Phase 3d S8 — `PUT /settings/full` retired in favor of
// per-resource PATCHes + `PUT /settings/fee-config`. Three tests removed:
//   - "rejects legacy cost basis methods in PUT /settings/full" — route
//     deleted; PATCH /settings rejection is covered by the test below.
//   - "does not partially apply settings/full when bindings are invalid" —
//     the "does not partially apply settings/fee-config when bindings are
//     invalid" test in this file covers the same invariant on the
//     replacement endpoint.
//   - "generates profile UUIDs from temp IDs in full-save flow" — the
//     `tempId` resolution feature was unique to the retired omnibus
//     endpoint; per-resource fee-profile creation uses real ids only.

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

  // ui-reshape Phase 3d S8 — "generates profile UUIDs from temp IDs in
  // full-save flow" deleted. The tempId resolution feature was unique to
  // the retired `PUT /settings/full` omnibus endpoint; per-resource fee
  // profile creation (`POST /fee-profiles`) uses real database ids only.
});
