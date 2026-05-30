// ui-enhancement — Unit tests for the account-lifecycle resolver.
//
// `getEffectiveAccountHardPurgeDays()` returns:
//   - `cacheEntry.accountHardPurgeDays` when it's a positive integer
//   - `Env.ACCOUNT_HARD_PURGE_DAYS` (default 30) otherwise
//
// Mirrors the resolver tests for the other Tier-B knobs.
//
// NOTE — Backend Implementer must add `accountHardPurgeDays: null` to the
// baseline in `_helpers.ts` so cached rows in this test continue to match
// the AppConfigCacheEntry shape after the schema extension.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@vakwen/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import { getEffectiveAccountHardPurgeDays } from "../../../src/services/appConfig/accountLifecycle.js";
import { seedCache } from "./_helpers.js";

beforeEach(() => _resetAppConfigCache());
afterEach(() => _resetAppConfigCache());

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

describe("getEffectiveAccountHardPurgeDays", () => {
  it("falls back to Env.ACCOUNT_HARD_PURGE_DAYS when no cache entry", () => {
    expect(getEffectiveAccountHardPurgeDays()).toBe(Env.ACCOUNT_HARD_PURGE_DAYS);
  });

  it("falls back to Env when cache row has accountHardPurgeDays=null", async () => {
    await seedCache({ accountHardPurgeDays: null }, cacheModule);
    expect(getEffectiveAccountHardPurgeDays()).toBe(Env.ACCOUNT_HARD_PURGE_DAYS);
  });

  it("returns the admin-overridden value when cache row carries a positive integer", async () => {
    await seedCache({ accountHardPurgeDays: 45 }, cacheModule);
    expect(getEffectiveAccountHardPurgeDays()).toBe(45);
  });

  it("returns the override even for the minimum bound (1 day)", async () => {
    await seedCache({ accountHardPurgeDays: 1 }, cacheModule);
    expect(getEffectiveAccountHardPurgeDays()).toBe(1);
  });

  it("returns the override at the maximum bound (365 days)", async () => {
    await seedCache({ accountHardPurgeDays: 365 }, cacheModule);
    expect(getEffectiveAccountHardPurgeDays()).toBe(365);
  });
});
