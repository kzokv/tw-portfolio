import { describe, expect, it } from "vitest";
import { getDictionary } from "../../../../lib/i18n";
import { validateSettingsForm } from "../../../../features/settings/validators/settingsValidation";
import type { SettingsFormModel } from "../../../../features/settings/types/settingsUi";

function createValidModel(): SettingsFormModel {
  return {
    locale: "en",
    costBasisMethod: "FIFO",
    quotePollIntervalSeconds: 10,
    feeProfiles: [
      {
        id: "profile-1",
        name: "Default Profile",
        commissionRateBps: 14,
        commissionDiscountBps: 10000,
        minCommissionNtd: 20,
        commissionRoundingMode: "FLOOR",
        taxRoundingMode: "FLOOR",
        stockSellTaxRateBps: 30,
        stockDayTradeTaxRateBps: 15,
        etfSellTaxRateBps: 10,
        bondEtfSellTaxRateBps: 0,
      },
    ],
    accounts: [{ id: "account-1", feeProfileId: "profile-1" }],
    feeProfileBindings: [{ accountId: "account-1", symbol: "2330", feeProfileId: "profile-1" }],
  };
}

describe("validateSettingsForm", () => {
  const dict = getDictionary("en");

  it("accepts a valid form", () => {
    expect(validateSettingsForm(createValidModel(), dict)).toBe("");
  });

  it("rejects non-positive quote poll interval", () => {
    const model = createValidModel();
    model.quotePollIntervalSeconds = 0;

    expect(validateSettingsForm(model, dict)).toBe(dict.settings.validationQuotePoll);
  });

  it("rejects blank profile names", () => {
    const model = createValidModel();
    model.feeProfiles[0].name = " ";

    expect(validateSettingsForm(model, dict)).toBe(dict.settings.validationProfileName);
  });

  it("rejects invalid numeric values", () => {
    const model = createValidModel();
    model.feeProfiles[0].stockSellTaxRateBps = -1;

    expect(validateSettingsForm(model, dict)).toBe(dict.settings.validationProfileNumbers);
  });

  it("rejects invalid account profile references", () => {
    const model = createValidModel();
    model.accounts[0].feeProfileId = "missing";

    expect(validateSettingsForm(model, dict)).toBe(dict.settings.validationAccountProfile);
  });

  it("rejects invalid security binding symbols", () => {
    const model = createValidModel();
    model.feeProfileBindings[0].symbol = "bad-symbol";

    expect(validateSettingsForm(model, dict)).toBe(dict.settings.validationBindingSymbol);
  });
});
