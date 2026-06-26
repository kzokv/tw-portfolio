import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../src/services/appConfig/cache.js";
import { seedCache } from "./appConfig/_helpers.js";

type FetchMock = ReturnType<typeof vi.fn>;

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as Response;
}

const STOCKS_FIXTURE = {
  status: "ok",
  data: [
    { symbol: "7203", name: "Toyota Motor Corporation", currency: "JPY", exchange: "JPX", mic_code: "XJPX", country: "Japan", type: "Common Stock" },
    { symbol: "7167", name: "Preferred Sample", currency: "JPY", exchange: "JPX", mic_code: "XJPX", country: "Japan", type: "Preferred Stock" },
    { symbol: "8951", name: "Nippon Building Fund", currency: "JPY", exchange: "JPX", mic_code: "XJPX", country: "Japan", type: "REIT" },
    { symbol: "8306ADR", name: "DR Sample", currency: "JPY", exchange: "JPX", mic_code: "XJPX", country: "Japan", type: "Depositary Receipt" },
    { symbol: "7203@JP", name: "@ Sample", currency: "JPY", exchange: "JPX", mic_code: "XJPX", country: "Japan", type: "Common Stock" },
    { symbol: "1329", name: "Duplicate ETF Stock Row", currency: "JPY", exchange: "JPX", mic_code: "XJPX", country: "Japan", type: "Common Stock" },
    { symbol: "9999", name: "Warrant Sample", currency: "JPY", exchange: "JPX", mic_code: "XJPX", country: "Japan", type: "Warrant" },
    { symbol: "USD1", name: "Wrong Currency", currency: "USD", exchange: "JPX", mic_code: "XJPX", country: "Japan", type: "Common Stock" },
  ],
};

const ETF_FIXTURE = {
  status: "ok",
  data: [
    { symbol: "1306", name: "TOPIX ETF", currency: "JPY", exchange: "JPX", mic_code: "XJPX", country: "Japan" },
    { symbol: "1329", name: "iShares ETF", currency: "JPY", exchange: "JPX", mic_code: "XJPX", country: "Japan" },
  ],
};

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

describe("TwelveDataJpCatalogProvider", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    _resetAppConfigCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    _resetAppConfigCache();
  });

  async function makeProvider() {
    const { TwelveDataJpCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const yahooFallback = {
      providerId: "yahoo-finance-jp",
      supportsMetadataEnrichment: true,
      supportsDelistingFeed: false,
      absenceDetectionEnabled: false,
      fetchInstrumentCatalog: vi.fn().mockResolvedValue([]),
      fetchDelistingHistory: vi.fn().mockResolvedValue([]),
      fetchInstrumentMetadata: vi.fn().mockResolvedValue(null),
      searchInstruments: vi.fn().mockResolvedValue([]),
      reserveCapacity: vi.fn(),
    };
    return {
      provider: new TwelveDataJpCatalogProvider({
        apiKey: "test-key",
        baseUrl: "https://api.twelvedata.test",
        rateLimiter: new RateLimiter(8, 60_000),
        yahooFallback,
      }),
      yahooFallback,
    };
  }

  it("uses strict default filters for JPX/JPY rows and lets ETF rows win duplicates", async () => {
    fetchMock
      .mockResolvedValueOnce(ok(STOCKS_FIXTURE))
      .mockResolvedValueOnce(ok(ETF_FIXTURE));
    const { provider } = await makeProvider();

    const catalog = await provider.fetchInstrumentCatalog();

    expect(fetchMock.mock.calls.map((call) => call[0].toString())).toEqual([
      expect.stringContaining("/stocks?country=Japan"),
      expect.stringContaining("/etf?country=Japan"),
    ]);
    expect(catalog.map((row) => row.ticker)).toEqual(["1306", "1329", "7203", "7167", "8951"]);
    expect(catalog.find((row) => row.ticker === "1329")).toMatchObject({
      name: "iShares ETF",
      industryCategory: "ETF",
      catalogExchangeRaw: "JPX",
      catalogMicCode: "XJPX",
    });
    expect(catalog.some((row) => row.ticker === "8306ADR")).toBe(false);
    expect(catalog.some((row) => row.ticker === "7203@JP")).toBe(false);
    expect(catalog.some((row) => row.ticker === "9999")).toBe(false);
    expect(catalog.some((row) => row.ticker === "USD1")).toBe(false);
  });

  it("honors relaxed app_config inclusion for depositary receipts and @ symbols", async () => {
    await seedCache({
      jpCatalogAllowedStockTypes: ["Common Stock", "Preferred Stock", "REIT", "Depositary Receipt"],
      jpCatalogIncludeDepositaryReceipts: true,
      jpCatalogIncludeAtSymbols: true,
    }, cacheModule);
    fetchMock
      .mockResolvedValueOnce(ok(STOCKS_FIXTURE))
      .mockResolvedValueOnce(ok(ETF_FIXTURE));
    const { provider } = await makeProvider();

    const catalog = await provider.fetchInstrumentCatalog();

    expect(catalog.map((row) => row.ticker)).toContain("8306ADR");
    expect(catalog.map((row) => row.ticker)).toContain("7203@JP");
  });

  it("delegates metadata and search to the Yahoo fallback", async () => {
    const { provider, yahooFallback } = await makeProvider();

    await provider.fetchInstrumentMetadata("7203");
    await provider.searchInstruments("toyota");

    expect(yahooFallback.fetchInstrumentMetadata).toHaveBeenCalledWith("7203");
    expect(yahooFallback.searchInstruments).toHaveBeenCalledWith("toyota");
  });
});
