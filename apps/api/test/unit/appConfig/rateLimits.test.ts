// KZO-198 — Unit tests for rateLimits resolver category.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@vakwen/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import {
  getEffectiveInviteStatusLimit,
  getEffectiveInviteStatusWindowMs,
  getEffectiveMarketDataPriceLimit,
  getEffectiveMarketDataPriceWindowMs,
  getEffectiveMarketDataSearchLimit,
  getEffectiveMarketDataSearchWindowMs,
} from "../../../src/services/appConfig/rateLimits.js";
import { fakePersistenceWithAppConfig, seedCache } from "./_helpers.js";

beforeEach(() => {
  _resetAppConfigCache();
});
afterEach(() => {
  _resetAppConfigCache();
});

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

interface Case {
  resolver: () => number;
  cacheField: string;
  envValue: number;
  dbValue: number;
}

const CASES: Record<string, Case> = {
  getEffectiveMarketDataPriceWindowMs: {
    resolver: getEffectiveMarketDataPriceWindowMs,
    cacheField: "marketDataPriceWindowMs",
    envValue: Env.MARKET_DATA_PRICE_WINDOW_MS,
    dbValue: 30_000,
  },
  getEffectiveMarketDataPriceLimit: {
    resolver: getEffectiveMarketDataPriceLimit,
    cacheField: "marketDataPriceLimit",
    envValue: Env.MARKET_DATA_PRICE_LIMIT,
    dbValue: 250,
  },
  getEffectiveMarketDataSearchWindowMs: {
    resolver: getEffectiveMarketDataSearchWindowMs,
    cacheField: "marketDataSearchWindowMs",
    envValue: Env.MARKET_DATA_SEARCH_WINDOW_MS,
    dbValue: 30_000,
  },
  getEffectiveMarketDataSearchLimit: {
    resolver: getEffectiveMarketDataSearchLimit,
    cacheField: "marketDataSearchLimit",
    envValue: Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE,
    dbValue: 99,
  },
  getEffectiveInviteStatusWindowMs: {
    resolver: getEffectiveInviteStatusWindowMs,
    cacheField: "inviteStatusWindowMs",
    envValue: Env.INVITE_STATUS_WINDOW_MS,
    dbValue: 45_000,
  },
  getEffectiveInviteStatusLimit: {
    resolver: getEffectiveInviteStatusLimit,
    cacheField: "inviteStatusLimit",
    envValue: Env.INVITE_STATUS_LIMIT,
    dbValue: 25,
  },
};

for (const [name, tc] of Object.entries(CASES)) {
  describe(`appConfig/rateLimits — ${name}`, () => {
    it("returns Env fallback when cache entry is null (env-only path)", () => {
      // No persistence registered → no cache → env-fallback.
      expect(tc.resolver()).toBe(tc.envValue);
    });

    it("returns Env fallback when app_config column is NULL", async () => {
      setAppConfigCachePersistence(fakePersistenceWithAppConfig({}) as never);
      await refresh();
      expect(tc.resolver()).toBe(tc.envValue);
    });

    it("returns DB value when app_config column is set", async () => {
      await seedCache({ [tc.cacheField]: tc.dbValue } as never, cacheModule);
      expect(tc.resolver()).toBe(tc.dbValue);
    });

    it("DB value takes precedence over env default", async () => {
      await seedCache({ [tc.cacheField]: tc.dbValue } as never, cacheModule);
      const result = tc.resolver();
      expect(result).toBe(tc.dbValue);
      expect(result).not.toBe(tc.envValue);
    });
  });
}
