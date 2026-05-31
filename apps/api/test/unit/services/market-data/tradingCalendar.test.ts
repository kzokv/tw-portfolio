import { describe, expect, it, vi } from "vitest";
import type { MarketCode } from "@vakwen/domain";
import {
  isTradingDayPure,
  latestSettledTradingDayPure,
  TradingCalendarCache,
  tradingDaysBetweenPure,
} from "../../../../src/services/market-data/tradingCalendar.js";

describe("trading calendar helpers", () => {
  const twDates = new Set(["2026-05-01", "2026-05-04", "2026-05-05"]);

  it("latestSettledTradingDay: TW before local close returns the previous trading day", () => {
    expect(
      latestSettledTradingDayPure(
        twDates,
        "TW" as MarketCode,
        new Date("2026-05-05T02:00:00.000Z"),
      ),
    ).toBe("2026-05-04");
  });

  it("latestSettledTradingDay: TW after local close returns the same trading day", () => {
    expect(
      latestSettledTradingDayPure(
        twDates,
        "TW" as MarketCode,
        new Date("2026-05-05T06:00:00.000Z"),
      ),
    ).toBe("2026-05-05");
  });

  it("latestSettledTradingDay: US spring DST boundary uses New York local close", () => {
    const usDates = new Set(["2026-03-06", "2026-03-09"]);

    expect(
      latestSettledTradingDayPure(
        usDates,
        "US" as MarketCode,
        new Date("2026-03-09T19:30:00.000Z"),
      ),
    ).toBe("2026-03-06");
    expect(
      latestSettledTradingDayPure(
        usDates,
        "US" as MarketCode,
        new Date("2026-03-09T20:30:00.000Z"),
      ),
    ).toBe("2026-03-09");
  });

  it("latestSettledTradingDay: US fall DST boundary uses EST close after transition", () => {
    const usDates = new Set(["2026-10-30", "2026-11-02"]);

    expect(
      latestSettledTradingDayPure(
        usDates,
        "US" as MarketCode,
        new Date("2026-11-02T20:30:00.000Z"),
      ),
    ).toBe("2026-10-30");
    expect(
      latestSettledTradingDayPure(
        usDates,
        "US" as MarketCode,
        new Date("2026-11-02T21:30:00.000Z"),
      ),
    ).toBe("2026-11-02");
  });

  it("latestSettledTradingDay: AU DST boundaries use Sydney local close", () => {
    const auDates = new Set(["2026-04-03", "2026-04-06", "2026-10-02", "2026-10-05"]);

    expect(
      latestSettledTradingDayPure(
        auDates,
        "AU" as MarketCode,
        new Date("2026-04-06T05:30:00.000Z"),
      ),
    ).toBe("2026-04-03");
    expect(
      latestSettledTradingDayPure(
        auDates,
        "AU" as MarketCode,
        new Date("2026-10-05T05:00:00.000Z"),
      ),
    ).toBe("2026-10-05");
  });

  it("latestSettledTradingDay: 2027 DST boundary stays market-local", () => {
    const usDates = new Set(["2027-03-12", "2027-03-15"]);

    expect(
      latestSettledTradingDayPure(
        usDates,
        "US" as MarketCode,
        new Date("2027-03-15T20:30:00.000Z"),
      ),
    ).toBe("2027-03-15");
  });

  it("latestSettledTradingDay: settleGraceHours delays same-day settlement", () => {
    expect(
      latestSettledTradingDayPure(
        twDates,
        "TW" as MarketCode,
        new Date("2026-05-05T08:00:00.000Z"),
        { settleGraceHours: 14 },
      ),
    ).toBe("2026-05-04");
    expect(
      latestSettledTradingDayPure(
        twDates,
        "TW" as MarketCode,
        new Date("2026-05-05T20:00:00.000Z"),
        { settleGraceHours: 14 },
      ),
    ).toBe("2026-05-05");
    expect(
      latestSettledTradingDayPure(
        twDates,
        "TW" as MarketCode,
        new Date("2026-05-05T06:00:00.000Z"),
      ),
    ).toBe("2026-05-05");
  });

  it("latestSettledTradingDay: empty equity calendar falls back to weekdays", () => {
    expect(
      latestSettledTradingDayPure(
        new Set(),
        "TW" as MarketCode,
        new Date("2026-05-09T12:00:00.000Z"),
      ),
    ).toBe("2026-05-08");
  });

  it("latestSettledTradingDay: FX uses weekdays and the UTC publish hour", () => {
    expect(
      latestSettledTradingDayPure(
        new Set(),
        "FX",
        new Date("2026-05-04T18:00:00.000Z"),
      ),
    ).toBe("2026-05-04");
    expect(
      latestSettledTradingDayPure(
        new Set(),
        "FX",
        new Date("2026-05-04T15:00:00.000Z"),
      ),
      // 2026-05-01 (Labour Day, ECB holiday) is skipped; 2026-04-30 (Thursday) is the prior trading day.
    ).toBe("2026-04-30");
    expect(
      latestSettledTradingDayPure(
        new Set(),
        "FX",
        new Date("2026-05-09T12:00:00.000Z"),
      ),
    ).toBe("2026-05-08");
  });

  it("tradingDaysBetween: counts trading days in the half-open interval", () => {
    expect(tradingDaysBetweenPure(twDates, "2026-05-01", "2026-05-05", "TW" as MarketCode)).toBe(2);
    expect(tradingDaysBetweenPure(twDates, "2026-05-04", "2026-05-04", "TW" as MarketCode)).toBe(0);
    expect(tradingDaysBetweenPure(twDates, "2026-05-05", "2026-05-04", "TW" as MarketCode)).toBe(0);
    expect(tradingDaysBetweenPure(twDates, "2026-05-02", "2026-05-05", "TW" as MarketCode)).toBe(2);
  });

  it("tradingDaysBetween: FX counts weekdays only", () => {
    expect(tradingDaysBetweenPure(new Set(), "2026-05-01", "2026-05-08", "FX")).toBe(5);
  });

  it("isTradingDay: uses the derived set, with weekday fallback for bootstrap", () => {
    expect(isTradingDayPure(twDates, "TW" as MarketCode, "2026-05-04")).toBe(true);
    expect(isTradingDayPure(twDates, "TW" as MarketCode, "2026-05-02")).toBe(false);
    expect(isTradingDayPure(new Set(), "TW" as MarketCode, "2026-05-04")).toBe(true);
    expect(isTradingDayPure(new Set(), "FX", "2026-05-09")).toBe(false);
  });

  it("TradingCalendarCache: bootstrap fallback warning fires once per empty refresh", async () => {
    const log = { error: vi.fn(), warn: vi.fn() };
    const cache = new TradingCalendarCache({
      persistence: {
        getDistinctBarDates: vi.fn().mockResolvedValue([]),
      },
      log,
    });

    await expect(cache.latestSettledTradingDay("TW" as MarketCode, new Date("2026-05-04T18:00:00.000Z"))).resolves.toBe("2026-05-04");
    await expect(cache.isTradingDay("TW" as MarketCode, "2026-05-04")).resolves.toBe(true);

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      { market: "TW", reason: "latest_settled_trading_day" },
      "trading_calendar_bootstrap_fallback",
    );
  });

  // ── KZO-192: ECB/TARGET2 holiday-aware FX calendar ──────────────────────────
  // The 4 tests below are TDD-RED before the Implementer lands the source changes.
  // isTradingDayPure / latestSettledTradingDayPure / tradingDaysBetweenPure for
  // "FX" currently use weekday-only logic; the new ECB-aware helpers make them
  // return false on the 6 TARGET2 closing days per year.

  it("FX market: Computus correctly identifies Good Friday and Easter Monday for 5 known years", () => {
    // computeEasterSunday is private; verify indirectly via isTradingDayPure("FX", ...).
    // Good Friday = Easter − 2 days → must NOT be a trading day (ECB holiday, weekday).
    // Easter Monday = Easter + 1 day → must NOT be a trading day (ECB holiday, weekday).
    // Current weekday-only code returns true for all → RED until Implementer lands.

    // 2024: Easter Sunday = 2024-03-31
    expect(isTradingDayPure(new Set(), "FX", "2024-03-29")).toBe(false); // Good Friday
    expect(isTradingDayPure(new Set(), "FX", "2024-04-01")).toBe(false); // Easter Monday

    // 2025: Easter Sunday = 2025-04-20
    expect(isTradingDayPure(new Set(), "FX", "2025-04-18")).toBe(false); // Good Friday
    expect(isTradingDayPure(new Set(), "FX", "2025-04-21")).toBe(false); // Easter Monday

    // 2026: Easter Sunday = 2026-04-05
    expect(isTradingDayPure(new Set(), "FX", "2026-04-03")).toBe(false); // Good Friday
    expect(isTradingDayPure(new Set(), "FX", "2026-04-06")).toBe(false); // Easter Monday

    // 2027: Easter Sunday = 2027-03-28
    expect(isTradingDayPure(new Set(), "FX", "2027-03-26")).toBe(false); // Good Friday
    expect(isTradingDayPure(new Set(), "FX", "2027-03-29")).toBe(false); // Easter Monday

    // 2030: Easter Sunday = 2030-04-21
    expect(isTradingDayPure(new Set(), "FX", "2030-04-19")).toBe(false); // Good Friday
    expect(isTradingDayPure(new Set(), "FX", "2030-04-22")).toBe(false); // Easter Monday
  });

  it("isTradingDayPure: FX market — all 6 ECB/TARGET2 holidays return false for 2026 and 2027", () => {
    // 2026: 6 TARGET2 closing days
    expect(isTradingDayPure(new Set(), "FX", "2026-01-01")).toBe(false); // Thu — New Year's Day
    expect(isTradingDayPure(new Set(), "FX", "2026-04-03")).toBe(false); // Fri — Good Friday
    expect(isTradingDayPure(new Set(), "FX", "2026-04-06")).toBe(false); // Mon — Easter Monday
    expect(isTradingDayPure(new Set(), "FX", "2026-05-01")).toBe(false); // Fri — Labour Day
    expect(isTradingDayPure(new Set(), "FX", "2026-12-25")).toBe(false); // Fri — Christmas Day
    expect(isTradingDayPure(new Set(), "FX", "2026-12-26")).toBe(false); // Sat — Boxing Day (weekend AND ECB holiday)

    // 2027: 6 TARGET2 closing days
    expect(isTradingDayPure(new Set(), "FX", "2027-01-01")).toBe(false); // Fri — New Year's Day
    expect(isTradingDayPure(new Set(), "FX", "2027-03-26")).toBe(false); // Fri — Good Friday
    expect(isTradingDayPure(new Set(), "FX", "2027-03-29")).toBe(false); // Mon — Easter Monday
    expect(isTradingDayPure(new Set(), "FX", "2027-05-01")).toBe(false); // Sat — Labour Day (weekend-dominated)
    expect(isTradingDayPure(new Set(), "FX", "2027-12-25")).toBe(false); // Sat — Christmas (weekend-dominated)
    expect(isTradingDayPure(new Set(), "FX", "2027-12-26")).toBe(false); // Sun — Boxing Day (weekend-dominated)

    // Sanity: adjacent weekday (Thu Apr 2, 2026 — day before Good Friday) IS a trading day
    expect(isTradingDayPure(new Set(), "FX", "2026-04-02")).toBe(true);
  });

  it("latestSettledTradingDayPure: FX rolls back past ECB holidays", () => {
    // Good Friday 2026 — 18:00 UTC (after publish window):
    //   candidate = 2026-04-03 (Good Friday, ECB holiday). Rolls back 1 day → 2026-04-02 (Thu).
    expect(
      latestSettledTradingDayPure(new Set(), "FX", new Date("2026-04-03T18:00:00.000Z")),
    ).toBe("2026-04-02"); // AC #1 verbatim

    // Easter Monday 2026 — 18:00 UTC (after publish window):
    //   candidate = 2026-04-06 (Easter Monday, ECB). Rolls back past Mon (ECB) + Sat-Sun (weekend)
    //   + Fri Apr 3 (Good Friday, ECB) → 2026-04-02 (Thu).
    expect(
      latestSettledTradingDayPure(new Set(), "FX", new Date("2026-04-06T18:00:00.000Z")),
    ).toBe("2026-04-02");

    // Mon Dec 28, 2026 — 15:00 UTC (BEFORE publish window):
    //   candidate = 2026-12-27 (Sun). Rolls back: Sun Dec 27 → Sat Dec 26 (ECB) → Fri Dec 25 (ECB)
    //   → Thu Dec 24. Result: 2026-12-24.
    // NOTE: scope-todo listed "2026-12-28T18:00:00.000Z" (after-publish) which would give
    //   candidate Dec 28 (Mon, regular trading day) and result "2026-12-28" — inconsistent with
    //   the expected "2026-12-24". Using 15:00 UTC (before-publish) to match the stated expected.
    expect(
      latestSettledTradingDayPure(new Set(), "FX", new Date("2026-12-28T15:00:00.000Z")),
    ).toBe("2026-12-24");

    // Mon Jan 4, 2027 — 15:00 UTC (BEFORE publish window), year-spanning cross-year cache case:
    //   candidate = 2027-01-03 (Sun). Rolls back: Sun Jan 3 → Sat Jan 2 → Fri Jan 1 (NYD, ECB)
    //   → Thu Dec 31, 2026. Result: 2026-12-31.
    // NOTE: scope-todo listed "2027-01-04T18:00:00.000Z" (after-publish) which would give
    //   candidate Jan 4 (Mon, regular trading day) and result "2027-01-04" — inconsistent with
    //   the expected "2026-12-31". Using 15:00 UTC (before-publish) to match the stated expected.
    expect(
      latestSettledTradingDayPure(new Set(), "FX", new Date("2027-01-04T15:00:00.000Z")),
    ).toBe("2026-12-31");
  });

  it("tradingDaysBetweenPure: FX skips ECB holidays — Easter week 2026", () => {
    // Half-open interval (2026-04-01, 2026-04-08] — walks Apr 2 through Apr 8:
    //   Apr 2 (Thu): trading day — count 1
    //   Apr 3 (Fri, Good Friday): ECB skip
    //   Apr 4-5 (Sat-Sun): weekend skip
    //   Apr 6 (Mon, Easter Monday): ECB skip
    //   Apr 7 (Tue): trading day — count 2
    //   Apr 8 (Wed): trading day — count 3
    // Expected: 3. Was 5 under weekday-only (Apr 2,3,6,7,8); delta proves holiday-skipping works.
    expect(tradingDaysBetweenPure(new Set(), "2026-04-01", "2026-04-08", "FX")).toBe(3);
  });

  it("tradingDaysBetweenPure: FX skips ECB holidays — cross-year Dec 2026 to Jan 2027", () => {
    // Half-open interval (2026-12-23, 2027-01-05] — walks Dec 24 through Jan 5:
    //   Dec 24 (Thu): trading — 1
    //   Dec 25 (Fri, Christmas Day): ECB skip
    //   Dec 26-27 (Sat-Sun): weekend skip
    //   Dec 28 (Mon): trading — 2
    //   Dec 29 (Tue): trading — 3
    //   Dec 30 (Wed): trading — 4
    //   Dec 31 (Thu): trading — 5
    //   Jan 01 2027 (Fri, New Year's Day): ECB skip
    //   Jan 02-03 (Sat-Sun): weekend skip
    //   Jan 04 (Mon): trading — 6
    //   Jan 05 (Tue): trading — 7
    // Expected: 7. Exercises cross-year lazy cache (ecbHolidaysForYear called for 2026 and 2027).
    expect(tradingDaysBetweenPure(new Set(), "2026-12-23", "2027-01-05", "FX")).toBe(7);
  });

  // ── end KZO-192 ─────────────────────────────────────────────────────────────
});
