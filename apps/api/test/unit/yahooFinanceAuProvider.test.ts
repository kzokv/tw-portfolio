/**
 * KZO-172 — `YahooFinanceAuMarketDataProvider` + `MockYahooFinanceAuMarketDataProvider`.
 *
 * Mirrors the structure of `apps/api/test/unit/finmindUsStockProvider.test.ts` (KZO-170
 * precedent). Two `describe` blocks:
 *
 *   1. `MockYahooFinanceAuMarketDataProvider` — fixture shape pins for the integration
 *      test's downstream assertions (≥4 BHP dividends spanning ≥3 years for AC #2,
 *      VAS=ETF for the classifier test, CBA findable via search for KZO-188 prep).
 *
 *   2. `YahooFinanceAuMarketDataProvider` (real provider, `vi.mock`-stubbed
 *      `yahoo-finance2` SDK) — load-bearing assertions:
 *        - Every SDK call's first arg ends in `.AX` (the `normalizeSymbol` audit
 *          per spike §normalizeSymbol + `.claude/rules/process-refactor-rename-verification.md`)
 *        - `sourceId === "yahoo-finance-au"` is stamped on every produced row
 *        - Australia/Sydney TZ shift normalizes UTC bar timestamps to ASX session dates
 *        - `searchInstruments` defensive double-filter (`exchange === "ASX"` AND
 *          `symbol.endsWith(".AX")`) rejects cross-listed NYS results and
 *          partial-suffix mismatches
 *        - Error mapping: SDK errors propagate, `RateLimitedError` re-throws cleanly
 *          from `fetchInstrumentMetadata` per `.claude/rules/typed-transient-error-catch-audit.md`
 *
 * Per Architect's F-Q1 ruling, the file lives under `apps/api/test/unit/` per
 * repo convention (matches `finmindUsStockProvider.test.ts`). Placing tests
 * under `apps/api/src/` would pull them into the production build graph
 * (`apps/api/tsconfig.json` has `rootDir: src` + `include: src` glob).
 *
 * Reserved AU tickers used here: BHP, CSL, VAS, WBC, AFI, GMG, IMD, CBA per
 * `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitedError } from "../../src/services/market-data/types.js";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";

// ─── yahoo-finance2 SDK stub ─────────────────────────────────────────────────
// Each test gets a fresh SDK mock via `__setSdkStub`. The provider's constructor
// reads `new YahooFinance(...)` — the mock's default export is a class whose
// instance methods (`chart`, `quote`, `search`) are populated per-test from the
// active stub. This keeps every test self-contained without leaky module state.

interface SdkStub {
  chart: ReturnType<typeof vi.fn>;
  quote: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
}

let activeSdkStub: SdkStub | null = null;

function makeSdkStub(): SdkStub {
  return {
    chart: vi.fn(),
    quote: vi.fn(),
    search: vi.fn(),
  };
}

vi.mock("yahoo-finance2", () => {
  // Default export must be a constructable class. The instance proxies through
  // to whichever `activeSdkStub` is set when the test runs. Cast through
  // `(fn: (...args: unknown[]) => unknown)` because Vitest's `Mock` union type
  // is not directly callable in strict TS — the stub is functional at runtime.
  class FakeYahooFinance {
    chart = (...args: unknown[]) =>
      (activeSdkStub!.chart as unknown as (...a: unknown[]) => unknown)(...args);
    quote = (...args: unknown[]) =>
      (activeSdkStub!.quote as unknown as (...a: unknown[]) => unknown)(...args);
    search = (...args: unknown[]) =>
      (activeSdkStub!.search as unknown as (...a: unknown[]) => unknown)(...args);
  }
  return { default: FakeYahooFinance };
});

// ── MockYahooFinanceAuMarketDataProvider ─────────────────────────────────────

describe("MockYahooFinanceAuMarketDataProvider", () => {
  it("exposes providerId = 'yahoo-finance-au'", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    expect(provider.providerId).toBe("yahoo-finance-au");
  });

  it("returns deterministic BHP bars from default fixtureStartDate (2024-01-02)", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    const bars = await provider.fetchBars("BHP");

    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]).toMatchObject({ ticker: "BHP", sourceId: "yahoo-finance-au" });
    expect(bars[0]!.barDate >= "2024-01-02").toBe(true);
    expect(bars[0]!.high).toBeGreaterThan(bars[0]!.low);
    expect(bars[0]!.volume).toBeGreaterThan(0);
  });

  it("returns deterministic bars for the 5 memory-backed reserved AU tickers (BHP/CSL/VAS/WBC/AFI)", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    for (const ticker of ["BHP", "CSL", "VAS", "WBC", "AFI"]) {
      const bars = await provider.fetchBars(ticker);
      expect(bars.length).toBeGreaterThan(0);
      expect(bars.every((b) => b.ticker === ticker)).toBe(true);
      expect(bars.every((b) => b.sourceId === "yahoo-finance-au")).toBe(true);
      expect(bars.every((b) => b.barDate >= "2024-01-02")).toBe(true);
    }
  });

  it("BHP fixture dividends: ≥4 entries spanning ≥3 distinct years (AC #2 enforcement)", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    const dividends = await provider.fetchDividends("BHP");

    // AC #2 floor: ≥4 entries.
    expect(dividends.length).toBeGreaterThanOrEqual(4);

    // Span: across ≥3 distinct calendar years.
    const years = new Set(dividends.map((d) => d.exDividendDate.slice(0, 4)));
    expect(years.size).toBeGreaterThanOrEqual(3);

    // Every record stamped with the AU sourceId.
    expect(dividends.every((d) => d.sourceId === "yahoo-finance-au")).toBe(true);
    // exDividendDate ascending (deterministic ordering).
    for (let i = 1; i < dividends.length; i++) {
      expect(dividends[i]!.exDividendDate >= dividends[i - 1]!.exDividendDate).toBe(true);
    }
  });

  it("fetchInstrumentCatalog returns [] (KZO-194: AU catalog ownership moved to TwelveDataAuCatalogProvider)", async () => {
    const { MockYahooFinanceAuMarketDataProvider, MOCK_AU_INSTRUMENT_CATALOG } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    const catalog = await provider.fetchInstrumentCatalog();

    // Yahoo's `fetchInstrumentCatalog` is a no-op post-KZO-194; the reserved-set
    // export mirrors that no-op so anything that imported `MOCK_AU_INSTRUMENT_CATALOG`
    // for legacy reasons sees the same shape.
    expect(catalog).toEqual([]);
    expect(MOCK_AU_INSTRUMENT_CATALOG).toEqual([]);
  });

  it("fetchDelistingHistory returns []", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    expect(await provider.fetchDelistingHistory()).toEqual([]);
  });

  it("fetchInstrumentMetadata returns enriched row for known ticker, null for unknown", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    const meta = await provider.fetchInstrumentMetadata("BHP");
    expect(meta).not.toBeNull();
    expect(meta).toMatchObject({
      ticker: "BHP",
      typeRaw: "ASX",
      industryCategory: "EQUITY",
    });
    expect(typeof meta!.name).toBe("string");
    expect(meta!.name.length).toBeGreaterThan(0);

    expect(await provider.fetchInstrumentMetadata("UNKNOWN_NEVER_LISTED_XYZ")).toBeNull();
  });

  it("fetchInstrumentMetadata recognizes CBA even though CBA is NOT in the 7-row catalog (KZO-188 discovery prep)", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    const meta = await provider.fetchInstrumentMetadata("CBA");
    expect(meta).not.toBeNull();
    expect(meta!.ticker).toBe("CBA");
    expect(meta!.industryCategory).toBe("EQUITY");

    const catalog = await provider.fetchInstrumentCatalog();
    expect(catalog.find((row) => row.ticker === "CBA")).toBeUndefined();
  });

  it("searchInstruments fixture returns BHP and CBA as findable matches", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();

    const bhpResults = await provider.searchInstruments("BHP");
    expect(bhpResults.some((r) => r.ticker === "BHP")).toBe(true);

    const cbaResults = await provider.searchInstruments("CBA");
    expect(cbaResults.some((r) => r.ticker === "CBA")).toBe(true);

    // Every result stamps typeRaw=ASX.
    for (const r of [...bhpResults, ...cbaResults]) {
      expect(r.typeRaw).toBe("ASX");
    }
  });

  it("tracks method calls on `calls` (mirrors MockFinMindUsStockMarketDataProvider's pattern)", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    await provider.fetchBars("BHP", "2024-01-02");
    await provider.fetchDividends("VAS");
    await provider.fetchInstrumentMetadata("CBA");
    await provider.searchInstruments("BHP");
    expect(provider.calls).toEqual([
      { method: "fetchBars", ticker: "BHP", startDate: "2024-01-02" },
      { method: "fetchDividends", ticker: "VAS" },
      { method: "fetchInstrumentMetadata", ticker: "CBA" },
      { method: "searchInstruments", query: "BHP" },
    ]);
  });

  it("reserveCapacity is a no-op (mock has no rate limiter) and is recorded in calls", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider();
    expect(() => provider.reserveCapacity(3)).not.toThrow();
    expect(provider.calls).toContainEqual({ method: "reserveCapacity", n: 3 });
  });

  it("fixtureStartDate constructor option shifts the bar window forward", async () => {
    const { MockYahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const provider = new MockYahooFinanceAuMarketDataProvider({ fixtureStartDate: "2024-06-03" });
    const bars = await provider.fetchBars("BHP");
    expect(bars[0]!.barDate >= "2024-06-03").toBe(true);
  });
});

// ── YahooFinanceAuMarketDataProvider (real, with mocked SDK) ─────────────────

describe("YahooFinanceAuMarketDataProvider — real provider against mocked yahoo-finance2 SDK", () => {
  beforeEach(() => {
    activeSdkStub = makeSdkStub();
  });

  afterEach(() => {
    activeSdkStub = null;
    vi.restoreAllMocks();
  });

  async function makeProvider(opts?: { rateLimitPerMinute?: number }) {
    const { YahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const limiter = new RateLimiter(opts?.rateLimitPerMinute ?? 60, 60_000);
    return new YahooFinanceAuMarketDataProvider({ rateLimiter: limiter });
  }

  it("exposes providerId = 'yahoo-finance-au'", async () => {
    const provider = await makeProvider();
    expect(provider.providerId).toBe("yahoo-finance-au");
  });

  // ── normalizeSymbol audit (load-bearing per .claude/rules/process-refactor-rename-verification.md) ──

  it("fetchBars passes a `.AX`-suffixed symbol to chart() (normalizeSymbol audit)", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({ quotes: [], events: { dividends: [] } });
    const provider = await makeProvider();
    await provider.fetchBars("BHP");
    expect(activeSdkStub!.chart).toHaveBeenCalledTimes(1);
    const [symbol] = activeSdkStub!.chart.mock.calls[0]!;
    expect(symbol).toBe("BHP.AX");
  });

  it("fetchDividends passes a `.AX`-suffixed symbol to chart() with events:'div'", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({ quotes: [], events: { dividends: [] } });
    const provider = await makeProvider();
    await provider.fetchDividends("CSL");
    expect(activeSdkStub!.chart).toHaveBeenCalledTimes(1);
    const [symbol, opts] = activeSdkStub!.chart.mock.calls[0]!;
    expect(symbol).toBe("CSL.AX");
    expect((opts as Record<string, unknown>)["events"]).toBe("div");
  });

  it("fetchInstrumentMetadata passes a `.AX`-suffixed symbol to quote()", async () => {
    activeSdkStub!.quote.mockResolvedValueOnce({
      longName: "BHP Group Limited",
      quoteType: "EQUITY",
    });
    const provider = await makeProvider();
    const meta = await provider.fetchInstrumentMetadata("BHP");
    expect(activeSdkStub!.quote).toHaveBeenCalledTimes(1);
    const [symbol] = activeSdkStub!.quote.mock.calls[0]!;
    expect(symbol).toBe("BHP.AX");
    expect(meta).not.toBeNull();
    expect(meta!.industryCategory).toBe("EQUITY");
    expect(meta!.name).toBe("BHP Group Limited");
    expect(meta!.typeRaw).toBe("ASX");
  });

  it("searchInstruments passes the bare query (NOT `.AX`-suffixed) to search()", async () => {
    activeSdkStub!.search.mockResolvedValueOnce({ quotes: [] });
    const provider = await makeProvider();
    await provider.searchInstruments("BHP");
    expect(activeSdkStub!.search).toHaveBeenCalledTimes(1);
    const [query, opts] = activeSdkStub!.search.mock.calls[0]!;
    // The query string fed to search() is the raw user input — unlike chart/quote,
    // search() takes a free-text query and returns symbols. The `.AX` filter is
    // applied AFTER on the result set (the "defensive double-filter" rule below).
    expect(query).toBe("BHP");
    expect((opts as Record<string, unknown>)["region"]).toBe("AU");
    expect((opts as Record<string, unknown>)["lang"]).toBe("en-AU");
  });

  it("normalizeSymbol uppercases + trims (defense for whitespace / lowercase input)", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({ quotes: [], events: { dividends: [] } });
    const provider = await makeProvider();
    await provider.fetchBars("  bhp  ");
    const [symbol] = activeSdkStub!.chart.mock.calls[0]!;
    expect(symbol).toBe("BHP.AX");
  });

  it("fetchBars sends an exclusive period2 for same-day daily close refreshes", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date("2026-06-19T13:30:00.000Z"),
          open: 90,
          high: 91,
          low: 89,
          close: 90.5,
          volume: 12_345,
        },
      ],
      events: { dividends: [] },
    });

    const provider = await makeProvider();
    const bars = await provider.fetchBars("ETPMAG", "2026-06-19", "2026-06-19");

    expect(activeSdkStub!.chart).toHaveBeenCalledWith(
      "ETPMAG.AX",
      expect.objectContaining({
        period1: "2026-06-19",
        period2: "2026-06-20",
        interval: "1d",
      }),
    );
    expect(bars).toEqual([expect.objectContaining({
      ticker: "ETPMAG",
      barDate: "2026-06-19",
      close: 90.5,
      sourceId: "yahoo-finance-au",
    })]);
  });

  // ── Response parsing + sourceId stamp ────────────────────────────────────

  it("fetchBars maps r.quotes → RawDailyBar[] with sourceId='yahoo-finance-au'", async () => {
    // 2024-01-02T13:00:00Z → +10h → 2024-01-02T23:00 → date 2024-01-02 still
    // (start of UTC day). 2024-01-01T15:00:00Z → +10h → 2024-01-02T01:00 → 2024-01-02
    // (NEXT day in Sydney TZ). The TZ-shift case is exercised below in its own test.
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date("2024-06-15T05:00:00Z"),
          open: 45.1,
          high: 46.0,
          low: 44.8,
          close: 45.5,
          volume: 1_000_000,
        },
      ],
      events: { dividends: [] },
    });

    const provider = await makeProvider();
    const bars = await provider.fetchBars("BHP");

    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({
      ticker: "BHP",
      open: 45.1,
      high: 46.0,
      low: 44.8,
      close: 45.5,
      volume: 1_000_000,
      sourceId: "yahoo-finance-au",
    });
    expect(typeof bars[0]!.barDate).toBe("string");
    expect(bars[0]!.barDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("fetchBars filters out null-field quotes (defensive against partial Yahoo rows)", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        // Complete row.
        { date: new Date("2024-06-15T05:00:00Z"), open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
        // Partial row — missing volume.
        { date: new Date("2024-06-16T05:00:00Z"), open: 1, high: 2, low: 0.5, close: 1.5, volume: null },
        // Partial row — missing date.
        { date: null, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
      ],
      events: { dividends: [] },
    });

    const provider = await makeProvider();
    const bars = await provider.fetchBars("BHP");
    expect(bars).toHaveLength(1);
  });

  it("fetchDividends maps r.events.dividends → DividendRecord[] with sourceId stamp", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [],
      events: {
        dividends: [
          { date: new Date("2024-09-05T03:00:00Z"), amount: 0.74 },
          { date: new Date("2024-03-07T03:00:00Z"), amount: 0.69 },
        ],
      },
    });

    const provider = await makeProvider();
    const records = await provider.fetchDividends("BHP");
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      ticker: "BHP",
      cashDividendPerShare: 0.74,
      stockDividendPerShare: 0,
      sourceId: "yahoo-finance-au",
    });
    expect(records[0]!.exDividendDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // exDividendDate === paymentDate per spike §4.3 (Yahoo provides no payment date).
    expect(records[0]!.exDividendDate).toBe(records[0]!.paymentDate);
  });

  it("fetchDividends handles missing events.dividends (chart returned no dividends key)", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({ quotes: [] });
    const provider = await makeProvider();
    expect(await provider.fetchDividends("BHP")).toEqual([]);
  });

  it("fetchInstrumentCatalog returns [] without an SDK call (KZO-194: catalog moved to TwelveDataAuCatalogProvider)", async () => {
    const provider = await makeProvider();
    const catalog = await provider.fetchInstrumentCatalog();
    expect(catalog).toEqual([]);
    expect(activeSdkStub!.chart).not.toHaveBeenCalled();
    expect(activeSdkStub!.quote).not.toHaveBeenCalled();
    expect(activeSdkStub!.search).not.toHaveBeenCalled();
  });

  it("fetchDelistingHistory returns [] without an SDK call", async () => {
    const provider = await makeProvider();
    expect(await provider.fetchDelistingHistory()).toEqual([]);
    expect(activeSdkStub!.chart).not.toHaveBeenCalled();
  });

  // ── Australia/Sydney TZ shift ─────────────────────────────────────────────

  it("Australia/Sydney TZ shift: a UTC bar at 15:00Z lands on the NEXT date when shifted to AEST", async () => {
    // 2024-06-15T15:00:00Z + 10h (AEST) = 2024-06-16T01:00:00 (Sydney). Bar slice =
    // "2024-06-16". Verifies the SYDNEY_TZ_OFFSET_MS shift inside the provider.
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date("2024-06-15T15:00:00Z"),
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 100,
        },
      ],
      events: { dividends: [] },
    });
    const provider = await makeProvider();
    const bars = await provider.fetchBars("BHP");
    expect(bars[0]!.barDate).toBe("2024-06-16");
  });

  it("Australia/Sydney TZ shift: a UTC bar at 05:00Z stays on the same date", async () => {
    activeSdkStub!.chart.mockResolvedValueOnce({
      quotes: [
        {
          date: new Date("2024-06-15T05:00:00Z"),
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 100,
        },
      ],
      events: { dividends: [] },
    });
    const provider = await makeProvider();
    const bars = await provider.fetchBars("BHP");
    expect(bars[0]!.barDate).toBe("2024-06-15");
  });

  // ── searchInstruments defensive double-filter ─────────────────────────────

  it("searchInstruments rejects results that don't satisfy `exchange === 'ASX'` AND `symbol.endsWith('.AX')`", async () => {
    activeSdkStub!.search.mockResolvedValueOnce({
      quotes: [
        // KEEP: matches both conditions.
        {
          isYahooFinance: true,
          symbol: "BHP.AX",
          exchange: "ASX",
          longname: "BHP Group Limited",
          shortname: "BHP",
          quoteType: "EQUITY",
        },
        // REJECT: NYS exchange, even though the symbol IS BHP — must NOT leak through.
        {
          isYahooFinance: true,
          symbol: "BHP",
          exchange: "NYS",
          longname: "BHP Group Limited (ADR)",
          shortname: "BHP",
          quoteType: "EQUITY",
        },
        // REJECT: ASX exchange but no `.AX` suffix on the symbol.
        {
          isYahooFinance: true,
          symbol: "BHPLF",
          exchange: "ASX",
          longname: "Some other listing",
          shortname: "BHPLF",
          quoteType: "EQUITY",
        },
        // REJECT: bare-`null` exchange / non-isYahooFinance row.
        {
          isYahooFinance: false,
          symbol: "BHP.AX",
          exchange: null,
          longname: "ghost",
          shortname: "ghost",
          quoteType: "EQUITY",
        },
      ],
    });

    const provider = await makeProvider();
    const results = await provider.searchInstruments("BHP");
    expect(results).toHaveLength(1);
    expect(results[0]!.ticker).toBe("BHP"); // .AX stripped
    expect(results[0]!.industryCategory).toBe("EQUITY");
    expect(results[0]!.typeRaw).toBe("ASX");
  });

  it("searchInstruments returns [] when every Yahoo result fails the double-filter", async () => {
    activeSdkStub!.search.mockResolvedValueOnce({
      quotes: [
        { isYahooFinance: true, symbol: "BHP", exchange: "NYS", longname: "BHP ADR", shortname: "BHP", quoteType: "EQUITY" },
        { isYahooFinance: true, symbol: "AAPL", exchange: "NMS", longname: "Apple", shortname: "AAPL", quoteType: "EQUITY" },
      ],
    });
    const provider = await makeProvider();
    expect(await provider.searchInstruments("BHP")).toEqual([]);
  });

  // ── Error mapping ─────────────────────────────────────────────────────────

  it("fetchInstrumentMetadata returns null when quote() throws a generic SDK error (warn-and-continue contract)", async () => {
    activeSdkStub!.quote.mockRejectedValueOnce(new Error("Quote not found for symbol BHP.AX"));
    const provider = await makeProvider();
    const meta = await provider.fetchInstrumentMetadata("BHP");
    expect(meta).toBeNull();
  });

  it("fetchInstrumentMetadata RE-THROWS RateLimitedError (per .claude/rules/typed-transient-error-catch-audit.md)", async () => {
    // SDK throws a RateLimitedError *through* the quote() promise. The provider's
    // catch block must NOT swallow it — workers downstream depend on it bubbling up
    // so the reschedule path engages. This is the load-bearing contract.
    activeSdkStub!.quote.mockRejectedValueOnce(new RateLimitedError({ msUntilAvailable: 30_000 }));
    const provider = await makeProvider();
    await expect(provider.fetchInstrumentMetadata("BHP")).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("fetchBars propagates SDK errors (no swallow)", async () => {
    activeSdkStub!.chart.mockRejectedValueOnce(new Error("network timeout"));
    const provider = await makeProvider();
    await expect(provider.fetchBars("BHP")).rejects.toThrow(/network timeout/);
  });

  it("fetchBars surfaces RateLimitedError from the rate-limiter pre-flight", async () => {
    // Tight limiter: 0/min effectively saturates immediately. The provider should
    // throw `RateLimitedError` from `assertCanConsume()` BEFORE invoking chart().
    const { YahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const limiter = new RateLimiter(1, 60_000);
    const provider = new YahooFinanceAuMarketDataProvider({ rateLimiter: limiter });

    // First call drains the single slot.
    activeSdkStub!.chart.mockResolvedValueOnce({ quotes: [], events: { dividends: [] } });
    await provider.fetchBars("BHP");

    // Second call hits the rate-limit pre-flight.
    await expect(provider.fetchBars("CSL")).rejects.toBeInstanceOf(RateLimitedError);
    // chart() was only called once — the second pre-flight short-circuited before SDK call.
    expect(activeSdkStub!.chart).toHaveBeenCalledTimes(1);
  });

  it("reserveCapacity throws RateLimitedError when the limiter cannot accommodate n slots", async () => {
    const { YahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const limiter = new RateLimiter(1, 60_000);
    const provider = new YahooFinanceAuMarketDataProvider({ rateLimiter: limiter });
    expect(() => provider.reserveCapacity(2)).toThrow(RateLimitedError);
  });

  it("reserveCapacity passes when the limiter has free capacity (and is a no-op observable side-effect)", async () => {
    const { YahooFinanceAuMarketDataProvider } = await import("../../src/services/market-data/providers/index.js");
    const limiter = new RateLimiter(60, 60_000);
    const provider = new YahooFinanceAuMarketDataProvider({ rateLimiter: limiter });
    expect(() => provider.reserveCapacity(2)).not.toThrow();
    // SDK was not called (reserveCapacity is check-only).
    expect(activeSdkStub!.chart).not.toHaveBeenCalled();
  });
});
