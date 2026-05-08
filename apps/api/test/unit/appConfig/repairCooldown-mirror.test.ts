// KZO-198 — Mirror tests for `getEffectiveRepairCooldownMinutes` at the
// migrated path `apps/api/src/services/appConfig/repairCooldown.ts`.
//
// Backend Implementer owns deletion of the legacy unit-test file
// `apps/api/test/unit/repair-cooldown.test.ts` per `implementer-qa-test-ownership.md`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@tw-portfolio/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import {
  deriveRepairAvailableAt,
  getEffectiveRepairCooldownMinutes,
  remainingCooldownMinutes,
} from "../../../src/services/appConfig/repairCooldown.js";
import { fakePersistenceWithAppConfig, seedCache } from "./_helpers.js";

beforeEach(() => _resetAppConfigCache());
afterEach(() => _resetAppConfigCache());

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

describe("appConfig/repairCooldown — getEffectiveRepairCooldownMinutes (cache-driven)", () => {
  it("returns Env.REPAIR_COOLDOWN_MINUTES when cache entry is null", () => {
    expect(getEffectiveRepairCooldownMinutes()).toBe(Env.REPAIR_COOLDOWN_MINUTES);
  });

  it("returns the DB value when app_config has a positive integer", async () => {
    await seedCache({ repairCooldownMinutes: 15 }, cacheModule);
    expect(getEffectiveRepairCooldownMinutes()).toBe(15);
  });

  it("returns Env.REPAIR_COOLDOWN_MINUTES when app_config column is NULL", async () => {
    setAppConfigCachePersistence(fakePersistenceWithAppConfig({}) as never);
    await refresh();
    expect(getEffectiveRepairCooldownMinutes()).toBe(Env.REPAIR_COOLDOWN_MINUTES);
  });

  it("DB value of 1 (minimum) is honored", async () => {
    await seedCache({ repairCooldownMinutes: 1 }, cacheModule);
    expect(getEffectiveRepairCooldownMinutes()).toBe(1);
  });

  it("DB value differs from env default → DB precedence", async () => {
    await seedCache({ repairCooldownMinutes: 5 }, cacheModule);
    const result = getEffectiveRepairCooldownMinutes();
    expect(result).toBe(5);
    expect(result).not.toBe(Env.REPAIR_COOLDOWN_MINUTES);
  });
});

describe("appConfig/repairCooldown — pure helpers (no cache dependency)", () => {
  it("deriveRepairAvailableAt returns null on null/empty input", () => {
    expect(deriveRepairAvailableAt(null, 60)).toBeNull();
    expect(deriveRepairAvailableAt("", 60)).toBeNull();
    expect(deriveRepairAvailableAt("not-a-date", 60)).toBeNull();
  });

  it("deriveRepairAvailableAt adds the cooldown minutes correctly", () => {
    expect(deriveRepairAvailableAt("2026-04-15T10:00:00.000Z", 60)).toBe(
      "2026-04-15T11:00:00.000Z",
    );
  });

  it("remainingCooldownMinutes is 0 when expired, full when fresh", () => {
    const now = Date.now();
    const justNow = new Date(now).toISOString();
    expect(remainingCooldownMinutes(justNow, 60, now)).toBe(60);
    const expired = new Date(now - 60 * 60_000).toISOString();
    expect(remainingCooldownMinutes(expired, 60, now)).toBe(0);
  });
});
