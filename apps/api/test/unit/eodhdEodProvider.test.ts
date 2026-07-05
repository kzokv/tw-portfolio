import { afterEach, describe, expect, it, vi } from "vitest";
import { EodhdEodProvider } from "../../src/services/market-data/providers/eodhdEod.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("EodhdEodProvider", () => {
  it("calls the official EODHD /api/eod endpoint with short-range date params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson([]));
    const provider = new EodhdEodProvider({
      apiToken: () => "secret",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await provider.fetchHistoricalRange("ETPMAG.AU", "2026-07-03", "2026-07-04");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toContain("https://eodhd.com/api/eod/ETPMAG.AU");
    expect(url).toContain("from=2026-07-03");
    expect(url).toContain("to=2026-07-04");
    expect(url).toContain("period=d");
    expect(url).toContain("fmt=json");
    expect(url).toContain("api_token=secret");
  });

  it("maps JSON rows into normalized EOD rows", async () => {
    const provider = new EodhdEodProvider({
      apiToken: () => "secret",
      fetchImpl: vi.fn().mockResolvedValue(okJson([
        {
          date: "2026-07-03",
          open: "81.1",
          high: "82.0",
          low: "80.5",
          close: "81.75",
          adjusted_close: "81.75",
          volume: "1200",
        },
      ])) as typeof fetch,
    });

    await expect(provider.fetchHistoricalRange("ETPMAG.AU", "2026-07-03", "2026-07-03")).resolves.toEqual([
      {
        marketDate: "2026-07-03",
        open: 81.1,
        high: 82,
        low: 80.5,
        close: 81.75,
        adjustedClose: 81.75,
        volume: 1200,
      },
    ]);
  });

  it("builds a close snapshot with previous close from the prior trading row", async () => {
    const provider = new EodhdEodProvider({
      apiToken: () => "secret",
      fetchImpl: vi.fn().mockResolvedValue(okJson([
        { date: "2026-07-03", close: "81.75" },
        { date: "2026-07-04", close: "82.44" },
      ])) as typeof fetch,
    });

    const snapshot = await provider.fetchCloseSnapshot({
      marketCode: "AU",
      providerSymbol: "ETPMAG.AU",
      closeDate: "2026-07-04",
      previousCloseDate: "2026-07-03",
    });

    expect(snapshot).toMatchObject({
      marketCode: "AU",
      providerSymbol: "ETPMAG.AU",
      closeDate: "2026-07-04",
      previousCloseDate: "2026-07-03",
      currency: "AUD",
      currencySource: "market_default",
      source: "eodhd-eod",
      latest: { marketDate: "2026-07-04", close: 82.44 },
      previous: { marketDate: "2026-07-03", close: 81.75 },
      providerMetadata: { request: { from: "2026-07-03", to: "2026-07-04" }, rowCount: 2 },
    });
  });

  it("returns null when the requested close date is absent from the provider payload", async () => {
    const provider = new EodhdEodProvider({
      apiToken: () => "secret",
      fetchImpl: vi.fn().mockResolvedValue(okJson([
        { date: "2026-07-03", close: "81.75" },
      ])) as typeof fetch,
    });

    await expect(provider.fetchCloseSnapshot({
      marketCode: "AU",
      providerSymbol: "ETPMAG.AU",
      closeDate: "2026-07-04",
      previousCloseDate: "2026-07-03",
    })).resolves.toBeNull();
  });

  it("fails loudly when no API key is configured", async () => {
    const provider = new EodhdEodProvider({
      apiToken: () => undefined,
      fetchImpl: vi.fn() as typeof fetch,
    });

    await expect(provider.fetchHistoricalRange("ETPMAG.AU", "2026-07-03", "2026-07-04"))
      .rejects.toThrow("eodhd_api_key_missing");
  });

  it("fails loudly on non-2xx responses", async () => {
    const provider = new EodhdEodProvider({
      apiToken: () => "secret",
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: vi.fn(),
      }) as typeof fetch,
    });

    await expect(provider.fetchHistoricalRange("ETPMAG.AU", "2026-07-03", "2026-07-04"))
      .rejects.toThrow("eodhd_eod_http_429");
  });
});
