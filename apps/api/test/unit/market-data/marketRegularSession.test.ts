import { describe, expect, it, vi } from "vitest";
import {
  getRegularSessionCloseRefreshDate,
  getRegularSessionState,
} from "../../../src/services/market-data/marketRegularSession.js";

describe("marketRegularSession", () => {
  it("marks TW as open during a TW trading day regular session", async () => {
    const state = await getRegularSessionState(
      "TW",
      { isTradingDay: vi.fn().mockResolvedValue(true) },
      new Date("2026-06-17T02:15:00.000Z"),
    );

    expect(state).toMatchObject({
      marketCode: "TW",
      marketTimeZone: "Asia/Taipei",
      localDate: "2026-06-17",
      isTradingDay: true,
      isOpen: true,
    });
  });

  it("marks US as closed before the regular session opens", async () => {
    const state = await getRegularSessionState(
      "US",
      { isTradingDay: vi.fn().mockResolvedValue(true) },
      new Date("2026-06-17T12:45:00.000Z"),
    );

    expect(state.isTradingDay).toBe(true);
    expect(state.isOpen).toBe(false);
    expect(state.opensAtLocal.endsWith("09:30:00")).toBe(true);
    expect(state.closesAtLocal.endsWith("16:00:00")).toBe(true);
  });

  it("marks KR as closed on weekends even during regular local hours", async () => {
    const state = await getRegularSessionState(
      "KR",
      { isTradingDay: vi.fn().mockResolvedValue(false) },
      new Date("2026-06-20T01:30:00.000Z"),
    );

    expect(state.isTradingDay).toBe(false);
    expect(state.isOpen).toBe(false);
  });

  it("treats missing current-day calendar coverage as non-trading instead of falling back to weekday", async () => {
    const tradingDates = new Set(["2026-06-16"]);
    const state = await getRegularSessionState(
      "TW",
      {
        isTradingDay: vi.fn().mockResolvedValue(false),
        getTradingDates: vi.fn().mockResolvedValue(tradingDates),
      },
      new Date("2026-06-17T02:15:00.000Z"),
    );

    expect(state.isTradingDay).toBe(false);
    expect(state.isOpen).toBe(false);
  });

  it("preserves populated calendar weekday holiday closures", async () => {
    const tradingDates = new Set(["2026-06-16", "2026-06-18"]);
    const state = await getRegularSessionState(
      "TW",
      {
        isTradingDay: vi.fn().mockResolvedValue(false),
        getTradingDates: vi.fn().mockResolvedValue(tradingDates),
      },
      new Date("2026-06-17T02:15:00.000Z"),
    );

    expect(state.isTradingDay).toBe(false);
    expect(state.isOpen).toBe(false);
  });

  it("treats an empty calendar as unknown instead of assuming weekday trading", async () => {
    const state = await getRegularSessionState(
      "TW",
      {
        isTradingDay: vi.fn().mockResolvedValue(false),
        getTradingDates: vi.fn().mockResolvedValue(new Set()),
      },
      new Date("2026-06-17T02:15:00.000Z"),
    );

    expect(state.isTradingDay).toBe(false);
    expect(state.isOpen).toBe(false);
  });

  it("surfaces calendar_unknown when the official market-year calendar is missing", async () => {
    const state = await getRegularSessionState(
      "TW",
      {
        isTradingDay: vi.fn().mockResolvedValue(false),
        getOfficialCalendarDayStatus: vi.fn().mockResolvedValue({
          localDate: "2026-06-17",
          calendarYear: 2026,
          status: "calendar_unknown",
          reason: "calendar_unknown",
        }),
      },
      new Date("2026-06-17T02:15:00.000Z"),
    );

    expect(state.isTradingDay).toBe(false);
    expect(state.isOpen).toBe(false);
    expect(state.marketStateReason).toBe("calendar_unknown");
    expect(state.calendarStatus).toBe("calendar_unknown");
  });

  it("uses the latest confirmed prior trading close when today is missing from the calendar", async () => {
    const closeDate = await getRegularSessionCloseRefreshDate(
      "TW",
      {
        isTradingDay: vi.fn().mockResolvedValue(false),
        getTradingDates: vi.fn().mockResolvedValue(new Set(["2026-06-16"])),
      },
      new Date("2026-06-17T06:00:00.000Z"),
      10,
    );

    expect(closeDate).toBe("2026-06-16");
  });

  it("returns no eligible close when the calendar has no confirmed dates", async () => {
    const closeDate = await getRegularSessionCloseRefreshDate(
      "TW",
      {
        isTradingDay: vi.fn().mockResolvedValue(false),
        getTradingDates: vi.fn().mockResolvedValue(new Set()),
      },
      new Date("2026-06-17T06:00:00.000Z"),
      10,
    );

    expect(closeDate).toBeNull();
  });

  it("resolves the latest eligible close when today's close is not yet eligible", async () => {
    const tradingDays = new Set(["2026-06-12", "2026-06-15"]);
    const isTradingDay = vi.fn(async (_market: string, date: string) => tradingDays.has(date));

    const closeDate = await getRegularSessionCloseRefreshDate(
      "TW",
      { isTradingDay },
      new Date("2026-06-16T01:00:00.000Z"),
      10,
    );

    expect(closeDate).toBe("2026-06-15");
  });

  it("skips a prior trading close when the configured grace has not elapsed across an overnight gap", async () => {
    const tradingDays = new Set(["2026-06-12", "2026-06-15", "2026-06-16"]);
    const isTradingDay = vi.fn(async (_market: string, date: string) => tradingDays.has(date));

    const closeDate = await getRegularSessionCloseRefreshDate(
      "TW",
      { isTradingDay },
      new Date("2026-06-16T02:00:00.000Z"),
      1440,
    );

    expect(closeDate).toBe("2026-06-12");
  });

  it("resolves the prior trading close on weekends", async () => {
    const tradingDays = new Set(["2026-06-19"]);
    const closeDate = await getRegularSessionCloseRefreshDate(
      "US",
      { isTradingDay: vi.fn(async (_market: string, date: string) => tradingDays.has(date)) },
      new Date("2026-06-20T16:00:00.000Z"),
      10,
    );

    expect(closeDate).toBe("2026-06-19");
  });
});
