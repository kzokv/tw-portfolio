import { describe, it, expect } from "vitest";
import type { EnvConfig } from "@tw-portfolio/config";
import { buildMarketDataRegistry } from "../../src/services/market-data/registry.js";
import {
  FinMindMarketDataProvider,
  FinMindUsStockMarketDataProvider,
  MockFinMindMarketDataProvider,
  MockFinMindUsStockMarketDataProvider,
  MockYahooFinanceAuMarketDataProvider,
  YahooFinanceAuMarketDataProvider,
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
  };
  return { ...base, ...overrides } as EnvConfig;
}

describe("buildMarketDataRegistry", () => {
  // KZO-170 S9 + KZO-172: registry wires TW (FinMind TaiwanStockPrice), US (FinMind
  // USStockPrice), and AU (yahoo-finance2). Catalog map mirrors the same shape.
  it("registers TW + US + AU providers (mock branch) when FINMIND_API_TOKEN unset and AU_PROVIDER_MOCK=true", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: undefined }));

    expect(registry.marketData.size).toBe(3);
    expect(registry.catalog.size).toBe(3);
    expect(registry.marketData.get("TW")).toBeInstanceOf(MockFinMindMarketDataProvider);
    expect(registry.catalog.get("TW")).toBeInstanceOf(MockFinMindMarketDataProvider);
    expect(registry.marketData.get("US")).toBeInstanceOf(MockFinMindUsStockMarketDataProvider);
    expect(registry.catalog.get("US")).toBeInstanceOf(MockFinMindUsStockMarketDataProvider);
    expect(registry.marketData.get("AU")).toBeInstanceOf(MockYahooFinanceAuMarketDataProvider);
    expect(registry.catalog.get("AU")).toBeInstanceOf(MockYahooFinanceAuMarketDataProvider);
  });

  it("registers the real Yahoo AU provider when AU_PROVIDER_MOCK=false", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: undefined, AU_PROVIDER_MOCK: false }));

    expect(registry.marketData.get("AU")).toBeInstanceOf(YahooFinanceAuMarketDataProvider);
    expect(registry.catalog.get("AU")).toBeInstanceOf(YahooFinanceAuMarketDataProvider);
    // Same instance under both maps (one class implements both interfaces).
    expect(registry.marketData.get("AU")).toBe(registry.catalog.get("AU"));
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

  it("treats an empty-string FINMIND_API_TOKEN as unset (falls back to mock for both TW and US)", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: "" }));

    expect(registry.marketData.get("TW")).toBeInstanceOf(MockFinMindMarketDataProvider);
    expect(registry.marketData.get("US")).toBeInstanceOf(MockFinMindUsStockMarketDataProvider);
  });
});
