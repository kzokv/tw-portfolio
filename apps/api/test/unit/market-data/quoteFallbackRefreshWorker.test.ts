import { describe, expect, it, vi } from "vitest";
import {
  createQuoteFallbackRefreshHandler,
  enqueueScheduledQuoteFallbackRefreshes,
  QUOTE_FALLBACK_REFRESH_QUEUE,
  quoteFallbackRefreshSingletonKey,
} from "../../../src/services/market-data/quoteFallbackRefreshWorker.js";

describe("quoteFallbackRefreshWorker", () => {
  it("normalizes policy tickers before matching scheduled refreshes to held positions", async () => {
    const requestedAt = "2026-07-05T12:00:00.000Z";
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const log = { info: vi.fn(), warn: vi.fn() };

    const result = await enqueueScheduledQuoteFallbackRefreshes({
      boss,
      persistence: {
        listHeldTickerMarketPairsForQuoteFallback: vi.fn().mockResolvedValue([
          { ticker: "ETPMAG", marketCode: "AU" },
        ]),
        listActiveQuoteFallbackPolicies: vi.fn().mockResolvedValue([
          {
            id: "policy-au-etpmag",
            marketCode: "AU",
            ticker: "etpmag",
            provider: "eodhd",
            priceType: "eod_close",
            providerSymbol: "ETPMAG.AU",
            active: true,
            reason: null,
            createdAt: requestedAt,
            updatedAt: requestedAt,
            deactivatedAt: null,
            lastRefreshStatus: null,
            lastRefreshAt: null,
            lastRefreshError: null,
            lastRefreshErrorCode: null,
          },
        ]),
      } as never,
      requestedAt,
      supportedMarkets: ["AU"],
      log,
    });

    expect(result).toEqual({ policyCount: 1, enqueuedCount: 1, droppedCount: 0 });
    expect(boss.send).toHaveBeenCalledWith(
      QUOTE_FALLBACK_REFRESH_QUEUE,
      { kind: "policy_refresh", ticker: "etpmag", marketCode: "AU", requestedAt, trigger: "scheduled" },
      { singletonKey: quoteFallbackRefreshSingletonKey("etpmag", "AU") },
    );
  });

  it("uses the quote fallback held-position query for scheduled refreshes", async () => {
    const requestedAt = "2026-07-05T12:00:00.000Z";
    const boss = { send: vi.fn().mockResolvedValue("job-1") };
    const log = { info: vi.fn(), warn: vi.fn() };
    const listHeldTickerMarketPairs = vi.fn().mockResolvedValue([]);
    const listHeldTickerMarketPairsForQuoteFallback = vi.fn().mockResolvedValue([
      { ticker: "PENDING", marketCode: "AU" },
    ]);

    const result = await enqueueScheduledQuoteFallbackRefreshes({
      boss,
      persistence: {
        listHeldTickerMarketPairs,
        listHeldTickerMarketPairsForQuoteFallback,
        listActiveQuoteFallbackPolicies: vi.fn().mockResolvedValue([
          {
            id: "policy-au-pending",
            marketCode: "AU",
            ticker: "PENDING",
            provider: "eodhd",
            priceType: "eod_close",
            providerSymbol: "PENDING.AU",
            active: true,
            reason: null,
            createdAt: requestedAt,
            updatedAt: requestedAt,
            deactivatedAt: null,
            lastRefreshStatus: null,
            lastRefreshAt: null,
            lastRefreshError: null,
            lastRefreshErrorCode: null,
          },
        ]),
      } as never,
      requestedAt,
      supportedMarkets: ["AU"],
      log,
    });

    expect(result).toEqual({ policyCount: 1, enqueuedCount: 1, droppedCount: 0 });
    expect(listHeldTickerMarketPairsForQuoteFallback).toHaveBeenCalledTimes(1);
    expect(listHeldTickerMarketPairs).not.toHaveBeenCalled();
  });

  it("uses execution time, not request time, for EODHD call budgets", async () => {
    const requestedAt = "2026-07-04T23:50:00.000Z";
    const executionAt = new Date("2026-07-05T12:00:00.000Z");
    const consumeEodhdCallBudget = vi.fn().mockResolvedValue({
      allowed: true,
      limit: 20,
      used: 1,
      remaining: 19,
    });
    const policy = {
      id: "policy-au-etpmag",
      marketCode: "AU",
      ticker: "ETPMAG",
      provider: "eodhd",
      priceType: "eod_close",
      providerSymbol: "ETPMAG.AU",
      active: true,
      reason: null,
      createdAt: requestedAt,
      updatedAt: requestedAt,
      deactivatedAt: null,
      lastRefreshStatus: null,
      lastRefreshAt: null,
      lastRefreshError: null,
      lastRefreshErrorCode: null,
    };
    const handler = createQuoteFallbackRefreshHandler({
      persistence: {
        getQuoteFallbackPolicy: vi.fn().mockResolvedValue(policy),
        getLatestQuoteFallbackSnapshot: vi.fn().mockResolvedValue(null),
        upsertQuoteFallbackSnapshot: vi.fn().mockResolvedValue(undefined),
        updateQuoteFallbackPolicyRefreshStatus: vi.fn().mockResolvedValue(policy),
        createMarketCalendarActivityEvent: vi.fn().mockResolvedValue(undefined),
        consumeEodhdCallBudget,
      } as never,
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
          providerMetadata: {},
        }),
      },
      tradingCalendar: {
        isTradingDay: vi.fn(async (_market: string, date: string) => date === "2026-07-03" || date === "2026-07-02"),
        getOfficialCalendarDayStatus: vi.fn(async (_market: string, at: Date) => {
          const localDate = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Australia/Sydney",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(at);
          return {
            localDate,
            calendarYear: 2026,
            status: localDate === "2026-07-03" || localDate === "2026-07-02" ? "open" : "closed",
            reason: "not_trading_day",
          } as const;
        }),
      },
      resolveRuntimeConfig: () => ({
        closeRefreshGraceMinutes: 10,
        dailyCallLimit: 20,
        supportedMarkets: ["AU"],
      }),
      log: { info: vi.fn(), warn: vi.fn() },
      now: () => executionAt,
    });

    await handler([{
      id: "job-1",
      data: {
        kind: "policy_refresh",
        ticker: "ETPMAG",
        marketCode: "AU",
        requestedAt,
        trigger: "scheduled",
      },
    }] as never);

    expect(consumeEodhdCallBudget).toHaveBeenCalledWith({
      budgetDate: "2026-07-05",
      limit: 20,
      calls: 1,
    });
  });
});
