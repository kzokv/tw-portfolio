import type { RouteCachePolicyDto, RouteCachePolicyMode, ValuationHealthThresholdsDto } from "@vakwen/shared-types";
import { getAppConfigCacheEntry } from "./cache.js";

export const DEFAULT_VALUATION_HEALTH_THRESHOLDS: ValuationHealthThresholdsDto = {
  relativeBps: 50,
  absoluteAud: 100,
  absoluteUsd: 100,
  absoluteTwd: 3000,
  absoluteKrw: 90000,
  absoluteJpy: 3000,
};

export const DEFAULT_ROUTE_CACHE_POLICIES: Record<RouteCachePolicyMode, RouteCachePolicyDto> = {
  fresh: {
    mode: "fresh",
    dashboardPrimaryTtlMs: 30_000,
    dashboardEnrichmentTtlMs: 15_000,
    dashboardPerformanceTtlMs: 60_000,
    portfolioTtlMs: 30_000,
    reportsTtlMs: 60_000,
    staleUsableTtlMs: 180_000,
  },
  balanced: {
    mode: "balanced",
    dashboardPrimaryTtlMs: 120_000,
    dashboardEnrichmentTtlMs: 60_000,
    dashboardPerformanceTtlMs: 300_000,
    portfolioTtlMs: 120_000,
    reportsTtlMs: 300_000,
    staleUsableTtlMs: 600_000,
  },
  low_load: {
    mode: "low_load",
    dashboardPrimaryTtlMs: 300_000,
    dashboardEnrichmentTtlMs: 180_000,
    dashboardPerformanceTtlMs: 900_000,
    portfolioTtlMs: 300_000,
    reportsTtlMs: 900_000,
    staleUsableTtlMs: 1_200_000,
  },
  custom: {
    mode: "custom",
    dashboardPrimaryTtlMs: 120_000,
    dashboardEnrichmentTtlMs: 60_000,
    dashboardPerformanceTtlMs: 300_000,
    portfolioTtlMs: 120_000,
    reportsTtlMs: 300_000,
    staleUsableTtlMs: 600_000,
  },
};

export function getEffectiveValuationHealthThresholds(): ValuationHealthThresholdsDto {
  const entry = getAppConfigCacheEntry();
  return {
    relativeBps: entry?.valuationHealthRelativeBps ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.relativeBps,
    absoluteAud: entry?.valuationHealthAbsoluteAud ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteAud,
    absoluteUsd: entry?.valuationHealthAbsoluteUsd ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteUsd,
    absoluteTwd: entry?.valuationHealthAbsoluteTwd ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteTwd,
    absoluteKrw: entry?.valuationHealthAbsoluteKrw ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteKrw,
    absoluteJpy: entry?.valuationHealthAbsoluteJpy ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteJpy,
  };
}

export function resolveRouteCachePolicyFromRow(row: {
  routeCachePolicyMode: RouteCachePolicyMode | null;
  routeCacheDashboardPrimaryTtlMs: number | null;
  routeCacheDashboardEnrichmentTtlMs: number | null;
  routeCacheDashboardPerformanceTtlMs: number | null;
  routeCachePortfolioTtlMs: number | null;
  routeCacheReportsTtlMs: number | null;
  routeCacheStaleUsableTtlMs: number | null;
}): RouteCachePolicyDto {
  const mode = row.routeCachePolicyMode ?? "balanced";
  if (mode !== "custom") {
    return DEFAULT_ROUTE_CACHE_POLICIES[mode];
  }
  const fallback = DEFAULT_ROUTE_CACHE_POLICIES.balanced;
  return {
    mode,
    dashboardPrimaryTtlMs: row.routeCacheDashboardPrimaryTtlMs ?? fallback.dashboardPrimaryTtlMs,
    dashboardEnrichmentTtlMs: row.routeCacheDashboardEnrichmentTtlMs ?? fallback.dashboardEnrichmentTtlMs,
    dashboardPerformanceTtlMs: row.routeCacheDashboardPerformanceTtlMs ?? fallback.dashboardPerformanceTtlMs,
    portfolioTtlMs: row.routeCachePortfolioTtlMs ?? fallback.portfolioTtlMs,
    reportsTtlMs: row.routeCacheReportsTtlMs ?? fallback.reportsTtlMs,
    staleUsableTtlMs: row.routeCacheStaleUsableTtlMs ?? fallback.staleUsableTtlMs,
  };
}

export function getEffectiveRouteCachePolicy(): RouteCachePolicyDto {
  const entry = getAppConfigCacheEntry();
  return resolveRouteCachePolicyFromRow({
    routeCachePolicyMode: entry?.routeCachePolicyMode ?? null,
    routeCacheDashboardPrimaryTtlMs: entry?.routeCacheDashboardPrimaryTtlMs ?? null,
    routeCacheDashboardEnrichmentTtlMs: entry?.routeCacheDashboardEnrichmentTtlMs ?? null,
    routeCacheDashboardPerformanceTtlMs: entry?.routeCacheDashboardPerformanceTtlMs ?? null,
    routeCachePortfolioTtlMs: entry?.routeCachePortfolioTtlMs ?? null,
    routeCacheReportsTtlMs: entry?.routeCacheReportsTtlMs ?? null,
    routeCacheStaleUsableTtlMs: entry?.routeCacheStaleUsableTtlMs ?? null,
  });
}

export function minorUnitToleranceFor(currency: string): number {
  return currency === "AUD" || currency === "USD" ? 0.01 : 1;
}
