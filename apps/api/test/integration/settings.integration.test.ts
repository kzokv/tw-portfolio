import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { feeProfilePayload } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("settings", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("merges partial PATCH into existing settings", async () => {
    const before = await app.inject({ method: "GET", url: "/settings" });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json();
    const newLocale = beforeBody.locale === "en" ? "zh-TW" : "en";

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/settings",
      payload: { locale: newLocale },
    });
    expect(patchResponse.statusCode).toBe(200);
    const patched = patchResponse.json();
    expect(patched.locale).toBe(newLocale);
    expect(patched.costBasisMethod).toBe(beforeBody.costBasisMethod);
    expect(patched.quotePollIntervalSeconds).toBe(beforeBody.quotePollIntervalSeconds);

    const after = await app.inject({ method: "GET", url: "/settings" });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual(patched);
  });

  it("rejects legacy cost basis methods in PATCH /settings", async () => {
    const fifo = await app.inject({
      method: "PATCH",
      url: "/settings",
      payload: { costBasisMethod: "FIFO" },
    });
    expect(fifo.statusCode).toBe(400);

    const lifo = await app.inject({
      method: "PATCH",
      url: "/settings",
      payload: { costBasisMethod: "LIFO" },
    });
    expect(lifo.statusCode).toBe(400);
  });

  it("rejects legacy cost basis methods in PUT /settings/full", async () => {
    const settingsBefore = await app.inject({ method: "GET", url: "/settings" });
    const settingsBody = settingsBefore.json();
    const feeConfig = await app.inject({ method: "GET", url: "/settings/fee-config" });
    const feeConfigBody = feeConfig.json();

    const response = await app.inject({
      method: "PUT",
      url: "/settings/full",
      payload: {
        settings: {
          locale: settingsBody.locale,
          costBasisMethod: "FIFO",
          quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
        },
        feeProfiles: feeConfigBody.feeProfiles.map((profile: { id: string } & Record<string, unknown>) => ({ ...profile })),
        accounts: feeConfigBody.accounts.map((account: { id: string; feeProfileId: string }) => ({
          id: account.id,
          feeProfileRef: account.feeProfileId,
        })),
        feeProfileBindings: [],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("does not partially apply settings/full when bindings are invalid", async () => {
    const settingsBefore = await app.inject({ method: "GET", url: "/settings" });
    const settingsBody = settingsBefore.json();
    const feeConfig = await app.inject({ method: "GET", url: "/settings/fee-config" });
    const feeConfigBody = feeConfig.json();

    const failedSave = await app.inject({
      method: "PUT",
      url: "/settings/full",
      payload: {
        settings: {
          locale: settingsBody.locale === "en" ? "zh-TW" : "en",
          costBasisMethod: settingsBody.costBasisMethod,
          quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
        },
        feeProfiles: feeConfigBody.feeProfiles.map((profile: { id: string } & Record<string, unknown>) => ({ ...profile })),
        accounts: feeConfigBody.accounts.map((account: { id: string; feeProfileId: string }) => ({
          id: account.id,
          feeProfileRef: account.feeProfileId,
        })),
        feeProfileBindings: [
          {
            accountId: "acc-missing",
            symbol: "2330",
            feeProfileRef: feeConfigBody.feeProfiles[0].id,
          },
        ],
      },
    });
    expect(failedSave.statusCode).toBe(400);
    expect(failedSave.json().error).toBe("invalid_account");

    const settingsAfter = await app.inject({ method: "GET", url: "/settings" });
    expect(settingsAfter.statusCode).toBe(200);
    expect(settingsAfter.json()).toEqual(settingsBody);
  });

  it("does not partially apply settings/fee-config when bindings are invalid", async () => {
    const before = await app.inject({ method: "GET", url: "/settings/fee-config" });
    const beforeBody = before.json();
    const account = beforeBody.accounts[0];

    const createdProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Alt Profile", boardCommissionRate: 0.1 }),
    });
    expect(createdProfileResponse.statusCode).toBe(200);
    const createdProfile = createdProfileResponse.json();

    const failedUpdate = await app.inject({
      method: "PUT",
      url: "/settings/fee-config",
      payload: {
        accounts: [{ id: account.id, feeProfileId: createdProfile.id }],
        feeProfileBindings: [
          { accountId: "acc-missing", symbol: "2330", feeProfileId: createdProfile.id },
        ],
      },
    });
    expect(failedUpdate.statusCode).toBe(400);
    expect(failedUpdate.json().error).toBe("invalid_account");

    const after = await app.inject({ method: "GET", url: "/settings/fee-config" });
    expect(after.statusCode).toBe(200);
    expect(after.json().accounts[0].feeProfileId).toBe(account.feeProfileId);
  });

  it("generates profile UUIDs from temp IDs in full-save flow", async () => {
    const settings = await app.inject({ method: "GET", url: "/settings" });
    const settingsBody = settings.json();
    const feeConfig = await app.inject({ method: "GET", url: "/settings/fee-config" });
    const feeConfigBody = feeConfig.json();

    const saveFull = await app.inject({
      method: "PUT",
      url: "/settings/full",
      payload: {
        settings: {
          locale: settingsBody.locale,
          costBasisMethod: settingsBody.costBasisMethod,
          quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
        },
        feeProfiles: [
          ...feeConfigBody.feeProfiles.map((profile: { id: string } & Record<string, unknown>) => ({ ...profile })),
          {
            tempId: "tmp-new-profile",
            name: "Temp Profile",
            boardCommissionRate: 1.425,
            commissionDiscountPercent: 60,
            minCommissionNtd: 20,
            commissionRoundingMode: "FLOOR",
            taxRoundingMode: "FLOOR",
            stockSellTaxRateBps: 30,
            stockDayTradeTaxRateBps: 15,
            etfSellTaxRateBps: 10,
            bondEtfSellTaxRateBps: 0,
            commissionChargeMode: "CHARGED_UPFRONT",
          },
        ],
        accounts: feeConfigBody.accounts.map((account: { id: string }, index: number) => ({
          id: account.id,
          feeProfileRef: index === 0 ? "tmp-new-profile" : feeConfigBody.accounts[index].feeProfileId,
        })),
        feeProfileBindings: [],
      },
    });
    expect(saveFull.statusCode).toBe(200);
    const body = saveFull.json();
    const firstAccount = body.accounts[0];
    expect(firstAccount.feeProfileId).not.toBe("tmp-new-profile");
    const linkedProfile = body.feeProfiles.find((profile: { id: string }) => profile.id === firstAccount.feeProfileId);
    expect(linkedProfile).toBeDefined();
    expect(linkedProfile.commissionDiscountPercent).toBe(60);
    expect(firstAccount.feeProfileId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
