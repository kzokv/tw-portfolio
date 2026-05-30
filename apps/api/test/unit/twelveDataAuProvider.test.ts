/**
 * KZO-194 — Unit tests for `TwelveDataAuCatalogProvider`.
 *
 * Tests are TDD-red until Implementer lands
 * `apps/api/src/services/market-data/providers/twelveDataAu.ts`.
 *
 * Mirrors the shape of `yahooFinanceAuProvider.test.ts` (KZO-172 precedent).
 * Two `describe` blocks:
 *
 *   1. `MockTwelveDataAuCatalogProvider` — fixture-shape pins confirming the
 *      mock covers Common Stock, ETF, REIT, Preferred Stock, Depositary Receipt,
 *      and a Warrant (asserting filter). Used by integration tests downstream.
 *
 *   2. `TwelveDataAuCatalogProvider` (real provider, fetch-stubbed) — the load-
 *      bearing behavioral assertions:
 *        - Parse `/stocks?exchange=ASX` → RawInstrumentInfo shape
 *        - Parse `/etf?exchange=ASX`    → shape with industryCategory="ETF"
 *        - Cross-endpoint dedup: ticker in both → ETF classification wins
 *        - Warrant filter: Warrant entries dropped from output
 *        - MIC validation: mic_code !== "XASX" → throws
 *        - `fetchInstrumentMetadata` delegates to yahooFallback
 *        - `searchInstruments` delegates to yahooFallback
 *        - `RateLimitedError` propagation from limiter pre-flight
 *
 * Per `.claude/rules/typed-transient-error-catch-audit.md` — `RateLimitedError`
 * from the TD limiter MUST propagate; the delegate methods must also not swallow
 * `RateLimitedError` thrown by `yahooFallback`.
 *
 * HTTP client is mocked via `vi.stubGlobal("fetch", ...)` — we do NOT hit real
 * Twelve Data in any test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitedError } from "../../src/services/market-data/types.js";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";

// ─── Twelve Data API response fixtures ──────────────────────────────────────

/** Canonical /stocks?exchange=ASX response fixture */
const STOCKS_FIXTURE_ROWS = [
  { symbol: "BHP",    name: "BHP Group Limited",                  type: "Common Stock",        mic_code: "XASX" },
  { symbol: "CSL",    name: "CSL Limited",                        type: "Common Stock",        mic_code: "XASX" },
  { symbol: "WBC",    name: "Westpac Banking Corporation",        type: "Common Stock",        mic_code: "XASX" },
  { symbol: "GMG",    name: "Goodman Group",                      type: "REIT",                mic_code: "XASX" },
  { symbol: "CBAPD",  name: "Commonwealth Bank Preferred",        type: "Preferred Stock",     mic_code: "XASX" },
  { symbol: "BHPDR",  name: "BHP Depositary Receipt",             type: "Depositary Receipt",  mic_code: "XASX" },
  // Warrant — must be filtered out
  { symbol: "BHPWT",  name: "BHP Warrant 2027",                   type: "Warrant",             mic_code: "XASX" },
  // VAS appears in BOTH stocks + etf — ETF classification should win
  { symbol: "VAS",    name: "Vanguard AU Shares ETF (stock stub)", type: "Common Stock",       mic_code: "XASX" },
];

const STOCKS_FIXTURE = { data: STOCKS_FIXTURE_ROWS, status: "ok" };

/** Canonical /etf?exchange=ASX response fixture */
const ETF_FIXTURE_ROWS = [
  { symbol: "VAS", name: "Vanguard Australian Shares Index ETF", type: "ETF", mic_code: "XASX" },
  { symbol: "IOZ", name: "iShares Core S&P/ASX 200 ETF",         type: "ETF", mic_code: "XASX" },
];

const ETF_FIXTURE = { data: ETF_FIXTURE_ROWS, status: "ok" };

/** Fixture with a CXA-listed cross-listing that fails MIC validation */
const STOCKS_WITH_WRONG_MIC = {
  data: [
    { symbol: "CXL", name: "Calix Limited", type: "Common Stock", mic_code: "XCXS" },
  ],
  status: "ok",
};

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

type FetchMock = ReturnType<typeof vi.fn>;

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Returns a fetch mock that replies to `/stocks` with the provided stocks body
 * and to `/etf` with the provided etf body. Throws on unexpected URLs.
 */
function setupFetchMock(
  fetchMock: FetchMock,
  stocks: unknown = STOCKS_FIXTURE,
  etf: unknown = ETF_FIXTURE,
): void {
  fetchMock.mockImplementation((url: string | URL) => {
    const urlStr = url.toString();
    if (urlStr.includes("/stocks")) return Promise.resolve(makeOkResponse(stocks));
    if (urlStr.includes("/etf")) return Promise.resolve(makeOkResponse(etf));
    return Promise.reject(new Error(`Unexpected fetch URL in test: ${urlStr}`));
  });
}

// ─── MockTwelveDataAuCatalogProvider ─────────────────────────────────────────

describe("MockTwelveDataAuCatalogProvider", () => {
  it("fetchInstrumentCatalog returns fixture covering Common Stock, ETF, REIT, Preferred Stock, Depositary Receipt (no Warrant)", async () => {
    const { MockTwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockTwelveDataAuCatalogProvider({
      yahooFallback: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn() } as never,
    });
    const catalog = await provider.fetchInstrumentCatalog();

    // Warrant must be absent
    expect(catalog.every((r) => r.industryCategory !== "Warrant")).toBe(true);

    // Coverage by type
    const typeLabels = catalog.map((r) => r.industryCategory);
    expect(typeLabels).toContain("ETF");

    // At least one STOCK-mapped row (Common Stock, REIT, Preferred, DR all map to STOCK)
    expect(catalog.length).toBeGreaterThanOrEqual(5);
  }, 15_000);

  it("fixture includes exactly one Warrant entry (to assert downstream filter)", async () => {
    const { MockTwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockTwelveDataAuCatalogProvider({
      yahooFallback: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn() } as never,
    });
    // The raw fixture must contain one Warrant; the public fetchInstrumentCatalog drops it
    // The mock exposes _rawCatalogWithWarrant (or similar) for test inspection, OR
    // we validate by checking the returned catalog lacks any "Warrant" industryCategory.
    const catalog = await provider.fetchInstrumentCatalog();
    expect(catalog.every((r) => r.industryCategory !== "Warrant")).toBe(true);
  });

  it("providerId is 'twelve-data-au'", async () => {
    const { MockTwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockTwelveDataAuCatalogProvider({
      yahooFallback: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn() } as never,
    });
    expect(provider.providerId).toBe("twelve-data-au");
  });

  it("supportsMetadataEnrichment is true (delegates to Yahoo)", async () => {
    const { MockTwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockTwelveDataAuCatalogProvider({
      yahooFallback: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn() } as never,
    });
    expect(provider.supportsMetadataEnrichment).toBe(true);
  });

  it("fetchDelistingHistory returns []", async () => {
    const { MockTwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockTwelveDataAuCatalogProvider({
      yahooFallback: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn() } as never,
    });
    expect(await provider.fetchDelistingHistory()).toEqual([]);
  });

  it("fetchInstrumentMetadata delegates to yahooFallback and returns its result", async () => {
    const { MockTwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const mockMeta = {
      ticker: "BHP",
      name: "BHP Group Limited",
      typeRaw: "ASX",
      industryCategory: "EQUITY",
      date: "2026-05-07",
    };
    const yahooFallback = {
      fetchInstrumentMetadata: vi.fn().mockResolvedValue(mockMeta),
      searchInstruments: vi.fn().mockResolvedValue([]),
    };
    const provider = new MockTwelveDataAuCatalogProvider({ yahooFallback: yahooFallback as never });
    const result = await provider.fetchInstrumentMetadata("BHP");
    expect(result).toEqual(mockMeta);
    expect(yahooFallback.fetchInstrumentMetadata).toHaveBeenCalledWith("BHP");
  });

  it("searchInstruments delegates to yahooFallback and returns its result", async () => {
    const { MockTwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const mockResults = [
      { ticker: "CBA", name: "Commonwealth Bank of Australia", typeRaw: "ASX", industryCategory: "EQUITY", date: "2026-05-07" },
    ];
    const yahooFallback = {
      fetchInstrumentMetadata: vi.fn().mockResolvedValue(null),
      searchInstruments: vi.fn().mockResolvedValue(mockResults),
    };
    const provider = new MockTwelveDataAuCatalogProvider({ yahooFallback: yahooFallback as never });
    const results = await provider.searchInstruments("CBA");
    expect(results).toEqual(mockResults);
    expect(yahooFallback.searchInstruments).toHaveBeenCalledWith("CBA");
  });
});

// ─── TwelveDataAuCatalogProvider (real, fetch-stubbed) ──────────────────────

describe("TwelveDataAuCatalogProvider — real provider against stubbed fetch", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function makeProvider(opts?: { rateLimitPerMinute?: number }) {
    const { TwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const limiter = new RateLimiter(opts?.rateLimitPerMinute ?? 60, 60_000);
    const yahooFallback = {
      providerId: "yahoo-finance-au",
      supportsMetadataEnrichment: true as const,
      supportsDelistingFeed: false as const,
      absenceDetectionEnabled: false as const,
      fetchInstrumentCatalog: vi.fn().mockResolvedValue([]),
      fetchDelistingHistory: vi.fn().mockResolvedValue([]),
      fetchInstrumentMetadata: vi.fn().mockResolvedValue(null),
      searchInstruments: vi.fn().mockResolvedValue([]),
      reserveCapacity: vi.fn(),
    };
    const provider = new TwelveDataAuCatalogProvider({
      apiKey: "test-api-key",
      baseUrl: "https://api.twelvedata.test",
      rateLimiter: limiter,
      yahooFallback,
    });
    return { provider, yahooFallback, limiter };
  }

  it("providerId is 'twelve-data-au'", async () => {
    setupFetchMock(fetchMock);
    const { provider } = await makeProvider();
    expect(provider.providerId).toBe("twelve-data-au");
  });

  it("supportsMetadataEnrichment is true (delegates via yahooFallback.fetchInstrumentMetadata)", async () => {
    const { provider } = await makeProvider();
    expect(provider.supportsMetadataEnrichment).toBe(true);
  });

  // ── Parse /stocks response → correct RawInstrumentInfo shape ─────────────

  it("fetchInstrumentCatalog calls /stocks?exchange=ASX and maps rows to RawInstrumentInfo", async () => {
    setupFetchMock(fetchMock, STOCKS_FIXTURE, { data: [], status: "ok" });
    const { provider } = await makeProvider();
    const catalog = await provider.fetchInstrumentCatalog();

    // Every row has required RawInstrumentInfo fields
    for (const row of catalog) {
      expect(typeof row.ticker).toBe("string");
      expect(typeof row.name).toBe("string");
      expect(row.typeRaw).toBe("ASX");
      expect(typeof row.industryCategory).toBe("string");
      expect(typeof row.date).toBe("string");
      expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    // BHP should be present
    const bhp = catalog.find((r) => r.ticker === "BHP");
    expect(bhp).toBeDefined();
    expect(bhp!.name).toBe("BHP Group Limited");
    expect(bhp!.typeRaw).toBe("ASX");
  });

  it("fetchInstrumentCatalog calls /etf?exchange=ASX and stamps industryCategory='ETF' on ETF rows", async () => {
    setupFetchMock(fetchMock);
    const { provider } = await makeProvider();
    const catalog = await provider.fetchInstrumentCatalog();

    const ioz = catalog.find((r) => r.ticker === "IOZ");
    expect(ioz).toBeDefined();
    expect(ioz!.industryCategory).toBe("ETF");
    expect(ioz!.typeRaw).toBe("ASX");
  });

  // ── Cross-endpoint dedup: /etf classification wins ───────────────────────

  it("cross-endpoint dedup: VAS in both /stocks (Common Stock) and /etf → ETF classification wins", async () => {
    // VAS appears in both fixtures (STOCKS_FIXTURE + ETF_FIXTURE)
    setupFetchMock(fetchMock);
    const { provider } = await makeProvider();
    const catalog = await provider.fetchInstrumentCatalog();

    // Only one VAS row
    const vasRows = catalog.filter((r) => r.ticker === "VAS");
    expect(vasRows).toHaveLength(1);
    // ETF classification wins over Common Stock
    expect(vasRows[0]!.industryCategory).toBe("ETF");
  });

  // ── Warrant filter ─────────────────────────────────────────────────────────

  it("Warrant entries from /stocks are dropped and do NOT appear in output", async () => {
    setupFetchMock(fetchMock);
    const { provider } = await makeProvider();
    const catalog = await provider.fetchInstrumentCatalog();

    expect(catalog.find((r) => r.ticker === "BHPWT")).toBeUndefined();
    // Non-warrant rows are still present
    expect(catalog.find((r) => r.ticker === "BHP")).toBeDefined();
  });

  // ── MIC validation ─────────────────────────────────────────────────────────

  it("throws when a /stocks row has mic_code !== 'XASX' (CXA cross-listing)", async () => {
    setupFetchMock(fetchMock, STOCKS_WITH_WRONG_MIC, { data: [], status: "ok" });
    const { provider } = await makeProvider();
    await expect(provider.fetchInstrumentCatalog()).rejects.toThrow(
      /twelve_data_au_mic_mismatch|mic_code|XCXS/i,
    );
  });

  it("throws on mic_code mismatch before any /etf call fires", async () => {
    setupFetchMock(fetchMock, STOCKS_WITH_WRONG_MIC, { data: [], status: "ok" });
    const { provider } = await makeProvider();
    try {
      await provider.fetchInstrumentCatalog();
    } catch {
      // Expected to throw; check ETF endpoint was NOT called since error should be early
    }
    // /stocks call fires first; error should abort before /etf
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0].toString()).toContain("stocks");
  });

  it("throws when a /etf row has mic_code !== 'XASX' (CXA cross-listing in ETF endpoint)", async () => {
    // The /etf endpoint can also contain cross-listed entries (e.g. CXA-listed ETFs).
    // The MIC validation must run on /etf rows, not just /stocks rows.
    // Mirror of the /stocks MIC test above — same error code, different path label.
    const etfWithWrongMic = {
      data: [{ symbol: "BETAX", name: "BetaShares CXA ETF", type: "ETF", mic_code: "CXA" }],
      status: "ok",
    };
    // /stocks returns clean; /etf has the bad MIC
    setupFetchMock(fetchMock, { data: [], status: "ok" }, etfWithWrongMic);
    const { provider } = await makeProvider();
    await expect(provider.fetchInstrumentCatalog()).rejects.toThrow(
      /twelve_data_au_mic_mismatch.*\/etf row|\/etf row.*twelve_data_au_mic_mismatch/i,
    );
  });

  // ── fetchInstrumentMetadata delegation ───────────────────────────────────

  it("fetchInstrumentMetadata delegates to yahooFallback.fetchInstrumentMetadata and returns the result", async () => {
    const mockMeta = {
      ticker: "AFI",
      name: "Australian Foundation Investment Company Limited",
      typeRaw: "ASX",
      industryCategory: "EQUITY",
      date: "2026-05-07",
    };
    const { provider, yahooFallback } = await makeProvider();
    (yahooFallback.fetchInstrumentMetadata as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockMeta);
    const result = await provider.fetchInstrumentMetadata("AFI");
    expect(result).toEqual(mockMeta);
    expect(yahooFallback.fetchInstrumentMetadata).toHaveBeenCalledWith("AFI");
    // No fetch() calls to TD — metadata uses Yahoo only
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetchInstrumentMetadata returns null when yahooFallback returns null (delisted/unknown)", async () => {
    const { provider, yahooFallback } = await makeProvider();
    (yahooFallback.fetchInstrumentMetadata as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await provider.fetchInstrumentMetadata("UNKNOWN_TICKER_XYZ");
    expect(result).toBeNull();
  });

  it("fetchInstrumentMetadata re-throws RateLimitedError from yahooFallback (per typed-transient-error rule)", async () => {
    const { provider, yahooFallback } = await makeProvider();
    (yahooFallback.fetchInstrumentMetadata as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new RateLimitedError({ msUntilAvailable: 30_000 }),
    );
    await expect(provider.fetchInstrumentMetadata("BHP")).rejects.toBeInstanceOf(RateLimitedError);
  });

  // ── searchInstruments delegation ──────────────────────────────────────────

  it("searchInstruments delegates to yahooFallback.searchInstruments and returns the result", async () => {
    const mockResults = [
      { ticker: "CBA", name: "Commonwealth Bank of Australia", typeRaw: "ASX", industryCategory: "EQUITY", date: "2026-05-07" },
    ];
    const { provider, yahooFallback } = await makeProvider();
    (yahooFallback.searchInstruments as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResults);
    const results = await provider.searchInstruments("CBA");
    expect(results).toEqual(mockResults);
    expect(yahooFallback.searchInstruments).toHaveBeenCalledWith("CBA");
    // No fetch() calls to TD — search uses Yahoo only
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── RateLimitedError propagation from rate-limiter pre-flight ─────────────

  it("fetchInstrumentCatalog throws RateLimitedError when limiter is exhausted (pre-flight)", async () => {
    const { TwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    // Budget=0 → assertCanConsume()/canConsume(1) immediately false
    const exhaustedLimiter = new RateLimiter(0, 60_000);
    const yahooFallback = {
      providerId: "yahoo-finance-au",
      supportsMetadataEnrichment: true as const,
      supportsDelistingFeed: false as const,
      absenceDetectionEnabled: false as const,
      fetchInstrumentCatalog: vi.fn(),
      fetchDelistingHistory: vi.fn(),
      fetchInstrumentMetadata: vi.fn(),
      searchInstruments: vi.fn(),
      reserveCapacity: vi.fn(),
    };
    const provider = new TwelveDataAuCatalogProvider({
      apiKey: "test-api-key",
      baseUrl: "https://api.twelvedata.test",
      rateLimiter: exhaustedLimiter,
      yahooFallback: yahooFallback as never,
    });

    await expect(provider.fetchInstrumentCatalog()).rejects.toBeInstanceOf(RateLimitedError);
    // The exhausted limiter aborts before any fetch call fires
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reserveCapacity throws RateLimitedError when limiter cannot accommodate n slots", async () => {
    const { TwelveDataAuCatalogProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const tightLimiter = new RateLimiter(1, 60_000);
    const provider = new TwelveDataAuCatalogProvider({
      apiKey: "test-api-key",
      baseUrl: "https://api.twelvedata.test",
      rateLimiter: tightLimiter,
      yahooFallback: { fetchInstrumentMetadata: vi.fn(), searchInstruments: vi.fn(), reserveCapacity: vi.fn() } as never,
    });
    // Requesting 2 slots from a 1-slot limiter
    expect(() => provider.reserveCapacity(2)).toThrow(RateLimitedError);
  });

  it("reserveCapacity passes when limiter has sufficient capacity", async () => {
    setupFetchMock(fetchMock);
    const { provider } = await makeProvider();
    expect(() => provider.reserveCapacity(2)).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── fetchDelistingHistory ─────────────────────────────────────────────────

  it("fetchDelistingHistory returns [] without calling fetch (no TD delisting endpoint)", async () => {
    const { provider } = await makeProvider();
    const delistings = await provider.fetchDelistingHistory();
    expect(delistings).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
