import { describe, expect, it, vi } from "vitest";
import type { MarketCode } from "@tw-portfolio/domain";
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
    ).toBe("2026-05-01");
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
});
