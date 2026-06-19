import { describe, expect, it } from "vitest";
import { buildAppConfigDtoFromRow } from "../../src/routes/adminRoutes.js";

describe("buildAppConfigDtoFromRow — ticker price freshness", () => {
  it("includes grouped tickerPriceFreshness config in the admin DTO", () => {
    const dto = buildAppConfigDtoFromRow({
      repairCooldownMinutes: null,
      dashboardPerformanceRanges: null,
      metadataEnrichmentMode: null,
      finmindApiTokenEncrypted: null,
      twelveDataApiKeyEncrypted: null,
      mcpOauthTokenSecretEncrypted: null,
      marketDataPriceWindowMs: null,
      marketDataPriceLimit: null,
      marketDataSearchWindowMs: null,
      marketDataSearchLimit: null,
      inviteStatusWindowMs: null,
      inviteStatusLimit: null,
      providerDownNotificationSuppressionMs: null,
      providerErrorTrailRetentionDays: null,
      providerRerunCooldownMs: null,
      yahooAuRerunCooldownMs: null,
      providerFixerDangerousMatchThreshold: null,
      providerFixerPreviewSampleLimit: null,
      providerFixerUiPageSize: null,
      providerFixerAutoPauseFailuresPerMinute: null,
      providerFixerPreviewTokenTtlMinutes: null,
      providerOperationAutoRenewIntervalMinutes: null,
      providerIncidentRecurrenceWindowMinutes: null,
      providerHealthWarningUnresolvedThreshold: null,
      providerHealthCriticalUnresolvedThreshold: null,
      providerOperationStaleHeartbeatMinutes: null,
      providerOperationSummaryRetentionDays: null,
      providerOperationLogRetentionDays: null,
      providerIncidentRetentionDays: null,
      providerResolvedItemRetentionDays: null,
      finmindProviderRateLimitPerHour: null,
      twelveDataProviderRateLimitPerMinute: null,
      yahooAuProviderRateLimitPerMinute: null,
      yahooKrProviderRateLimitPerMinute: null,
      frankfurterProviderRateLimitPerMinute: null,
      asxGicsProviderRateLimitPerHour: null,
      backfillRetryLimit: null,
      backfillRetryDelaySeconds: null,
      backfillFinmind402RetryMs: null,
      dailyRefreshLookbackDays: null,
      dailyRefreshPriority: null,
      sseHeartbeatIntervalMs: null,
      sseMaxConnectionsPerUser: null,
      sseBufferDefaultTtlMs: null,
      catalogAbsenceThreshold: null,
      catalogAbsenceGuardPercent: null,
      catalogAbsenceGuardFloor: null,
      asxGicsRefreshCron: null,
      anonymousShareTokenCap: null,
      anonymousShareRateLimitMax: null,
      anonymousShareRateLimitWindowMs: null,
      anonymousShareTokenRetentionMs: null,
      userPreferencesMaxBytes: null,
      accountHardPurgeDays: null,
      valuationHealthRelativeBps: null,
      valuationHealthAbsoluteAud: null,
      valuationHealthAbsoluteUsd: null,
      valuationHealthAbsoluteTwd: null,
      valuationHealthAbsoluteKrw: null,
      routeCachePolicyMode: null,
      routeCacheDashboardPrimaryTtlMs: null,
      routeCacheDashboardEnrichmentTtlMs: null,
      routeCacheDashboardPerformanceTtlMs: null,
      routeCachePortfolioTtlMs: null,
      routeCacheReportsTtlMs: null,
      routeCacheStaleUsableTtlMs: null,
      updatedAt: "2026-06-17T00:00:00.000Z",
      tickerPriceIntradayEnabled: false,
      tickerPriceSupportedMarkets: ["TW", "US"],
      tickerPriceYahooChartRange: "5d",
      tickerPriceYahooChartInterval: "15m",
      tickerPriceSyncTickerCap: 40,
      tickerPriceActivityDetailedRetentionDays: 14,
      tickerPriceActivitySummaryRetentionDays: 120,
      tickerPriceCalendarHistoryRetentionDays: 900,
    } as never);

    expect(dto.tickerPriceFreshness.effectiveIntradayEnabled).toBe(false);
    expect(dto.tickerPriceFreshness.effectiveSupportedMarkets).toEqual(["TW", "US"]);
    expect(dto.tickerPriceFreshness.effectiveYahooChartRange).toBe("5d");
    expect(dto.tickerPriceFreshness.effectiveYahooChartInterval).toBe("15m");
    expect(dto.tickerPriceFreshness.effectiveSyncTickerCap).toBe(40);
    expect(dto.tickerPriceFreshness.effectiveActivityDetailedRetentionDays).toBe(14);
    expect(dto.tickerPriceFreshness.effectiveActivitySummaryRetentionDays).toBe(120);
    expect(dto.tickerPriceFreshness.effectiveCalendarHistoryRetentionDays).toBe(900);
    expect(dto.tickerPriceFreshness.options.supportedMarkets).toEqual(["TW", "US", "AU", "KR"]);
    expect(dto.tickerPriceFreshness.bounds.syncTickerCap).toEqual({ min: 1, max: 10000 });
    expect(dto.tickerPriceFreshness.bounds.activityDetailedRetentionDays).toEqual({ min: 1, max: 365 });
  });
});
