import { describe, expect, it } from "vitest";
import {
  cloneSettingsForm,
  createDraftProfile,
  normalizeSettingsForm,
  removeProfileFromSettingsForm,
  serializeSettingsForm,
} from "../../../../features/settings/services/settingsDraft";
import type { SettingsFormModel } from "../../../../features/settings/types/settingsUi";

function createModel(): SettingsFormModel {
  return {
    locale: "en",
    costBasisMethod: "FIFO",
    quotePollIntervalSeconds: 10,
    feeProfiles: [
      createDraftProfile(1),
      { ...createDraftProfile(2), id: "profile-2", name: "Secondary" },
    ],
    accounts: [{ id: "account-1", feeProfileId: "tmp-1" }],
    feeProfileBindings: [{ accountId: "account-1", symbol: " 2330 ", feeProfileId: "tmp-1" }],
  };
}

describe("settingsDraft helpers", () => {
  it("clones without mutating the source", () => {
    const model = createModel();
    const cloned = cloneSettingsForm(model);
    cloned.feeProfiles[0].name = "Changed";

    expect(model.feeProfiles[0].name).toBe("New Fee Profile");
  });

  it("serializes equivalent forms stably", () => {
    const left = createModel();
    const right = createModel();
    right.feeProfiles.reverse();
    right.accounts.reverse();

    expect(serializeSettingsForm(left)).toBe(serializeSettingsForm(right));
  });

  it("normalizes symbols before save", () => {
    const normalized = normalizeSettingsForm(createModel());
    expect(normalized.feeProfileBindings[0].symbol).toBe("2330");
  });

  it("rebinds accounts and removes overrides when a profile is removed", () => {
    const result = removeProfileFromSettingsForm(createModel(), "tmp-1");
    expect(result.accounts[0].feeProfileId).toBe("profile-2");
    expect(result.feeProfileBindings).toHaveLength(0);
  });
});
