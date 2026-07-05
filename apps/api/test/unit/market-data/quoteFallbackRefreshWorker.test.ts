import { describe, expect, it, vi } from "vitest";
import {
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
        listHeldTickerMarketPairs: vi.fn().mockResolvedValue([
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
});
