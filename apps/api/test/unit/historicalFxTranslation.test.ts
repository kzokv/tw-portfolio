import { describe, expect, it, vi } from "vitest";
import { translateHistoricalFxAmounts } from "../../src/services/historicalFxTranslation.js";

describe("translateHistoricalFxAmounts", () => {
  it("reuses one FX lookup per unique currency-date pair across entries", async () => {
    const getFxRate = vi.fn(async () => 32);

    const result = await translateHistoricalFxAmounts([
      { amount: 10, currency: "USD", date: "2026-06-03" },
      { amount: 25, currency: "USD", date: "2026-06-03" },
      { amount: 5, currency: "USD", date: "2026-06-04" },
    ], "TWD", { getFxRate });

    expect(result).toEqual({
      amount: 1280,
      missingRatePairs: [],
    });
    expect(getFxRate).toHaveBeenCalledTimes(2);
    expect(getFxRate).toHaveBeenNthCalledWith(1, "USD", "TWD", "2026-06-03");
    expect(getFxRate).toHaveBeenNthCalledWith(2, "USD", "TWD", "2026-06-04");
  });

  it("reports missing pairs once while preserving same-currency entries", async () => {
    const getFxRate = vi.fn(async () => null);

    const result = await translateHistoricalFxAmounts([
      { amount: 100, currency: "TWD", date: "2026-06-03" },
      { amount: 10, currency: "USD", date: "2026-06-03" },
      { amount: 5, currency: "USD", date: "2026-06-04" },
    ], "TWD", { getFxRate });

    expect(result).toEqual({
      amount: 100,
      missingRatePairs: [{ from: "USD", to: "TWD" }],
    });
    expect(getFxRate).toHaveBeenCalledTimes(2);
  });
});
