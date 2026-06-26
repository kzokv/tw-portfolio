import { describe, expect, it } from "vitest";
import { MockYahooFinanceJpMarketDataProvider } from "../../src/services/market-data/providers/index.js";
import {
  stripYahooJpSuffix,
  toYahooJpSymbol,
} from "../../src/services/market-data/providers/yahooFinanceJp.js";

describe("YahooFinanceJp symbol normalization", () => {
  it("normalizes bare and suffixed JP tickers at the provider boundary", () => {
    expect(stripYahooJpSuffix("7203")).toBe("7203");
    expect(stripYahooJpSuffix("7203.t")).toBe("7203");
    expect(stripYahooJpSuffix(" 130A.T ")).toBe("130A");
    expect(toYahooJpSymbol("7203")).toBe("7203.T");
    expect(toYahooJpSymbol("130A.T")).toBe("130A.T");
  });

  it("persists bare tickers when bars, dividends, metadata, and search use Yahoo .T inputs", async () => {
    const provider = new MockYahooFinanceJpMarketDataProvider();

    const [bars, dividends, metadata, search] = await Promise.all([
      provider.fetchBars("7203.T"),
      provider.fetchDividends("7203.T"),
      provider.fetchInstrumentMetadata("1306.T"),
      provider.searchInstruments("1306.T"),
    ]);

    expect(bars[0]?.ticker).toBe("7203");
    expect(dividends[0]?.ticker).toBe("7203");
    expect(metadata?.ticker).toBe("1306");
    expect(search[0]?.ticker).toBe("1306");
  });
});
