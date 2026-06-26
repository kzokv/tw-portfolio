import { describe, it, expect } from "vitest";
import type { EnvConfig } from "@vakwen/config";
import { buildMarketDataRegistry } from "../../src/services/market-data/registry.js";
import {
  FinMindMarketDataProvider,
  FinMindUsStockMarketDataProvider,
  MockTwelveDataAuCatalogProvider,
  MockTwelveDataJpCatalogProvider,
  MockTwelveDataKrCatalogProvider,
  MockYahooFinanceAuMarketDataProvider,
  MockYahooFinanceJpMarketDataProvider,
  MockYahooFinanceKrMarketDataProvider,
  TwelveDataAuCatalogProvider,
  TwelveDataJpCatalogProvider,
  TwelveDataKrCatalogProvider,
  YahooFinanceAuMarketDataProvider,
  YahooFinanceJpMarketDataProvider,
  YahooFinanceKrMarketDataProvider,
} from "../../src/services/market-data/providers/index.js";

function envWith(overrides: Partial<EnvConfig>): EnvConfig {
  const base = {
    FINMIND_API_TOKEN: undefined,
    FINMIND_BASE_URL: "https://api.finmindtrade.com/api/v4/data",
    FINMIND_RATE_LIMIT_PER_HOUR: 600,
    // KZO-172: AU provider config — registry creates a separate RateLimiter and
    // branches on AU_PROVIDER_MOCK. Tests default to the mock branch.
    YAHOO_AU_RATE_LIMIT_PER_MINUTE: 60,
    AU_PROVIDER_MOCK: true,
    YAHOO_KR_RATE_LIMIT_PER_MINUTE: 60,
    KR_PROVIDER_MOCK: true,
    YAHOO_JP_RATE_LIMIT_PER_MINUTE: 60,
    JP_PROVIDER_MOCK: true,
    // KZO-194: AU catalog now sourced from `TwelveDataAuCatalogProvider`. Tests
    // default to the mock catalog branch (TWELVE_DATA_API_KEY undefined +
    // AU_CATALOG_PROVIDER_MOCK true both select the mock).
    TWELVE_DATA_API_KEY: undefined,
    TWELVE_DATA_BASE_URL: "https://api.twelvedata.com",
    TWELVE_DATA_RATE_LIMIT_PER_MINUTE: 8,
    AU_CATALOG_PROVIDER_MOCK: true,
    KR_CATALOG_PROVIDER_MOCK: true,
    JP_CATALOG_PROVIDER_MOCK: true,
    FRANKFURTER_BASE_URL: "https://api.frankfurter.dev/v2",
    FRANKFURTER_RATE_LIMIT_PER_MINUTE: 120,
    ASX_GICS_RATE_LIMIT_PER_HOUR: 6,
  };
  return { ...base, ...overrides } as EnvConfig;
}

describe("buildMarketDataRegistry", () => {
  // KZO-170 S9 + KZO-172: registry wires TW (FinMind TaiwanStockPrice), US (FinMind
  // USStockPrice), and AU (yahoo-finance2). Catalog map mirrors the same shape.
  it("registers AU/KR/JP mock split providers when their mock flags are enabled", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: undefined }));

    expect(registry.marketData.size).toBe(5);
    expect(registry.catalog.size).toBe(5);
    expect(registry.marketData.get("AU")).toBeInstanceOf(MockYahooFinanceAuMarketDataProvider);
    expect(registry.catalog.get("AU")).toBeInstanceOf(MockTwelveDataAuCatalogProvider);
    expect(registry.marketData.get("KR")).toBeInstanceOf(MockYahooFinanceKrMarketDataProvider);
    expect(registry.catalog.get("KR")).toBeInstanceOf(MockTwelveDataKrCatalogProvider);
    expect(registry.marketData.get("JP")).toBeInstanceOf(MockYahooFinanceJpMarketDataProvider);
    expect(registry.catalog.get("JP")).toBeInstanceOf(MockTwelveDataJpCatalogProvider);
  });

  it("registers real AU/KR/JP split providers when API key is set and mock flags are disabled", () => {
    const registry = buildMarketDataRegistry(
      envWith({
        FINMIND_API_TOKEN: undefined,
        AU_PROVIDER_MOCK: false,
        KR_PROVIDER_MOCK: false,
        JP_PROVIDER_MOCK: false,
        TWELVE_DATA_API_KEY: "td-test-key",
        AU_CATALOG_PROVIDER_MOCK: false,
        KR_CATALOG_PROVIDER_MOCK: false,
        JP_CATALOG_PROVIDER_MOCK: false,
      }),
    );

    expect(registry.marketData.get("AU")).toBeInstanceOf(YahooFinanceAuMarketDataProvider);
    expect(registry.catalog.get("AU")).toBeInstanceOf(TwelveDataAuCatalogProvider);
    expect(registry.marketData.get("KR")).toBeInstanceOf(YahooFinanceKrMarketDataProvider);
    expect(registry.catalog.get("KR")).toBeInstanceOf(TwelveDataKrCatalogProvider);
    expect(registry.marketData.get("JP")).toBeInstanceOf(YahooFinanceJpMarketDataProvider);
    expect(registry.catalog.get("JP")).toBeInstanceOf(TwelveDataJpCatalogProvider);
    expect(registry.marketData.get("AU")).not.toBe(registry.catalog.get("AU"));
    expect(registry.marketData.get("JP")).not.toBe(registry.catalog.get("JP"));
  });

  it("registers FinMindMarketDataProvider for TW and FinMindUsStockMarketDataProvider for US when FINMIND_API_TOKEN is set", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: "fake-token" }));

    expect(registry.marketData.get("TW")).toBeInstanceOf(FinMindMarketDataProvider);
    expect(registry.catalog.get("TW")).toBeInstanceOf(FinMindMarketDataProvider);
    expect(registry.marketData.get("US")).toBeInstanceOf(FinMindUsStockMarketDataProvider);
    expect(registry.catalog.get("US")).toBeInstanceOf(FinMindUsStockMarketDataProvider);
  });

  it("registers the same provider instance under both marketData and catalog (FinMind covers both for TW)", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: undefined }));

    expect(registry.marketData.get("TW")).toBe(registry.catalog.get("TW"));
  });

  it("registers the same provider instance under both marketData and catalog for US", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: undefined }));

    expect(registry.marketData.get("US")).toBe(registry.catalog.get("US"));
  });

  it("keeps AU/KR/JP mock branches selected even when the FinMind bootstrap token input is empty", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: "" }));

    expect(registry.marketData.get("AU")).toBeInstanceOf(MockYahooFinanceAuMarketDataProvider);
    expect(registry.catalog.get("KR")).toBeInstanceOf(MockTwelveDataKrCatalogProvider);
    expect(registry.catalog.get("JP")).toBeInstanceOf(MockTwelveDataJpCatalogProvider);
  });
});
