/**
 * KZO-197 — Unit tests for the per-provider rerun-cooldown resolver.
 *
 * Coverage:
 *   - `getEffectiveYahooAuRerunCooldownMs()` — env fallback (30 min default),
 *     DB override path via `seedCache({yahooAuRerunCooldownMs: …})`.
 *   - `getEffectiveProviderRerunCooldownMs(providerId)` dispatches:
 *       - `'yahoo-finance-au'` → AU resolver
 *       - all other known providerIds → generic `getEffectiveRerunCooldownMs()`
 *   - DB override on the AU column does NOT bleed into other-provider lookups.
 *
 * Per `.claude/rules/vitest-config-patterns.md` Env-Proxy section: we use the
 * shared `seedCache` helper rather than mutating Env, since the resolver
 * reads cache first then env-fallback.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@tw-portfolio/config";
import {
  _resetAppConfigCache,
  refresh,
  setAppConfigCachePersistence,
} from "../../../src/services/appConfig/cache.js";
import {
  getEffectiveProviderRerunCooldownMs,
  getEffectiveRerunCooldownMs,
  getEffectiveYahooAuRerunCooldownMs,
} from "../../../src/services/appConfig/providerHealth.js";
import { fakePersistenceWithAppConfig, seedCache } from "./_helpers.js";

beforeEach(() => _resetAppConfigCache());
afterEach(() => _resetAppConfigCache());

const cacheModule = { _resetAppConfigCache, refresh, setAppConfigCachePersistence };

describe("getEffectiveYahooAuRerunCooldownMs (KZO-197)", () => {
  it("returns Env fallback when cache entry is null", () => {
    expect(getEffectiveYahooAuRerunCooldownMs()).toBe(Env.YAHOO_AU_RERUN_COOLDOWN_MS);
  });

  it("returns Env fallback when app_config column is NULL", async () => {
    setAppConfigCachePersistence(fakePersistenceWithAppConfig({}) as never);
    await refresh();
    expect(getEffectiveYahooAuRerunCooldownMs()).toBe(Env.YAHOO_AU_RERUN_COOLDOWN_MS);
  });

  it("env default is 30 minutes (load-bearing for the cooldown UX)", () => {
    expect(Env.YAHOO_AU_RERUN_COOLDOWN_MS).toBe(30 * 60 * 1000);
  });

  it("returns DB value when app_config column is set", async () => {
    await seedCache({ yahooAuRerunCooldownMs: 5_000 } as never, cacheModule);
    expect(getEffectiveYahooAuRerunCooldownMs()).toBe(5_000);
  });

  it("DB value takes precedence over env default", async () => {
    await seedCache({ yahooAuRerunCooldownMs: 1_234_567 } as never, cacheModule);
    const result = getEffectiveYahooAuRerunCooldownMs();
    expect(result).toBe(1_234_567);
    expect(result).not.toBe(Env.YAHOO_AU_RERUN_COOLDOWN_MS);
  });
});

describe("getEffectiveProviderRerunCooldownMs (KZO-197)", () => {
  it("dispatches 'yahoo-finance-au' to the AU resolver (env fallback path)", () => {
    expect(getEffectiveProviderRerunCooldownMs("yahoo-finance-au")).toBe(
      Env.YAHOO_AU_RERUN_COOLDOWN_MS,
    );
  });

  it("dispatches 'yahoo-finance-au' to the AU resolver (DB override path)", async () => {
    await seedCache({ yahooAuRerunCooldownMs: 9_999 } as never, cacheModule);
    expect(getEffectiveProviderRerunCooldownMs("yahoo-finance-au")).toBe(9_999);
  });

  it.each([
    "finmind-tw",
    "finmind-us",
    "frankfurter",
    "twelve-data-au",
    "asx-gics-csv",
  ])("dispatches '%s' to the generic resolver (env fallback)", (providerId) => {
    expect(getEffectiveProviderRerunCooldownMs(providerId)).toBe(
      Env.PROVIDER_RERUN_COOLDOWN_MS,
    );
  });

  it("AU DB override does NOT bleed into other providers", async () => {
    await seedCache({ yahooAuRerunCooldownMs: 5_000 } as never, cacheModule);
    expect(getEffectiveProviderRerunCooldownMs("yahoo-finance-au")).toBe(5_000);
    // TW / US / others stay on the generic 60-s default.
    for (const id of ["finmind-tw", "finmind-us", "frankfurter", "twelve-data-au", "asx-gics-csv"]) {
      expect(getEffectiveProviderRerunCooldownMs(id)).toBe(Env.PROVIDER_RERUN_COOLDOWN_MS);
    }
  });

  it("Generic DB override does NOT bleed into AU", async () => {
    await seedCache({ providerRerunCooldownMs: 7_777 } as never, cacheModule);
    expect(getEffectiveRerunCooldownMs()).toBe(7_777);
    expect(getEffectiveProviderRerunCooldownMs("finmind-tw")).toBe(7_777);
    // AU resolves via its own column → falls through to env default since
    // its column is null in this seed.
    expect(getEffectiveProviderRerunCooldownMs("yahoo-finance-au")).toBe(
      Env.YAHOO_AU_RERUN_COOLDOWN_MS,
    );
  });

  it("unknown providerId falls back to the generic resolver (defensive default)", () => {
    expect(getEffectiveProviderRerunCooldownMs("totally-unknown-provider")).toBe(
      Env.PROVIDER_RERUN_COOLDOWN_MS,
    );
  });
});
