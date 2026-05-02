/**
 * KZO-170 — `FinMindUsStockMarketDataProvider` + `MockFinMindUsStockMarketDataProvider`.
 *
 * **Scope narrowed by Phase-1 G-NC-1 resolution (Option C, 2026-05-02):**
 *   - `fetchBars` reads `USStockPrice` (`Close`, not `Adj_Close`, for parity with TW).
 *   - `fetchDividends() => []` — FinMind v4 has NO `USStockDividend` dataset (HTTP 422).
 *     US dividend ingestion lives in **KZO-187** (alternate provider).
 *   - `fetchInstrumentCatalog` reads `USStockInfo`; classifier field is `Subsector` (free-text).
 *   - `fetchDelistingHistory() => []` — FinMind v4 has NO `USStockDelisting` dataset (HTTP 422).
 *   - `providerId = 'finmind-us'` and `sourceId = 'finmind-us'` (D14).
 *
 * **Mock provider (`MockFinMindUsStockMarketDataProvider`)** mirrors the real
 * provider exactly: deterministic prices for AAPL/VOO/MSFT/BND from 2024-01-01
 * (D11), empty dividends, empty delistings.
 *
 * Pattern mirrors:
 *   - apps/api/test/unit/finmind-client-mock.test.ts (mock surface)
 *   - apps/api/test/unit/finmind-dividend-mapper.test.ts (real-provider parsing)
 *
 * Field-shape source: `.worklog/team/escalation.md` § Appendix A.1 / A.3
 * (raw FinMind v4 verification curls).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";

vi.mock("@tw-portfolio/config", () => ({
  Env: { FINMIND_API_TOKEN: "test-token" },
}));

// ── MockFinMindUsStockMarketDataProvider ─────────────────────────────────────

describe("MockFinMindUsStockMarketDataProvider", () => {
  it("exposes providerId = 'finmind-us' (D14)", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();
    expect(provider.providerId).toBe("finmind-us");
  });

  it("returns deterministic AAPL bars starting at 2024-01-01 (G-CRIT-3 / D11)", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();
    const bars = await provider.fetchBars("AAPL");

    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]).toMatchObject({
      ticker: "AAPL",
      sourceId: "finmind-us",
    });
    expect(bars[0]!.barDate >= "2024-01-01").toBe(true);
    expect(bars[0]!.high).toBeGreaterThan(bars[0]!.low);
    expect(bars[0]!.volume).toBeGreaterThan(0);
  });

  it("returns deterministic bars for all four reserved US tickers (AAPL / VOO / MSFT / BND)", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();
    for (const ticker of ["AAPL", "VOO", "MSFT", "BND"]) {
      const bars = await provider.fetchBars(ticker);
      expect(bars.length).toBeGreaterThan(0);
      expect(bars.every((b) => b.ticker === ticker)).toBe(true);
      expect(bars.every((b) => b.sourceId === "finmind-us")).toBe(true);
      expect(bars.every((b) => b.barDate >= "2024-01-01")).toBe(true);
    }
  });

  it("fetchDividends returns an empty array — FinMind has NO USStockDividend dataset (KZO-187)", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();
    for (const ticker of ["AAPL", "VOO", "MSFT", "BND"]) {
      const dividends = await provider.fetchDividends(ticker);
      expect(dividends).toEqual([]);
    }
  });

  it("returns the four reserved US instruments in fetchInstrumentCatalog (AAPL/VOO/MSFT/BND)", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();
    const catalog = await provider.fetchInstrumentCatalog();
    const tickers = catalog.map((row) => row.ticker).sort();
    expect(tickers).toContain("AAPL");
    expect(tickers).toContain("VOO");
    expect(tickers).toContain("MSFT");
    expect(tickers).toContain("BND");
  });

  it("fetchDelistingHistory returns an empty array — FinMind has NO USStockDelisting dataset", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();
    const delistings = await provider.fetchDelistingHistory();
    expect(Array.isArray(delistings)).toBe(true);
    expect(delistings).toHaveLength(0);
  });

  it("tracks method calls (mirrors MockFinMindMarketDataProvider's `calls` field)", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();
    await provider.fetchBars("AAPL", "2024-06-01");
    await provider.fetchDividends("MSFT");
    expect(provider.calls).toEqual([
      { method: "fetchBars", ticker: "AAPL", startDate: "2024-06-01" },
      { method: "fetchDividends", ticker: "MSFT" },
    ]);
  });

  it("reserveCapacity is a no-op (mock has no rate limiter) and is recorded in calls", async () => {
    const { MockFinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    const provider = new MockFinMindUsStockMarketDataProvider();
    expect(() => provider.reserveCapacity(2)).not.toThrow();
    expect(provider.calls).toContainEqual({ method: "reserveCapacity", n: 2 });
  });
});

// ── FinMindUsStockMarketDataProvider (real provider, mock global fetch) ──────
// Field shape source: .worklog/team/escalation.md § Appendix A.1 / A.3.

describe("FinMindUsStockMarketDataProvider — response parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function makeProvider() {
    const { FinMindUsStockMarketDataProvider } = await import(
      "../../src/services/market-data/providers/index.js"
    );
    return new FinMindUsStockMarketDataProvider({
      token: "test-token",
      baseUrl: "https://api.finmindtrade.com/api/v4/data",
      rateLimiter: new RateLimiter(600),
    });
  }

  it("exposes providerId = 'finmind-us' (D14)", async () => {
    const provider = await makeProvider();
    expect(provider.providerId).toBe("finmind-us");
  });

  it("fetchBars maps USStockPrice rows: uses `Close` (NOT Adj_Close) and stamps sourceId='finmind-us'", async () => {
    // Per Phase-1 verification (Appendix A.1) — USStockPrice row shape:
    // { date, stock_id, Adj_Close, Close, High, Low, Open, Volume }
    // Provider must read `Close` for column-semantic parity with TaiwanStockPrice.
    const mockRow = {
      date: "2024-01-02",
      stock_id: "AAPL",
      Adj_Close: 183.73,
      Close: 185.64, // This is what gets mapped to bar.close
      High: 188.44,
      Low: 183.89,
      Open: 187.15,
      Volume: 82_488_700,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: "success", status: 200, data: [mockRow] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const provider = await makeProvider();
    const bars = await provider.fetchBars("AAPL");

    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({
      ticker: "AAPL",
      barDate: "2024-01-02",
      open: 187.15,
      high: 188.44,
      low: 183.89,
      close: 185.64, // Close, NOT Adj_Close
      volume: 82_488_700,
      sourceId: "finmind-us",
    });
    // Adj_Close MUST NOT leak into the typed shape — defensive regression net.
    expect((bars[0] as unknown as Record<string, unknown>)["adjClose"]).toBeUndefined();
    expect((bars[0] as unknown as Record<string, unknown>)["Adj_Close"]).toBeUndefined();
  });

  it("fetchDividends returns [] — FinMind has no USStockDividend dataset (KZO-187 picks this up)", async () => {
    // No fetch mock needed — the provider's fetchDividends should be a hardcoded
    // `return []` per scope-todo D5 revised. If the implementation accidentally
    // hits `globalThis.fetch`, the test will fail because no mock is registered.
    const provider = await makeProvider();
    const records = await provider.fetchDividends("AAPL");
    expect(records).toEqual([]);
  });

  it("fetchInstrumentCatalog maps USStockInfo rows (Subsector → industryCategory)", async () => {
    // Per Phase-1 verification (Appendix A.3) — USStockInfo row shape:
    // { date, stock_id, Country, IPOYear, MarketCap, Subsector, stock_name }
    // Classifier reads `Subsector` (free-text).
    const mockRow = {
      date: "2026-05-02",
      stock_id: "AAPL",
      Country: "United States",
      IPOYear: 1980,
      MarketCap: 4_112_770_000_000,
      Subsector: "Computer Manufacturing",
      stock_name: "Apple Inc. Common Stock",
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: "success", status: 200, data: [mockRow] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const provider = await makeProvider();
    const rows = await provider.fetchInstrumentCatalog();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ticker: "AAPL",
      name: "Apple Inc. Common Stock",
    });
    // Subsector is the field the classifier reads; provider maps it to
    // the typed `industryCategory` shape so the existing classifier interface
    // stays uniform across markets.
    expect(rows[0]!.industryCategory).toBe("Computer Manufacturing");
    expect(rows[0]!.date).toBe("2026-05-02");
  });

  it("fetchDelistingHistory returns [] — FinMind has no USStockDelisting dataset", async () => {
    const provider = await makeProvider();
    const rows = await provider.fetchDelistingHistory();
    expect(rows).toEqual([]);
  });

  it("throws RateLimitedError on HTTP 402 (FinMind shared budget exhausted)", async () => {
    const { RateLimitedError } = await import("../../src/services/market-data/types.js");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("rate limit", { status: 402 }),
    );

    const provider = await makeProvider();
    await expect(provider.fetchBars("AAPL")).rejects.toBeInstanceOf(RateLimitedError);
  });
});
