// KZO-198 — Unit tests for sse resolver category.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@tw-portfolio/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import {
  getEffectiveSseBufferDefaultTtlMs,
  getEffectiveSseHeartbeatIntervalMs,
  getEffectiveSseMaxConnectionsPerUser,
} from "../../../src/services/appConfig/sse.js";
import { fakePersistenceWithAppConfig, seedCache } from "./_helpers.js";

beforeEach(() => _resetAppConfigCache());
afterEach(() => _resetAppConfigCache());

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

const CASES = {
  getEffectiveSseHeartbeatIntervalMs: {
    resolver: getEffectiveSseHeartbeatIntervalMs,
    cacheField: "sseHeartbeatIntervalMs",
    envValue: Env.SSE_HEARTBEAT_INTERVAL_MS,
    dbValue: 20_000,
  },
  getEffectiveSseMaxConnectionsPerUser: {
    resolver: getEffectiveSseMaxConnectionsPerUser,
    cacheField: "sseMaxConnectionsPerUser",
    envValue: Env.SSE_MAX_CONNECTIONS_PER_USER,
    dbValue: 10,
  },
  getEffectiveSseBufferDefaultTtlMs: {
    resolver: getEffectiveSseBufferDefaultTtlMs,
    cacheField: "sseBufferDefaultTtlMs",
    envValue: Env.SSE_BUFFER_DEFAULT_TTL_MS,
    dbValue: 90_000,
  },
} as const;

for (const [name, tc] of Object.entries(CASES)) {
  describe(`appConfig/sse — ${name}`, () => {
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
