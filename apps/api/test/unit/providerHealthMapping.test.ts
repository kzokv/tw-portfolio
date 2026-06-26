import { describe, expect, it } from "vitest";
import { calendarMarketForProvider } from "../../src/services/market-data/providerHealth.js";

describe("calendarMarketForProvider", () => {
  it("maps JP providers to the JP trading calendar", () => {
    expect(calendarMarketForProvider("twelve-data-jp")).toBe("JP");
    expect(calendarMarketForProvider("yahoo-finance-jp")).toBe("JP");
  });

  it("keeps FX provider mapped to the synthetic FX calendar", () => {
    expect(calendarMarketForProvider("frankfurter")).toBe("FX");
  });
});
