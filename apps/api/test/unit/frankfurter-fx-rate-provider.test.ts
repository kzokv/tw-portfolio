/**
 * Unit tests for FrankfurterFxRateProvider.
 *
 * Verifies:
 *  - URL construction: /rates?base=…&from=…&to=… (no ?providers= — default blend)
 *  - Response parsing: array [{date, base, quote, rate}] → FxRate[]
 *  - Optional quotes filter applied client-side
 *  - source: 'frankfurter' stamped on every result
 *  - Error mapping for non-2xx and JSON-parse failures → plain Error (NOT RateLimitedError)
 *  - reserveCapacity(n) is a no-op — does not throw
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrankfurterFxRateProvider } from "../../src/services/market-data/providers/frankfurter.js";

const BASE_URL = "https://api.frankfurter.dev/v2";

// Canonical Frankfurter v2 array response shape
const MOCK_RESPONSE = [
  { date: "2026-04-24", base: "USD", quote: "TWD", rate: 31.5 },
  { date: "2026-04-24", base: "USD", quote: "AUD", rate: 1.4 },
  { date: "2026-04-25", base: "USD", quote: "TWD", rate: 31.6 },
  { date: "2026-04-25", base: "USD", quote: "AUD", rate: 1.41 },
];

function makeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(String(body)),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FrankfurterFxRateProvider — URL construction", () => {
  it("builds ${baseUrl}/rates?base=…&from=…&to=… (no ?providers= in URL)", async () => {
    const stubFetch = makeFetch(200, MOCK_RESPONSE);
    vi.stubGlobal("fetch", stubFetch);

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    await provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25");

    expect(stubFetch).toHaveBeenCalledTimes(1);
    const [url] = stubFetch.mock.calls[0] as [string];
    expect(url).toMatch(/\/rates(\?|$)/);
    expect(url).toContain("base=USD");
    expect(url).toContain("from=2026-04-24");
    expect(url).toContain("to=2026-04-25");
    // Default blend — never add provider pinning
    expect(url).not.toContain("providers=");
  });

  it("uses the injected baseUrl, not a hardcoded constant", async () => {
    const customBaseUrl = "http://custom.invalid/v2";
    const stubFetch = makeFetch(200, []);
    vi.stubGlobal("fetch", stubFetch);

    const provider = new FrankfurterFxRateProvider({ baseUrl: customBaseUrl });
    await provider.fetchRatesForBase("TWD", "2026-04-01", "2026-04-01");

    const [url] = stubFetch.mock.calls[0] as [string];
    expect(url).toContain(customBaseUrl);
  });

  it("injects correct base= for TWD queries", async () => {
    const stubFetch = makeFetch(200, []);
    vi.stubGlobal("fetch", stubFetch);

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    await provider.fetchRatesForBase("TWD", "2026-04-01", "2026-04-30");

    const [url] = stubFetch.mock.calls[0] as [string];
    expect(url).toContain("base=TWD");
  });
});

describe("FrankfurterFxRateProvider — response parsing", () => {
  it("parses array response and stamps source: 'frankfurter' on each result", async () => {
    vi.stubGlobal("fetch", makeFetch(200, MOCK_RESPONSE));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    const results = await provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25");

    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.source).toBe("frankfurter");
    }
  });

  it("maps {date, base, quote, rate} → FxRate shape with camelCase field names", async () => {
    vi.stubGlobal("fetch", makeFetch(200, [
      { date: "2026-04-24", base: "USD", quote: "TWD", rate: 31.5 },
    ]));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    const results = await provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-24");

    expect(results[0]).toEqual({
      date: "2026-04-24",
      baseCurrency: "USD",
      quoteCurrency: "TWD",
      rate: 31.5,
      source: "frankfurter",
    });
  });

  it("preserves the exact date string returned by Frankfurter (no coercion to today_utc)", async () => {
    // Invariant 6: Frankfurter forward-fills weekends; upserted row's date = response.date
    vi.stubGlobal("fetch", makeFetch(200, [
      { date: "2026-04-24", base: "USD", quote: "TWD", rate: 31.5 }, // a Friday
    ]));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    const results = await provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-26");

    expect(results[0]!.date).toBe("2026-04-24");
  });

  it("returns an empty array when Frankfurter returns empty array", async () => {
    vi.stubGlobal("fetch", makeFetch(200, []));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    const results = await provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25");

    expect(results).toHaveLength(0);
  });
});

describe("FrankfurterFxRateProvider — optional quotes filter", () => {
  it("filters to requested quotes when quotes array is provided", async () => {
    vi.stubGlobal("fetch", makeFetch(200, MOCK_RESPONSE));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    const results = await provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25", ["TWD"]);

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.quoteCurrency === "TWD")).toBe(true);
  });

  it("returns all quotes when no filter provided", async () => {
    vi.stubGlobal("fetch", makeFetch(200, MOCK_RESPONSE));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    const results = await provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25");

    const quotes = new Set(results.map((r) => r.quoteCurrency));
    expect(quotes.has("TWD")).toBe(true);
    expect(quotes.has("AUD")).toBe(true);
  });

  it("returns all quotes when empty quotes array is provided", async () => {
    vi.stubGlobal("fetch", makeFetch(200, MOCK_RESPONSE));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    const results = await provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25", []);

    expect(results).toHaveLength(4);
  });
});

describe("FrankfurterFxRateProvider — error handling", () => {
  it("throws plain Error on 4xx (not RateLimitedError — Frankfurter has no rate limit)", async () => {
    vi.stubGlobal("fetch", makeFetch(404, { error: "Not Found" }));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });

    await expect(provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25"))
      .rejects.toThrow(Error);
  });

  it("throws plain Error on 5xx", async () => {
    vi.stubGlobal("fetch", makeFetch(502, "Bad Gateway"));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });

    await expect(provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25"))
      .rejects.toThrow(Error);
  });

  it("includes the HTTP status in the error message for non-2xx", async () => {
    vi.stubGlobal("fetch", makeFetch(500, "Internal Server Error"));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });

    await expect(provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25"))
      .rejects.toThrow(/5[0-9]{2}/);
  });

  it("throws on JSON parse failure (not silently swallowed)", async () => {
    const badFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
      text: vi.fn().mockResolvedValue("not-json"),
    });
    vi.stubGlobal("fetch", badFetch);

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });

    await expect(provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25"))
      .rejects.toThrow();
  });

  it("throws on network failure (fetch itself rejects)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });

    await expect(provider.fetchRatesForBase("USD", "2026-04-24", "2026-04-25"))
      .rejects.toThrow("ECONNREFUSED");
  });
});

describe("FrankfurterFxRateProvider — reserveCapacity", () => {
  it("is a no-op — does not throw for n=0", () => {
    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    expect(() => provider.reserveCapacity(0)).not.toThrow();
  });

  it("is a no-op — does not throw for n=100", () => {
    const provider = new FrankfurterFxRateProvider({ baseUrl: BASE_URL });
    expect(() => provider.reserveCapacity(100)).not.toThrow();
  });
});
