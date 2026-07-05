import { describe, expect, it, vi } from "vitest";
import { runQuoteFallbackRefresh, type QuoteFallbackPolicy } from "../../../src/services/market-data/quoteFallbackRefreshService.js";

function policy(overrides: Partial<QuoteFallbackPolicy> = {}): QuoteFallbackPolicy {
  return {
    id: "policy-au-etpmag",
    marketCode: "AU",
    ticker: "ETPMAG",
    provider: "eodhd",
    priceType: "eod_close",
    providerSymbol: "ETPMAG.AU",
    active: true,
    ...overrides,
  };
}

function deps() {
  const taipeiDate = (at: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return {
    persistence: {
      getLatestQuoteFallbackSnapshot: vi.fn().mockResolvedValue(null),
      upsertQuoteFallbackSnapshot: vi.fn().mockResolvedValue(undefined),
      updateQuoteFallbackPolicyRefreshStatus: vi.fn().mockResolvedValue(undefined),
      createMarketDataActivityEvent: vi.fn().mockResolvedValue(undefined),
    },
    provider: {
      isConfigured: vi.fn().mockReturnValue(true),
      fetchCloseSnapshot: vi.fn().mockResolvedValue({
        marketCode: "AU",
        providerSymbol: "ETPMAG.AU",
        closeDate: "2026-07-03",
        previousCloseDate: "2026-07-02",
        currency: "AUD",
        currencySource: "market_default",
        latest: { marketDate: "2026-07-03", close: 82.44 },
        previous: { marketDate: "2026-07-02", close: 81.75 },
        fetchedAt: "2026-07-05T12:00:00.000Z",
        source: "eodhd-eod",
        providerMetadata: { request: { from: "2026-07-02", to: "2026-07-03" }, rowCount: 2 },
      }),
    },
    budget: {
      tryConsume: vi.fn().mockResolvedValue({ allowed: true, limit: 20, used: 1, remaining: 19 }),
    },
    tradingCalendar: {
      isTradingDay: vi.fn(async (_market: string, date: string) => date === "2026-07-03" || date === "2026-07-02"),
      getOfficialCalendarDayStatus: vi.fn(async (_market: string, at: Date) => {
        const localDate = taipeiDate(at);
        return {
          localDate,
          calendarYear: 2026,
          status: localDate === "2026-07-03" || localDate === "2026-07-02" ? "open" : "closed",
          reason: "not_trading_day",
        } as const;
      }),
    },
    log: { info: vi.fn(), warn: vi.fn() },
  };
}

describe("quoteFallbackRefreshService", () => {
  it("stores a fresh fallback snapshot after the latest eligible close", async () => {
    const input = deps();
    const result = await runQuoteFallbackRefresh({
      policies: [policy()],
      persistence: input.persistence,
      provider: input.provider,
      tradingCalendar: input.tradingCalendar,
      budget: input.budget,
      closeRefreshGraceMinutes: 10,
      now: new Date("2026-07-05T12:00:00.000Z"),
      log: input.log,
    });

    expect(result.summary).toEqual({
      success: 1,
      warning: 0,
      error: 0,
      skipped: 0,
      rate_limited: 0,
    });
    expect(input.budget.tryConsume).toHaveBeenCalledWith({ budgetDate: "2026-07-05", calls: 1 });
    expect(input.provider.fetchCloseSnapshot).toHaveBeenCalledWith({
      marketCode: "AU",
      providerSymbol: "ETPMAG.AU",
      closeDate: "2026-07-03",
      previousCloseDate: "2026-07-02",
    });
    expect(input.persistence.upsertQuoteFallbackSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      policyId: "policy-au-etpmag",
      marketDate: "2026-07-03",
      close: 82.44,
      previousClose: 81.75,
      currency: "AUD",
      source: "eodhd-eod",
    }));
    expect(input.persistence.updateQuoteFallbackPolicyRefreshStatus).toHaveBeenCalledWith({
      policyId: "policy-au-etpmag",
      status: "success",
      refreshedAt: "2026-07-05T12:00:00.000Z",
      error: null,
      errorCode: null,
    });
  });

  it("skips when the latest snapshot already covers the eligible close date", async () => {
    const input = deps();
    input.persistence.getLatestQuoteFallbackSnapshot = vi.fn().mockResolvedValue({
      marketDate: "2026-07-03",
      close: 82.44,
      previousClose: 81.75,
    });

    const result = await runQuoteFallbackRefresh({
      policies: [policy()],
      persistence: input.persistence,
      provider: input.provider,
      tradingCalendar: input.tradingCalendar,
      budget: input.budget,
      closeRefreshGraceMinutes: 10,
      now: new Date("2026-07-05T12:00:00.000Z"),
      log: input.log,
    });

    expect(result.items[0]).toMatchObject({
      status: "skipped",
      marketDate: "2026-07-03",
    });
    expect(input.budget.tryConsume).not.toHaveBeenCalled();
    expect(input.provider.fetchCloseSnapshot).not.toHaveBeenCalled();
    expect(input.persistence.upsertQuoteFallbackSnapshot).not.toHaveBeenCalled();
    expect(input.persistence.updateQuoteFallbackPolicyRefreshStatus).not.toHaveBeenCalled();
  });

  it("marks the policy rate-limited when the daily budget is exhausted", async () => {
    const input = deps();
    input.budget.tryConsume = vi.fn().mockResolvedValue({
      allowed: false,
      limit: 20,
      used: 20,
      remaining: 0,
    });

    const result = await runQuoteFallbackRefresh({
      policies: [policy()],
      persistence: input.persistence,
      provider: input.provider,
      tradingCalendar: input.tradingCalendar,
      budget: input.budget,
      closeRefreshGraceMinutes: 10,
      now: new Date("2026-07-05T12:00:00.000Z"),
      log: input.log,
    });

    expect(result.items[0]).toMatchObject({
      status: "rate_limited",
      marketDate: "2026-07-03",
    });
    expect(input.provider.fetchCloseSnapshot).not.toHaveBeenCalled();
    expect(input.persistence.updateQuoteFallbackPolicyRefreshStatus).toHaveBeenCalledWith({
      policyId: "policy-au-etpmag",
      status: "rate_limited",
      refreshedAt: null,
      error: "daily EODHD call budget exhausted for 2026-07-05",
      errorCode: "budget_exhausted",
    });
  });

  it("does not consume budget when the provider is not configured", async () => {
    const input = deps();
    input.provider.isConfigured = vi.fn().mockReturnValue(false);

    const result = await runQuoteFallbackRefresh({
      policies: [policy()],
      persistence: input.persistence,
      provider: input.provider,
      tradingCalendar: input.tradingCalendar,
      budget: input.budget,
      closeRefreshGraceMinutes: 10,
      now: new Date("2026-07-05T12:00:00.000Z"),
      log: input.log,
    });

    expect(result.items[0]).toMatchObject({
      status: "error",
      marketDate: "2026-07-03",
      message: "eodhd_api_key_missing",
      budgetAfter: null,
    });
    expect(input.budget.tryConsume).not.toHaveBeenCalled();
    expect(input.provider.fetchCloseSnapshot).not.toHaveBeenCalled();
    expect(input.persistence.updateQuoteFallbackPolicyRefreshStatus).toHaveBeenCalledWith({
      policyId: "policy-au-etpmag",
      status: "error",
      refreshedAt: null,
      error: "eodhd_api_key_missing",
      errorCode: "provider_config_missing",
    });
  });

  it("records a warning when the provider has no close for the eligible date", async () => {
    const input = deps();
    input.provider.fetchCloseSnapshot = vi.fn().mockResolvedValue(null);

    const result = await runQuoteFallbackRefresh({
      policies: [policy()],
      persistence: input.persistence,
      provider: input.provider,
      tradingCalendar: input.tradingCalendar,
      budget: input.budget,
      closeRefreshGraceMinutes: 10,
      now: new Date("2026-07-05T12:00:00.000Z"),
      log: input.log,
    });

    expect(result.items[0]).toMatchObject({
      status: "warning",
      marketDate: "2026-07-03",
    });
    expect(input.persistence.upsertQuoteFallbackSnapshot).not.toHaveBeenCalled();
  });

  it("records an error when the provider throws", async () => {
    const input = deps();
    input.provider.fetchCloseSnapshot = vi.fn().mockRejectedValue(new Error("upstream unavailable"));

    const result = await runQuoteFallbackRefresh({
      policies: [policy()],
      persistence: input.persistence,
      provider: input.provider,
      tradingCalendar: input.tradingCalendar,
      budget: input.budget,
      closeRefreshGraceMinutes: 10,
      now: new Date("2026-07-05T12:00:00.000Z"),
      log: input.log,
    });

    expect(result.items[0]).toMatchObject({
      status: "error",
      marketDate: "2026-07-03",
      message: "upstream unavailable",
    });
    expect(input.log.warn).toHaveBeenCalled();
  });
});
