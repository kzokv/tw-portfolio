// KZO-199 — Unit tests for sharing knob resolvers.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@vakwen/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import {
  getEffectiveAnonymousShareRateLimitMax,
  getEffectiveAnonymousShareRateLimitWindowMs,
  getEffectiveAnonymousShareTokenCap,
  getEffectiveAnonymousShareTokenRetentionMs,
} from "../../../src/services/appConfig/sharing.js";
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
  getEffectiveAnonymousShareTokenCap: {
    resolver: getEffectiveAnonymousShareTokenCap,
    cacheField: "anonymousShareTokenCap",
    envValue: Env.ANONYMOUS_SHARE_TOKEN_CAP,
    dbValue: 5,
  },
  getEffectiveAnonymousShareTokenRetentionMs: {
    resolver: getEffectiveAnonymousShareTokenRetentionMs,
    cacheField: "anonymousShareTokenRetentionMs",
    envValue: Env.ANONYMOUS_SHARE_TOKEN_RETENTION_MS,
    dbValue: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  getEffectiveAnonymousShareRateLimitMax: {
    resolver: getEffectiveAnonymousShareRateLimitMax,
    cacheField: "anonymousShareRateLimitMax",
    envValue: Env.ANONYMOUS_SHARE_RATE_LIMIT_MAX,
    dbValue: 50,
  },
  getEffectiveAnonymousShareRateLimitWindowMs: {
    resolver: getEffectiveAnonymousShareRateLimitWindowMs,
    cacheField: "anonymousShareRateLimitWindowMs",
    envValue: Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS,
    dbValue: 120_000, // 2 min
  },
};

for (const [name, tc] of Object.entries(CASES)) {
  describe(`appConfig/sharing — ${name}`, () => {
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
