import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Env } from "@vakwen/config";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  _resetAppConfigCache,
  refresh as refreshAppConfigCache,
  setAppConfigCachePersistence,
} from "../../src/services/appConfig/cache.js";
import {
  deriveRepairAvailableAt,
  getEffectiveRepairCooldownMinutes,
  remainingCooldownMinutes,
} from "../../src/services/appConfig/repairCooldown.js";

// ── getEffectiveRepairCooldownMinutes (KZO-198 cache-based) ──────────────────

describe("getEffectiveRepairCooldownMinutes", () => {
  let persistence: MemoryPersistence;

  beforeEach(async () => {
    _resetAppConfigCache();
    persistence = new MemoryPersistence();
    await persistence.init();
    setAppConfigCachePersistence(persistence);
  });

  afterEach(() => {
    _resetAppConfigCache();
  });

  it("returns Env.REPAIR_COOLDOWN_MINUTES when DB value is null", async () => {
    persistence._setRepairCooldownMinutes(null);
    await refreshAppConfigCache();
    expect(getEffectiveRepairCooldownMinutes()).toBe(Env.REPAIR_COOLDOWN_MINUTES);
  });

  it("returns DB value when set", async () => {
    persistence._setRepairCooldownMinutes(15);
    await refreshAppConfigCache();
    expect(getEffectiveRepairCooldownMinutes()).toBe(15);
  });

  it("honors DB value of 1", async () => {
    persistence._setRepairCooldownMinutes(1);
    await refreshAppConfigCache();
    expect(getEffectiveRepairCooldownMinutes()).toBe(1);
  });

  it("DB value takes precedence when it differs from env default", async () => {
    persistence._setRepairCooldownMinutes(5);
    await refreshAppConfigCache();
    const result = getEffectiveRepairCooldownMinutes();
    expect(result).toBe(5);
    expect(result).not.toBe(Env.REPAIR_COOLDOWN_MINUTES);
  });
});

// ── deriveRepairAvailableAt ──────────────────────────────────────────────────

describe("deriveRepairAvailableAt", () => {
  it("returns null when lastRepairAt is null", () => {
    expect(deriveRepairAvailableAt(null, 60)).toBeNull();
  });

  it("returns null when lastRepairAt is undefined", () => {
    expect(deriveRepairAvailableAt(undefined, 60)).toBeNull();
  });

  it("returns null when lastRepairAt is empty string", () => {
    expect(deriveRepairAvailableAt("", 60)).toBeNull();
  });

  it("returns null when lastRepairAt is an unparseable date string", () => {
    expect(deriveRepairAvailableAt("not-a-date", 60)).toBeNull();
  });

  it("returns ISO string of lastRepairAt + cooldownMinutes (60 min)", () => {
    const base = "2026-04-15T10:00:00.000Z";
    expect(deriveRepairAvailableAt(base, 60)).toBe("2026-04-15T11:00:00.000Z");
  });

  it("returns ISO string of lastRepairAt + cooldownMinutes (30 min)", () => {
    const base = "2026-04-15T10:00:00.000Z";
    expect(deriveRepairAvailableAt(base, 30)).toBe("2026-04-15T10:30:00.000Z");
  });

  it("rolls over midnight correctly (45 min past 23:45)", () => {
    const base = "2026-04-15T23:45:00.000Z";
    expect(deriveRepairAvailableAt(base, 45)).toBe("2026-04-16T00:30:00.000Z");
  });
});

// ── remainingCooldownMinutes ─────────────────────────────────────────────────

describe("remainingCooldownMinutes", () => {
  it("returns full cooldown when repair just happened (0 elapsed)", () => {
    const now = Date.now();
    const justNow = new Date(now).toISOString();
    expect(remainingCooldownMinutes(justNow, 60, now)).toBe(60);
  });

  it("returns remaining minutes at mid-cooldown (10 min elapsed of 60)", () => {
    const now = Date.now();
    const tenMinutesAgo = new Date(now - 10 * 60_000).toISOString();
    expect(remainingCooldownMinutes(tenMinutesAgo, 60, now)).toBe(50);
  });

  it("returns 0 when cooldown has exactly expired", () => {
    const now = Date.now();
    const sixtyMinutesAgo = new Date(now - 60 * 60_000).toISOString();
    expect(remainingCooldownMinutes(sixtyMinutesAgo, 60, now)).toBe(0);
  });

  it("returns 0 when well past expiry", () => {
    const now = Date.now();
    const twoHoursAgo = new Date(now - 120 * 60_000).toISOString();
    expect(remainingCooldownMinutes(twoHoursAgo, 60, now)).toBe(0);
  });

  it("respects parameterized cooldown (5 min cooldown, 3 min elapsed → 2 remaining)", () => {
    const now = Date.now();
    const threeMinutesAgo = new Date(now - 3 * 60_000).toISOString();
    expect(remainingCooldownMinutes(threeMinutesAgo, 5, now)).toBe(2);
  });

  it("returns 0 for invalid date string (NaN guard)", () => {
    expect(remainingCooldownMinutes("not-a-date", 60, Date.now())).toBe(0);
  });

  it("ceils fractional remaining minutes (0.5 remaining → 1)", () => {
    const now = Date.now();
    const almostExpired = new Date(now - (60 * 60_000 - 30_000)).toISOString();
    expect(remainingCooldownMinutes(almostExpired, 60, now)).toBe(1);
  });
});
