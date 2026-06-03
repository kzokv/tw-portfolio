import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";
import { RateLimitedError } from "../../src/services/market-data/types.js";

type FetchMock = ReturnType<typeof vi.fn>;

const STOCKS_FIXTURE = {
  status: "ok",
  data: [
    { symbol: "005930", name: "Samsung Electronics", type: "Common Stock", exchange: "KRX", mic_code: "XKRX" },
    { symbol: "005935", name: "Samsung Electronics Preferred", type: "Preferred Stock", exchange: "KRX", mic_code: "XKRX" },
    { symbol: "088260", name: "ESR Kendall Square REIT", type: "REIT", exchange: "KRX", mic_code: "XKRX" },
    { symbol: "069500", name: "KODEX 200 stock stub", type: "Common Stock", exchange: "KRX", mic_code: "XKRX" },
    { symbol: "580001", name: "Sample ETN", type: "ETN", exchange: "KRX", mic_code: "XKRX" },
    { symbol: "550001", name: "Sample Warrant", type: "Warrant", exchange: "KRX", mic_code: "XKRX" },
  ],
};

const ETF_FIXTURE = {
  status: "ok",
  data: [
    { symbol: "069500", name: "KODEX 200 ETF", exchange: "KRX", mic_code: "XKRX" },
  ],
};

const KOSDAQ_STOCKS_FIXTURE = {
  status: "ok",
  data: [
    { symbol: "035900", name: "JYP Entertainment", type: "Common Stock", exchange: "KOSDAQ", mic_code: "XKOS" },
  ],
};

const EMPTY_FIXTURE = {
  status: "ok",
  data: [],
};

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(body),
  } as Response;
}

interface KrCatalogFixtures {
  kosdaqEtf?: unknown;
  kosdaqStocks?: unknown;
  krxEtf?: unknown;
  krxStocks?: unknown;
}

function setupFetch(fetchMock: FetchMock, fixtures: KrCatalogFixtures = {}): void {
  const responses = {
    kosdaqEtf: EMPTY_FIXTURE,
    kosdaqStocks: KOSDAQ_STOCKS_FIXTURE,
    krxEtf: ETF_FIXTURE,
    krxStocks: STOCKS_FIXTURE,
    ...fixtures,
  };
  fetchMock.mockImplementation((url: string | URL) => {
    const value = url.toString();
    const parsed = new URL(value);
    const exchange = parsed.searchParams.get("exchange");
    if (parsed.pathname.endsWith("/stocks") && exchange === "KRX") {
      return Promise.resolve(ok(responses.krxStocks));
    }
    if (parsed.pathname.endsWith("/stocks") && exchange === "KOSDAQ") {
      return Promise.resolve(ok(responses.kosdaqStocks));
    }
    if (parsed.pathname.endsWith("/etf") && exchange === "KRX") {
      return Promise.resolve(ok(responses.krxEtf));
    }
    if (parsed.pathname.endsWith("/etf") && exchange === "KOSDAQ") {
      return Promise.resolve(ok(responses.kosdaqEtf));
    }
    return Promise.reject(new Error(`Unexpected URL ${value}`));
  });
}

describe("MockTwelveDataKrCatalogProvider", () => {
  it("filters ETNs/warrants and delegates metadata/search to Yahoo fallback", async () => {
    const { MockTwelveDataKrCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const yahooFallback = {
      fetchInstrumentMetadata: vi.fn().mockResolvedValue({
        ticker: "005930",
        name: "Samsung Electronics",
        typeRaw: "KRX",
        industryCategory: "EQUITY",
        date: "2026-05-30",
      }),
      searchInstruments: vi.fn().mockResolvedValue([]),
    };
    const provider = new MockTwelveDataKrCatalogProvider({ yahooFallback: yahooFallback as never });
    const catalog = await provider.fetchInstrumentCatalog();

    expect(catalog.map((row) => row.ticker)).toEqual(["069500", "005930", "005935", "088260", "035900"]);
    expect(catalog.every((row) => row.industryCategory !== "ETN" && row.industryCategory !== "Warrant")).toBe(true);
    await provider.fetchInstrumentMetadata("005930");
    await provider.searchInstruments("Samsung");
    expect(yahooFallback.fetchInstrumentMetadata).toHaveBeenCalledWith("005930");
    expect(yahooFallback.searchInstruments).toHaveBeenCalledWith("Samsung");
  });
});

describe("TwelveDataKrCatalogProvider — real provider against stubbed fetch", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function makeProvider(rateLimitPerMinute = 8) {
    const { TwelveDataKrCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    return new TwelveDataKrCatalogProvider({
      apiKey: "test-key",
      baseUrl: "https://api.twelvedata.test",
      rateLimiter: new RateLimiter(rateLimitPerMinute, 60_000),
      yahooFallback: {
        providerId: "yahoo-finance-kr",
        supportsMetadataEnrichment: true,
        supportsDelistingFeed: false,
        absenceDetectionEnabled: false,
        fetchInstrumentCatalog: vi.fn().mockResolvedValue([]),
        fetchDelistingHistory: vi.fn().mockResolvedValue([]),
        fetchInstrumentMetadata: vi.fn().mockResolvedValue(null),
        searchInstruments: vi.fn().mockResolvedValue([]),
        reserveCapacity: vi.fn(),
      },
    });
  }

  it("fetchInstrumentCatalog calls KRX/KOSDAQ stocks/etf endpoints, includes stock-like rows, excludes ETNs/warrants, and lets ETF win duplicates", async () => {
    setupFetch(fetchMock);
    const provider = await makeProvider();
    const catalog = await provider.fetchInstrumentCatalog();

    expect(fetchMock.mock.calls.map((call) => call[0].toString())).toEqual([
      expect.stringContaining("/stocks?exchange=KRX"),
      expect.stringContaining("/stocks?exchange=KOSDAQ"),
      expect.stringContaining("/etf?exchange=KRX"),
      expect.stringContaining("/etf?exchange=KOSDAQ"),
    ]);
    expect(catalog.map((row) => row.ticker)).toEqual(["069500", "005930", "005935", "088260", "035900"]);
    expect(catalog.find((row) => row.ticker === "069500")).toMatchObject({
      name: "KODEX 200 ETF",
      typeRaw: "KRX",
      industryCategory: "ETF",
      catalogExchangeRaw: "KRX",
      catalogMicCode: "XKRX",
    });
    expect(catalog.find((row) => row.ticker === "035900")).toMatchObject({
      name: "JYP Entertainment",
      typeRaw: "KRX",
      industryCategory: "Common Stock",
      catalogExchangeRaw: "KOSDAQ",
      catalogMicCode: "XKOS",
    });
    expect(catalog.some((row) => row.ticker === "580001" || row.ticker === "550001")).toBe(false);
  });

  it("throws when Twelve Data returns a non-XKRX MIC row", async () => {
    setupFetch(fetchMock, {
      krxStocks: {
        status: "ok",
        data: [{ symbol: "005930", name: "Samsung Electronics", type: "Common Stock", mic_code: "XNAS" }],
      },
    });
    const provider = await makeProvider();
    await expect(provider.fetchInstrumentCatalog()).rejects.toThrow(/twelve_data_kr_mic_mismatch/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 429 responses to RateLimitedError", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" });
    const provider = await makeProvider();
    await expect(provider.fetchInstrumentCatalog()).rejects.toBeInstanceOf(RateLimitedError);
  });
});
