import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ROUTE_CACHE_POLICIES,
  DEFAULT_VALUATION_HEALTH_THRESHOLDS,
  getEffectiveRouteCachePolicy,
  getEffectiveValuationHealthThresholds,
  minorUnitToleranceFor,
  resolveRouteCachePolicyFromRow,
} from "../../../src/services/appConfig/valuationHealth.js";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import { fakePersistenceWithAppConfig } from "./_helpers.js";

describe("valuation health app config helpers", () => {
  beforeEach(() => {
    _resetAppConfigCache();
  });

  afterEach(() => {
    _resetAppConfigCache();
  });

  it("uses code defaults when no overrides are configured", async () => {
    setAppConfigCachePersistence(fakePersistenceWithAppConfig() as never);
    await refresh();

    expect(getEffectiveValuationHealthThresholds()).toEqual(DEFAULT_VALUATION_HEALTH_THRESHOLDS);
    expect(getEffectiveRouteCachePolicy()).toEqual(DEFAULT_ROUTE_CACHE_POLICIES.balanced);
  });

  it("resolves custom route cache TTLs from flat scalar app_config fields", async () => {
    setAppConfigCachePersistence(fakePersistenceWithAppConfig({
      routeCachePolicyMode: "custom",
      routeCacheDashboardPrimaryTtlMs: 15_000,
      routeCacheDashboardEnrichmentTtlMs: 20_000,
      routeCacheDashboardPerformanceTtlMs: 25_000,
      routeCachePortfolioTtlMs: 30_000,
      routeCacheReportsTtlMs: 35_000,
      routeCacheStaleUsableTtlMs: 40_000,
    }) as never);
    await refresh();

    expect(getEffectiveRouteCachePolicy()).toEqual({
      mode: "custom",
      dashboardPrimaryTtlMs: 15_000,
      dashboardEnrichmentTtlMs: 20_000,
      dashboardPerformanceTtlMs: 25_000,
      portfolioTtlMs: 30_000,
      reportsTtlMs: 35_000,
      staleUsableTtlMs: 40_000,
    });
  });

  it("falls back missing custom route cache TTLs to balanced defaults", () => {
    expect(resolveRouteCachePolicyFromRow({
      routeCachePolicyMode: "custom",
      routeCacheDashboardPrimaryTtlMs: null,
      routeCacheDashboardEnrichmentTtlMs: 45_000,
      routeCacheDashboardPerformanceTtlMs: null,
      routeCachePortfolioTtlMs: null,
      routeCacheReportsTtlMs: 90_000,
      routeCacheStaleUsableTtlMs: null,
    })).toEqual({
      mode: "custom",
      dashboardPrimaryTtlMs: DEFAULT_ROUTE_CACHE_POLICIES.balanced.dashboardPrimaryTtlMs,
      dashboardEnrichmentTtlMs: 45_000,
      dashboardPerformanceTtlMs: DEFAULT_ROUTE_CACHE_POLICIES.balanced.dashboardPerformanceTtlMs,
      portfolioTtlMs: DEFAULT_ROUTE_CACHE_POLICIES.balanced.portfolioTtlMs,
      reportsTtlMs: 90_000,
      staleUsableTtlMs: DEFAULT_ROUTE_CACHE_POLICIES.balanced.staleUsableTtlMs,
    });
  });

  it("treats AUD and USD as cent-tolerant and TWD/KRW/JPY as whole-unit tolerant", () => {
    expect(minorUnitToleranceFor("AUD")).toBe(0.01);
    expect(minorUnitToleranceFor("USD")).toBe(0.01);
    expect(minorUnitToleranceFor("TWD")).toBe(1);
    expect(minorUnitToleranceFor("KRW")).toBe(1);
    expect(minorUnitToleranceFor("JPY")).toBe(1);
  });
});
