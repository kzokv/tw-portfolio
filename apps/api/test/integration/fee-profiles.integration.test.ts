import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { feeProfilePayload, transactionPayload } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("fee-profiles", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("isolates seeded default fee profiles between memory users", async () => {
    const userAProfiles = await app.inject({
      method: "GET",
      url: "/fee-profiles",
      headers: { "x-user-id": "user-a" },
    });
    const userAProfile = userAProfiles.json()[0];

    const patchA = await app.inject({
      method: "PATCH",
      url: `/fee-profiles/${userAProfile.id}`,
      headers: { "x-user-id": "user-a" },
      payload: { ...userAProfile, name: "User A Broker" },
    });
    expect(patchA.statusCode).toBe(200);

    const userBProfiles = await app.inject({
      method: "GET",
      url: "/fee-profiles",
      headers: { "x-user-id": "user-b" },
    });
    expect(userBProfiles.statusCode).toBe(200);
    expect(userBProfiles.json()[0].name).toBe("Default Broker");
  });

  it("prevents deleting fee profiles referenced by historical transactions", async () => {
    const createdProfileResponse = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: feeProfilePayload({ name: "Tx Profile", boardCommissionRate: 0.2 }),
    });
    const profile = createdProfileResponse.json();

    const updateFeeConfig = await app.inject({
      method: "PUT",
      url: "/settings/fee-config",
      payload: {
        accounts: [{ id: "acc-1", feeProfileId: profile.id }],
        feeProfileBindings: [],
      },
    });
    expect(updateFeeConfig.statusCode).toBe(200);

    const txResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-delete-in-use-profile" },
      payload: transactionPayload({ quantity: 1 }),
    });
    expect(txResponse.statusCode).toBe(200);

    const restoreDefault = await app.inject({
      method: "PUT",
      url: "/settings/fee-config",
      payload: {
        accounts: [{ id: "acc-1", feeProfileId: "fp-default" }],
        feeProfileBindings: [],
      },
    });
    expect(restoreDefault.statusCode).toBe(200);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/fee-profiles/${profile.id}`,
    });
    expect(deleteResponse.statusCode).toBe(409);
    expect(deleteResponse.json().error).toBe("fee_profile_in_use");
  });

  it("rejects the legacy commissionDiscountBps payload shape", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/fee-profiles",
      payload: {
        name: "Legacy Shape",
        boardCommissionRate: 1.425,
        commissionDiscountBps: 10000,
        minCommissionNtd: 20,
        commissionRoundingMode: "FLOOR",
        taxRoundingMode: "FLOOR",
        stockSellTaxRateBps: 30,
        stockDayTradeTaxRateBps: 15,
        etfSellTaxRateBps: 10,
        bondEtfSellTaxRateBps: 0,
        commissionChargeMode: "CHARGED_UPFRONT",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
