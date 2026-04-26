import { describe, it, expect } from "vitest";
import type { EnvConfig } from "@tw-portfolio/config";
import { buildMarketDataRegistry } from "../../src/services/market-data/registry.js";
import {
  FinMindMarketDataProvider,
  MockFinMindMarketDataProvider,
} from "../../src/services/market-data/providers/index.js";

function envWith(overrides: Partial<EnvConfig>): EnvConfig {
  const base = {
    FINMIND_API_TOKEN: undefined,
    FINMIND_BASE_URL: "https://api.finmindtrade.com/api/v4/data",
    FINMIND_RATE_LIMIT_PER_HOUR: 600,
  };
  return { ...base, ...overrides } as EnvConfig;
}

describe("buildMarketDataRegistry", () => {
  it("registers MockFinMindMarketDataProvider when FINMIND_API_TOKEN is unset", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: undefined }));

    expect(registry.marketData.size).toBe(1);
    expect(registry.catalog.size).toBe(1);
    expect(registry.marketData.get("TW")).toBeInstanceOf(MockFinMindMarketDataProvider);
    expect(registry.catalog.get("TW")).toBeInstanceOf(MockFinMindMarketDataProvider);
  });

  it("registers FinMindMarketDataProvider when FINMIND_API_TOKEN is set", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: "fake-token" }));

    expect(registry.marketData.get("TW")).toBeInstanceOf(FinMindMarketDataProvider);
    expect(registry.catalog.get("TW")).toBeInstanceOf(FinMindMarketDataProvider);
  });

  it("registers the same provider instance under both marketData and catalog (FinMind covers both for TW)", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: undefined }));

    expect(registry.marketData.get("TW")).toBe(registry.catalog.get("TW"));
  });

  it("treats an empty-string FINMIND_API_TOKEN as unset (falls back to mock)", () => {
    const registry = buildMarketDataRegistry(envWith({ FINMIND_API_TOKEN: "" }));

    expect(registry.marketData.get("TW")).toBeInstanceOf(MockFinMindMarketDataProvider);
  });
});
