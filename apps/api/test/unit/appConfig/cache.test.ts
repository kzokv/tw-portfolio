// KZO-198 — Unit tests for the AppConfig TTL cache.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_CONFIG_CACHE_TTL_MS,
  _resetAppConfigCache,
  getAppConfigCacheEntry,
  invalidate,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import { fakePersistenceWithAppConfig } from "./_helpers.js";

beforeEach(() => {
  _resetAppConfigCache();
});

afterEach(() => {
  vi.useRealTimers();
  _resetAppConfigCache();
});

// ── basic operation ─────────────────────────────────────────────────────────

describe("AppConfigCache — basic operation", () => {
  it("returns null entry before any persistence is registered", () => {
    expect(getAppConfigCacheEntry()).toBeNull();
  });

  it("returns null when persistence is registered but refresh has not been awaited", () => {
    setAppConfigCachePersistence(fakePersistenceWithAppConfig({ repairCooldownMinutes: 42 }) as never);
    // No `await refresh()` — entry should be null.
    expect(getAppConfigCacheEntry()).toBeNull();
  });

  it("returns the persisted row after refresh()", async () => {
    setAppConfigCachePersistence(
      fakePersistenceWithAppConfig({ repairCooldownMinutes: 45 }) as never,
    );
    await refresh();
    expect(getAppConfigCacheEntry()?.repairCooldownMinutes).toBe(45);
  });

  it("does not call persistence.getAppConfig more than once within TTL window", async () => {
    const fake = fakePersistenceWithAppConfig({ repairCooldownMinutes: 60 });
    setAppConfigCachePersistence(fake as never);
    await refresh();
    // Subsequent reads within TTL hit cache; do not trigger another fetch.
    getAppConfigCacheEntry();
    getAppConfigCacheEntry();
    getAppConfigCacheEntry();
    expect(fake.getAppConfig).toHaveBeenCalledTimes(1);
  });
});

// ── TTL expiry / invalidate ──────────────────────────────────────────────────

describe("AppConfigCache — TTL expiry and invalidate", () => {
  it("returns the new value after invalidate() forces a refresh", async () => {
    const fake = fakePersistenceWithAppConfig({ repairCooldownMinutes: 30 });
    setAppConfigCachePersistence(fake as never);
    await refresh();
    expect(getAppConfigCacheEntry()?.repairCooldownMinutes).toBe(30);

    // Swap the row; invalidate; await a fresh refresh.
    fake.getAppConfig.mockResolvedValueOnce({
      ...(await fakePersistenceWithAppConfig({ repairCooldownMinutes: 90 }).getAppConfig()),
    });
    invalidate();
    // invalidate() schedules a refresh; await it deterministically.
    await refresh();
    expect(getAppConfigCacheEntry()?.repairCooldownMinutes).toBe(90);
  });

  it("a refresh() called after TTL expiry re-queries persistence", async () => {
    vi.useFakeTimers();
    const fake = fakePersistenceWithAppConfig({ repairCooldownMinutes: 60 });
    setAppConfigCachePersistence(fake as never);
    await refresh();
    expect(fake.getAppConfig).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(APP_CONFIG_CACHE_TTL_MS + 5_000);

    // After TTL, getAppConfigCacheEntry() should still return last-good value
    // (per cache.ts contract) but a forced refresh re-queries.
    await refresh();
    expect(fake.getAppConfig).toHaveBeenCalledTimes(2);
  });
});

// ── failure modes ────────────────────────────────────────────────────────────

describe("AppConfigCache — failure modes", () => {
  it("returns null entry (env-fallback) when persistence.getAppConfig rejects on first refresh", async () => {
    const fake = { getAppConfig: vi.fn().mockRejectedValue(new Error("db down")) };
    setAppConfigCachePersistence(fake as never);
    await refresh();
    expect(getAppConfigCacheEntry()).toBeNull();
  });

  it("does not throw out of refresh() on persistence failure", async () => {
    const fake = { getAppConfig: vi.fn().mockRejectedValue(new Error("db down")) };
    setAppConfigCachePersistence(fake as never);
    await expect(refresh()).resolves.toBeUndefined();
  });
});

// ── pre-warm ─────────────────────────────────────────────────────────────────

describe("AppConfigCache — pre-warm", () => {
  it("pre-warm populates the cache so the first resolver call sees the row", async () => {
    setAppConfigCachePersistence(
      fakePersistenceWithAppConfig({ repairCooldownMinutes: 60 }) as never,
    );
    await refresh(); // analogous to app.ready() pre-warm
    expect(getAppConfigCacheEntry()).not.toBeNull();
    expect(getAppConfigCacheEntry()?.repairCooldownMinutes).toBe(60);
  });

  it("pre-warm failure does not throw out of refresh()", async () => {
    const fake = { getAppConfig: vi.fn().mockRejectedValue(new Error("db down")) };
    setAppConfigCachePersistence(fake as never);
    await expect(refresh()).resolves.toBeUndefined();
    expect(getAppConfigCacheEntry()).toBeNull();
  });
});

// ── _resetAppConfigCache (test-only) ────────────────────────────────────────

describe("AppConfigCache — _resetAppConfigCache (test-only)", () => {
  it("clears the singleton cache state between tests", async () => {
    setAppConfigCachePersistence(
      fakePersistenceWithAppConfig({ repairCooldownMinutes: 5 }) as never,
    );
    await refresh();
    expect(getAppConfigCacheEntry()).not.toBeNull();

    _resetAppConfigCache();
    expect(getAppConfigCacheEntry()).toBeNull();
  });
});
