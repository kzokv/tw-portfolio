// KZO-198 — Unit tests for providerHealth resolver category.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@vakwen/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import {
  getEffectiveDownNotificationSuppressionMs,
  getEffectiveErrorTrailRetentionDays,
  getEffectiveRerunCooldownMs,
} from "../../../src/services/appConfig/providerHealth.js";
import { fakePersistenceWithAppConfig, seedCache } from "./_helpers.js";

beforeEach(() => _resetAppConfigCache());
afterEach(() => _resetAppConfigCache());

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

const CASES = {
  getEffectiveDownNotificationSuppressionMs: {
    resolver: getEffectiveDownNotificationSuppressionMs,
    cacheField: "providerDownNotificationSuppressionMs",
    envValue: Env.PROVIDER_DOWN_NOTIFICATION_SUPPRESSION_MS,
    dbValue: 90_000,
  },
  getEffectiveErrorTrailRetentionDays: {
    resolver: getEffectiveErrorTrailRetentionDays,
    cacheField: "providerErrorTrailRetentionDays",
    envValue: Env.PROVIDER_ERROR_TRAIL_RETENTION_DAYS,
    dbValue: 14,
  },
  getEffectiveRerunCooldownMs: {
    resolver: getEffectiveRerunCooldownMs,
    cacheField: "providerRerunCooldownMs",
    envValue: Env.PROVIDER_RERUN_COOLDOWN_MS,
    dbValue: 600_000,
  },
} as const;

for (const [name, tc] of Object.entries(CASES)) {
  describe(`appConfig/providerHealth — ${name}`, () => {
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
