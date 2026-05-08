// KZO-198 — Unit tests for backfill resolver category.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@tw-portfolio/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import {
  getEffectiveBackfillFinmind402RetryMs,
  getEffectiveBackfillRetryDelaySeconds,
  getEffectiveBackfillRetryLimit,
  getEffectiveDailyRefreshLookbackDays,
  getEffectiveDailyRefreshPriority,
} from "../../../src/services/appConfig/backfill.js";
import { fakePersistenceWithAppConfig, seedCache } from "./_helpers.js";

beforeEach(() => _resetAppConfigCache());
afterEach(() => _resetAppConfigCache());

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

const CASES = {
  getEffectiveBackfillRetryLimit: {
    resolver: getEffectiveBackfillRetryLimit,
    cacheField: "backfillRetryLimit",
    envValue: Env.BACKFILL_RETRY_LIMIT,
    dbValue: 7,
  },
  getEffectiveBackfillRetryDelaySeconds: {
    resolver: getEffectiveBackfillRetryDelaySeconds,
    cacheField: "backfillRetryDelaySeconds",
    envValue: Env.BACKFILL_RETRY_DELAY_SECONDS,
    dbValue: 30,
  },
  getEffectiveBackfillFinmind402RetryMs: {
    resolver: getEffectiveBackfillFinmind402RetryMs,
    cacheField: "backfillFinmind402RetryMs",
    envValue: Env.BACKFILL_FINMIND_402_RETRY_MS,
    dbValue: 7_200_000,
  },
  getEffectiveDailyRefreshLookbackDays: {
    resolver: getEffectiveDailyRefreshLookbackDays,
    cacheField: "dailyRefreshLookbackDays",
    envValue: Env.DAILY_REFRESH_LOOKBACK_DAYS,
    dbValue: 5,
  },
  getEffectiveDailyRefreshPriority: {
    resolver: getEffectiveDailyRefreshPriority,
    cacheField: "dailyRefreshPriority",
    envValue: Env.DAILY_REFRESH_PRIORITY,
    dbValue: 100,
  },
} as const;

for (const [name, tc] of Object.entries(CASES)) {
  describe(`appConfig/backfill — ${name}`, () => {
    it("returns Env fallback when cache entry is null", () => {
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
