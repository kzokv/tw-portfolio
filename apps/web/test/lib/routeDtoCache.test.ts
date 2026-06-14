import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRouteDtoCacheKey,
  clearRouteDtoCacheByPrefix,
  getRouteDtoCachePrefix,
  getRouteDtoContextScope,
  readRouteDtoCache,
  writeRouteDtoCache,
} from "../../lib/routeDtoCache";
import { clearContextCookie, writeContextCookie } from "../../lib/context";

function installStorageMocks() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(window, key, {
      configurable: true,
      value: storage,
    });
  }
}

describe("routeDtoCache", () => {
  beforeEach(() => {
    installStorageMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    clearContextCookie();
    vi.useRealTimers();
  });

  it("round-trips cached payloads with the normalized route key", () => {
    const key = buildRouteDtoCacheKey("dashboard-primary", "self", "en");
    writeRouteDtoCache(key, { value: 42 });

    expect(readRouteDtoCache<{ value: number }>(key)).toEqual(
      expect.objectContaining({ payload: { value: 42 } }),
    );
  });

  it("serves stale cache entries until the stale window elapses", () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-08T12:00:00.000Z");
    vi.setSystemTime(now);
    const key = buildRouteDtoCacheKey("portfolio-primary", "self", "en");
    writeRouteDtoCache(key, { value: 7 }, 1000);

    vi.setSystemTime(new Date(now.getTime() + 1500));

    expect(readRouteDtoCache<{ value: number }>(key)).toEqual(
      expect.objectContaining({
        payload: { value: 7 },
        status: "stale",
        ttlMs: 1000,
      }),
    );
    expect(readRouteDtoCache(key, { allowStale: false })).toBeNull();

    vi.setSystemTime(new Date(now.getTime() + 10 * 60 * 1000 + 1));

    expect(readRouteDtoCache(key)).toBeNull();
  });

  it("clears all cached entries under a shared prefix", () => {
    const prefix = getRouteDtoCachePrefix();
    const dashboardKey = buildRouteDtoCacheKey("dashboard-primary", "self");
    const portfolioKey = buildRouteDtoCacheKey("portfolio-primary", "self");
    writeRouteDtoCache(dashboardKey, { value: "dashboard" });
    writeRouteDtoCache(portfolioKey, { value: "portfolio" });

    clearRouteDtoCacheByPrefix(prefix);

    expect(readRouteDtoCache(dashboardKey)).toBeNull();
    expect(readRouteDtoCache(portfolioKey)).toBeNull();
  });

  it("partitions context scope by signed-in user and selected portfolio owner", () => {
    expect(getRouteDtoContextScope("user-a")).toBe("session:user-a:context:self");
    expect(getRouteDtoContextScope("user-b")).toBe("session:user-b:context:self");

    writeContextCookie("owner-1");

    expect(getRouteDtoContextScope("user-a")).toBe("session:user-a:context:owner-1");
  });
});
