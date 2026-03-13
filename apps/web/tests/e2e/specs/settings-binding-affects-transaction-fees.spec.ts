import { expect, test } from "@playwright/test";
import { gotoApp, openQuickTransaction, openSettingsDrawer } from "../helpers/flows";

const apiPort = Number(process.env.API_PORT ?? 4000);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
const testUserId = "e2e-settings-binding-fees";

interface SettingsResponse {
  locale: "en" | "zh-TW";
  costBasisMethod: "WEIGHTED_AVERAGE";
  quotePollIntervalSeconds: number;
}

interface FeeConfigResponse {
  feeProfiles: Array<Record<string, unknown> & { id: string }>;
  accounts: Array<{ id: string; feeProfileId: string }>;
  feeProfileBindings: Array<{ accountId: string; symbol: string; feeProfileId: string }>;
}

interface TransactionApiResponse {
  commissionAmount: number;
  feeSnapshot: { id: string };
}

test.use({
  extraHTTPHeaders: {
    "x-user-id": testUserId,
  },
});

test.describe("settings binding affects transaction fees", () => {
  test("applies bound fee profile for matching symbol and fallback profile for unbound symbol", async ({
    page,
    request,
  }) => {
    const settings = await request.get(`${apiBaseUrl}/settings`, {
      headers: { "x-user-id": testUserId },
    });
    expect(settings.ok()).toBe(true);
    const settingsBody = (await settings.json()) as SettingsResponse;

    const feeConfig = await request.get(`${apiBaseUrl}/settings/fee-config`, {
      headers: { "x-user-id": testUserId },
    });
    expect(feeConfig.ok()).toBe(true);
    const feeConfigBody = (await feeConfig.json()) as FeeConfigResponse;

    const zeroFeeProfileResponse = await request.post(`${apiBaseUrl}/fee-profiles`, {
      headers: { "x-user-id": testUserId, "content-type": "application/json" },
      data: {
        name: "E2E Zero Fee",
        boardCommissionRate: 0,
        commissionDiscountPercent: 0,
        minimumCommissionAmount: 0,
        commissionCurrency: "TWD",
        commissionRoundingMode: "FLOOR",
        taxRoundingMode: "FLOOR",
        stockSellTaxRateBps: 0,
        stockDayTradeTaxRateBps: 0,
        etfSellTaxRateBps: 0,
        bondEtfSellTaxRateBps: 0,
        commissionChargeMode: "CHARGED_UPFRONT",
      },
    });
    expect(zeroFeeProfileResponse.ok()).toBe(true);
    const zeroFeeProfile = (await zeroFeeProfileResponse.json()) as { id: string } & Record<string, unknown>;

    const fullSave = await request.put(`${apiBaseUrl}/settings/full`, {
      headers: { "x-user-id": testUserId, "content-type": "application/json" },
      data: {
        settings: {
          locale: settingsBody.locale,
          costBasisMethod: settingsBody.costBasisMethod,
          quotePollIntervalSeconds: settingsBody.quotePollIntervalSeconds,
        },
        feeProfiles: [
          ...feeConfigBody.feeProfiles.map((profile) => ({ ...profile })),
          { ...zeroFeeProfile, id: zeroFeeProfile.id },
        ],
        accounts: feeConfigBody.accounts.map((account) => ({
          id: account.id,
          feeProfileRef: account.feeProfileId,
        })),
        feeProfileBindings: [
          ...feeConfigBody.feeProfileBindings.map((binding) => ({
            accountId: binding.accountId,
            symbol: binding.symbol,
            feeProfileRef: binding.feeProfileId,
          })),
          {
            accountId: feeConfigBody.accounts[0].id,
            symbol: "2330",
            feeProfileRef: zeroFeeProfile.id,
          },
        ],
      },
    });
    expect(fullSave.ok()).toBe(true);

    await gotoApp(page);
    await openQuickTransaction(page);
    const accountSelect = page.getByTestId("tx-account-select");
    await accountSelect.selectOption(feeConfigBody.accounts[0].id);

    await page.getByTestId("tx-type-select").selectOption("BUY");
    await page.getByTestId("tx-trade-date-input").fill("2026-02-01");
    await page.getByTestId("tx-quantity-input").fill("1");
    await page.getByTestId("tx-price-input").fill("100");

    await page.getByTestId("tx-symbol-select").selectOption("2330");
    const boundTx = page.waitForResponse((response) => {
      return response.request().method() === "POST" && response.url().includes("/portfolio/transactions") && response.ok();
    });
    await page.getByTestId("tx-submit-button").click();
    const boundResponse = (await (await boundTx).json()) as TransactionApiResponse;
    expect(boundResponse.commissionAmount).toBe(0);
    expect(boundResponse.feeSnapshot.id).toBe(zeroFeeProfile.id);

    await page.getByTestId("tx-symbol-select").selectOption("0050");
    const fallbackTx = page.waitForResponse((response) => {
      return response.request().method() === "POST" && response.url().includes("/portfolio/transactions") && response.ok();
    });
    await page.getByTestId("tx-submit-button").click();
    const fallbackResponse = (await (await fallbackTx).json()) as TransactionApiResponse;
    expect(fallbackResponse.commissionAmount).toBeGreaterThan(0);
    expect(fallbackResponse.feeSnapshot.id).not.toBe(zeroFeeProfile.id);

    await openSettingsDrawer(page);
    await page.getByTestId("settings-tab-fees").click();
    await expect(page.getByTestId("settings-drawer")).toBeVisible();
  });
});
