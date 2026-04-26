import { describe, it, expect } from "vitest";
import { resolveMarketCode } from "../../src/services/market-data/marketResolution.js";

describe("resolveMarketCode", () => {
  it("returns 'TW' for 4-digit TWSE tickers", () => {
    expect(resolveMarketCode("2330")).toBe("TW");
    expect(resolveMarketCode("0050")).toBe("TW");
    expect(resolveMarketCode("2317")).toBe("TW");
  });

  it("returns 'TW' for 5-digit/6-digit ETF and bond ETF tickers", () => {
    expect(resolveMarketCode("00878")).toBe("TW");
    expect(resolveMarketCode("00679B")).toBe("TW");
    expect(resolveMarketCode("006201")).toBe("TW");
  });

  it("returns 'TW' for the empty string and unknown shapes (KZO-163 stub behavior)", () => {
    // KZO-170 will replace this with instruments.market_code lookup + heuristic; until then,
    // every ticker resolves to 'TW' unconditionally.
    expect(resolveMarketCode("")).toBe("TW");
    expect(resolveMarketCode("AAPL")).toBe("TW");
    expect(resolveMarketCode("BHP.AX")).toBe("TW");
  });
});
