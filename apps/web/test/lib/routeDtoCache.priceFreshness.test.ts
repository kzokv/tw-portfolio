// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { RouteCachePolicyDto } from "@vakwen/shared-types";
import {
  buildRouteDtoCacheKey,
  buildRouteDtoCacheTag,
  clearPortfolioContextRouteCaches,
  clearRouteDtoCacheByTags,
  PORTFOLIO_CONTEXT_ROUTE_CACHE_TAGS,
  readRouteDtoCache,
  resolveRouteDtoCacheDurations,
  writeRouteDtoCache,
} from "../../lib/routeDtoCache";

function installStorageMocks() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };

  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(window, key, {
      configurable: true,
      value: storage,
    });
  }
}

const CACHE_POLICY: RouteCachePolicyDto = {
  mode: "balanced",
  dashboardPrimaryTtlMs: 11_000,
  dashboardEnrichmentTtlMs: 22_000,
  dashboardPerformanceTtlMs: 33_000,
  portfolioTtlMs: 44_000,
  reportsTtlMs: 55_000,
  staleUsableTtlMs: 66_000,
};

describe("routeDtoCache price-freshness-adjacent behavior", () => {
  beforeEach(() => {
    installStorageMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("resolves policy-driven TTLs for open-market-sensitive cache slots", () => {
    expect(resolveRouteDtoCacheDurations(CACHE_POLICY, "dashboard-primary")).toEqual({
      ttlMs: 11_000,
      staleTtlMs: 66_000,
    });
    expect(resolveRouteDtoCacheDurations(CACHE_POLICY, "dashboard-enrichment")).toEqual({
      ttlMs: 22_000,
      staleTtlMs: 66_000,
    });
    expect(resolveRouteDtoCacheDurations(CACHE_POLICY, "dashboard-performance")).toEqual({
      ttlMs: 33_000,
      staleTtlMs: 66_000,
    });
    expect(resolveRouteDtoCacheDurations(CACHE_POLICY, "portfolio-primary")).toEqual({
      ttlMs: 44_000,
      staleTtlMs: 66_000,
    });
    expect(resolveRouteDtoCacheDurations(CACHE_POLICY, "transactions-primary")).toEqual({
      ttlMs: 44_000,
      staleTtlMs: 66_000,
    });
    expect(resolveRouteDtoCacheDurations(CACHE_POLICY, "reports")).toEqual({
      ttlMs: 55_000,
      staleTtlMs: 66_000,
    });
  });

  it("clears only tagged route entries during targeted invalidation", () => {
    const dashboardKey = buildRouteDtoCacheKey("dashboard-primary", "self");
    const portfolioKey = buildRouteDtoCacheKey("portfolio-primary", "self");
    const untouchedKey = buildRouteDtoCacheKey("settings", "self");

    writeRouteDtoCache(dashboardKey, { value: "dashboard" }, {
      tags: [buildRouteDtoCacheTag("route", "dashboard-primary")],
    });
    writeRouteDtoCache(portfolioKey, { value: "portfolio" }, {
      tags: [buildRouteDtoCacheTag("route", "portfolio-primary")],
    });
    writeRouteDtoCache(untouchedKey, { value: "settings" }, {
      tags: [buildRouteDtoCacheTag("route", "settings")],
    });

    clearRouteDtoCacheByTags([
      buildRouteDtoCacheTag("route", "dashboard-primary"),
      buildRouteDtoCacheTag("route", "portfolio-primary"),
    ]);

    expect(readRouteDtoCache(dashboardKey)).toBeNull();
    expect(readRouteDtoCache(portfolioKey)).toBeNull();
    expect(readRouteDtoCache<{ value: string }>(untouchedKey)?.payload.value).toBe("settings");
  });

  it("clears the portfolio-context cache tag set in one call", () => {
    const taggedKeys = PORTFOLIO_CONTEXT_ROUTE_CACHE_TAGS.map((tag) => {
      const key = buildRouteDtoCacheKey("cache", tag);
      writeRouteDtoCache(key, { tag }, { tags: [tag] });
      return key;
    });
    const untouchedKey = buildRouteDtoCacheKey("cache", "profile");
    writeRouteDtoCache(untouchedKey, { value: "profile" }, {
      tags: [buildRouteDtoCacheTag("route", "profile")],
    });

    clearPortfolioContextRouteCaches();

    for (const key of taggedKeys) {
      expect(readRouteDtoCache(key)).toBeNull();
    }
    expect(readRouteDtoCache<{ value: string }>(untouchedKey)?.payload.value).toBe("profile");
  });
});
