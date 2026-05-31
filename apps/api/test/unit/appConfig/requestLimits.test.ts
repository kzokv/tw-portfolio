// KZO-199 — Unit tests for request-limit resolver (user-preferences body cap).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@vakwen/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import { getEffectiveUserPreferencesMaxBytes } from "../../../src/services/appConfig/requestLimits.js";
import { fakePersistenceWithAppConfig, seedCache } from "./_helpers.js";

beforeEach(() => {
  _resetAppConfigCache();
});
afterEach(() => {
  _resetAppConfigCache();
});

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

describe("appConfig/requestLimits — getEffectiveUserPreferencesMaxBytes", () => {
  it("returns Env fallback when cache entry is null (env-only path)", () => {
    // No persistence registered → no cache → env-fallback.
    expect(getEffectiveUserPreferencesMaxBytes()).toBe(Env.USER_PREFERENCES_MAX_BYTES);
  });

  it("returns Env fallback when app_config column is NULL", async () => {
    setAppConfigCachePersistence(fakePersistenceWithAppConfig({}) as never);
    await refresh();
    expect(getEffectiveUserPreferencesMaxBytes()).toBe(Env.USER_PREFERENCES_MAX_BYTES);
  });

  it("returns DB value when app_config column is set", async () => {
    const dbValue = 4096;
    await seedCache({ userPreferencesMaxBytes: dbValue } as never, cacheModule);
    expect(getEffectiveUserPreferencesMaxBytes()).toBe(dbValue);
  });

  it("DB value takes precedence over env default", async () => {
    const dbValue = 16_384;
    await seedCache({ userPreferencesMaxBytes: dbValue } as never, cacheModule);
    const result = getEffectiveUserPreferencesMaxBytes();
    expect(result).toBe(dbValue);
    expect(result).not.toBe(Env.USER_PREFERENCES_MAX_BYTES);
  });

  it("env fallback is a positive integer", () => {
    const fallback = Env.USER_PREFERENCES_MAX_BYTES;
    expect(typeof fallback).toBe("number");
    expect(Number.isInteger(fallback)).toBe(true);
    expect(fallback).toBeGreaterThan(0);
  });
});
