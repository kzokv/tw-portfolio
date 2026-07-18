import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AccountMarketDividendSettingsDto,
  DividendCalculationPreviewDto,
} from "@vakwen/shared-types";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
  patchJson: vi.fn(),
  postJson: vi.fn(),
}));

import { getJson, patchJson, postJson } from "../../../lib/api";
import {
  buildAccountDividendSettingsHref,
  amendDividendCalculation,
  confirmDividendCalculation,
  fetchAccountMarketDividendSettings,
  parseAccountDividendSettingsFocus,
  patchAccountMarketDividendSettings,
  previewDividendCalculation,
  resetDividendCalculation,
} from "../../../features/dividends/services/dividendCalculationService";

describe("dividendCalculationService", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads and updates one account-market dividend default", async () => {
    const settings: AccountMarketDividendSettingsDto = {
      accountId: "account/1",
      marketCode: "TW",
      version: 3,
      fallbackParValue: "10.00",
      updatedAt: "2026-07-17T04:00:00.000Z",
    };
    vi.mocked(getJson).mockResolvedValueOnce(settings);
    vi.mocked(patchJson).mockResolvedValueOnce({ ...settings, version: 4, fallbackParValue: null });

    await expect(fetchAccountMarketDividendSettings("account/1", "TW")).resolves.toEqual(settings);
    await expect(patchAccountMarketDividendSettings("account/1", "TW", {
      expectedVersion: 3,
      fallbackParValue: null,
    })).resolves.toMatchObject({ version: 4, fallbackParValue: null });

    expect(getJson).toHaveBeenCalledWith("/accounts/account%2F1/dividend-settings/TW");
    expect(patchJson).toHaveBeenCalledWith(
      "/accounts/account%2F1/dividend-settings/TW",
      { expectedVersion: 3, fallbackParValue: null },
    );
  });

  it("previews a stock calculation through the typed route", async () => {
    const preview: DividendCalculationPreviewDto = {
      accountId: "acc-1",
      dividendEventId: "event-1",
      marketCode: "TW",
      eligibleQuantity: 1_000,
      method: "derived_from_par_value",
      providerValue: "0.25",
      providerUnit: "TWD_PER_SHARE",
      providerSource: "finmind",
      providerDataset: "TaiwanStockDividend",
      providerAuthoritativeRatio: "0.025",
      ratio: "0.025",
      selectedParValue: "10",
      theoreticalShares: "25",
      expectedWholeShares: 25,
      fractionalRemainder: "0",
      requiresHighRatioConfirmation: false,
    };
    vi.mocked(postJson).mockResolvedValueOnce(preview);

    await expect(previewDividendCalculation({
      accountId: "acc-1",
      dividendEventId: "event-1",
      method: "derived_from_par_value",
      selectedParValue: "10",
    })).resolves.toEqual(preview);

    expect(postJson).toHaveBeenCalledWith(
      "/portfolio/dividends/calculations/preview",
      {
        accountId: "acc-1",
        dividendEventId: "event-1",
        method: "derived_from_par_value",
        selectedParValue: "10",
      },
    );
  });

  it("confirms, resets, and amends through their typed calculation routes", async () => {
    const calculation = {
      id: "calc-2",
      accountId: "acc-1",
      dividendEventId: "event-1",
      calculationVersion: 2,
      status: "amended" as const,
      method: "custom_ratio" as const,
      provider: { value: null, unit: null, source: null, dataset: null, authoritativeRatio: null },
      ratio: "0.15",
      selectedParValue: null,
      theoreticalShares: "15",
      expectedWholeShares: 15,
      fractionalRemainder: "0",
      requiresHighRatioConfirmation: false,
      confirmedAt: "2026-07-17T04:00:00.000Z",
      supersededAt: null,
      priorCalculationId: "calc-1",
      dividendLedgerEntryId: "ledger-1",
      drift: null,
    };
    vi.mocked(postJson)
      .mockResolvedValueOnce(calculation)
      .mockResolvedValueOnce({ status: "ok" })
      .mockResolvedValueOnce(calculation);

    await confirmDividendCalculation({ accountId: "acc-1", dividendEventId: "event-1", method: "custom_ratio", customRatio: "0.15", expectedActiveCalculationId: null });
    await resetDividendCalculation({ accountId: "acc-1", dividendEventId: "event-1", expectedActiveCalculationId: "calc-2", expectedCalculationVersion: 2 });
    await amendDividendCalculation({ accountId: "acc-1", dividendEventId: "event-1", dividendLedgerEntryId: "ledger-1", method: "custom_ratio", customRatio: "0.15", acknowledgeDrift: true, expectedActiveCalculationId: "calc-2", expectedCalculationVersion: 2 });

    expect(postJson).toHaveBeenNthCalledWith(1, "/portfolio/dividends/calculations/confirm", {
      accountId: "acc-1", dividendEventId: "event-1", method: "custom_ratio", customRatio: "0.15", expectedActiveCalculationId: null,
    }, expect.objectContaining({ "idempotency-key": expect.stringMatching(/^dividend-calculation-confirm-/) }));
    expect(postJson).toHaveBeenNthCalledWith(2, "/portfolio/dividends/calculations/reset", {
      accountId: "acc-1", dividendEventId: "event-1", expectedActiveCalculationId: "calc-2", expectedCalculationVersion: 2,
    }, expect.objectContaining({ "idempotency-key": expect.stringMatching(/^dividend-calculation-reset-/) }));
    expect(postJson).toHaveBeenNthCalledWith(3, "/portfolio/dividends/calculations/amend", {
      accountId: "acc-1", dividendEventId: "event-1", dividendLedgerEntryId: "ledger-1", method: "custom_ratio", customRatio: "0.15", acknowledgeDrift: true, expectedActiveCalculationId: "calc-2", expectedCalculationVersion: 2,
    }, expect.objectContaining({ "idempotency-key": expect.stringMatching(/^dividend-calculation-amend-/) }));
    const keys = vi.mocked(postJson).mock.calls.map((call) => (call[2] as Record<string, string>)["idempotency-key"]);
    expect(new Set(keys).size).toBe(3);
  });

  it("builds the exact account-market settings focus URL", () => {
    expect(buildAccountDividendSettingsHref("account/1", "TW")).toBe(
      "/settings/accounts?accountId=account%2F1&marketCode=TW&section=dividend-calculation-defaults",
    );
  });

  it("parses only a complete dividend-default settings focus query", () => {
    expect(parseAccountDividendSettingsFocus(new URLSearchParams(
      "accountId=account%2F1&marketCode=TW&section=dividend-calculation-defaults",
    ))).toEqual({ accountId: "account/1", marketCode: "TW" });
    expect(parseAccountDividendSettingsFocus(new URLSearchParams(
      "accountId=account-1&marketCode=XX&section=dividend-calculation-defaults",
    ))).toBeNull();
    expect(parseAccountDividendSettingsFocus(new URLSearchParams(
      "accountId=account-1&marketCode=TW&section=fee-profiles",
    ))).toBeNull();
  });
});
