import { describe, expect, it, vi } from "vitest";
import { getRegularSessionState } from "../../../src/services/market-data/marketRegularSession.js";

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

  it("marks KR as closed on non-trading days even during regular local hours", async () => {
    const state = await getRegularSessionState(
      "KR",
      { isTradingDay: vi.fn().mockResolvedValue(false) },
      new Date("2026-06-17T01:30:00.000Z"),
    );

    expect(state.isTradingDay).toBe(false);
    expect(state.isOpen).toBe(false);
  });
});
