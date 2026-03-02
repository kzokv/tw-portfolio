import { describe, expect, it } from "vitest";
import type { AccountDto, FeeProfileBindingDto, FeeProfileDto, UserSettings } from "@tw-portfolio/shared-types";
import { toSaveSettingsRequest, toSettingsFormModel } from "../../../../features/settings/mappers/settingsMappers";

const settings: UserSettings = {
  userId: "user-1",
  locale: "en",
  costBasisMethod: "FIFO",
  quotePollIntervalSeconds: 10,
};

const accounts: AccountDto[] = [
  { id: "account-1", name: "Broker A", userId: "user-1", feeProfileId: "profile-1" },
];

const feeProfiles: FeeProfileDto[] = [
  {
    id: "profile-1",
    name: "Default",
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
];

const bindings: FeeProfileBindingDto[] = [
  { accountId: "account-1", symbol: "2330", feeProfileId: "profile-1" },
];

describe("settingsMappers", () => {
  it("maps dto payloads into a settings form model", () => {
    const model = toSettingsFormModel(settings, accounts, feeProfiles, bindings);

    expect(model.locale).toBe("en");
    expect(model.accounts[0]).toEqual({ id: "account-1", feeProfileId: "profile-1" });
    expect(model.feeProfileBindings[0].symbol).toBe("2330");
  });

  it("maps temporary and persisted profiles into the save request contract", () => {
    const model = toSettingsFormModel(settings, accounts, feeProfiles, bindings);
    model.feeProfiles.push({
      ...model.feeProfiles[0],
      id: "tmp-1",
      name: "Temporary",
    });

    const request = toSaveSettingsRequest(model);
    expect(request.feeProfiles[0]).toMatchObject({ id: "profile-1" });
    expect(request.feeProfiles[1]).toMatchObject({ tempId: "tmp-1" });
    expect(request.accounts[0]).toEqual({ id: "account-1", feeProfileRef: "profile-1" });
    expect(request.feeProfileBindings[0]).toEqual({
      accountId: "account-1",
      symbol: "2330",
      feeProfileRef: "profile-1",
    });
  });
});
