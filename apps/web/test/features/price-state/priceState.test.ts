import { describe, expect, it } from "vitest";
import { getPriceStateToneClassName, hydrateDashboardMarketStates, isNonCurrentPrice, priceStateSortRank, type DashboardMarketStateLike } from "../../../features/price-state/priceState";
import { testMarketState, testPriceState } from "../../fixtures/priceState";

describe("priceState freshness helpers", () => {
  it("treats pending today close as non-current even when rendered as a closed-market chip", () => {
    const pendingTodayClose = {
      priceState: testPriceState({
        basis: "pending_today_close",
        chipState: "closed_pending",
        marketState: "closed",
      }),
    };

    expect(isNonCurrentPrice(pendingTodayClose)).toBe(true);
    expect(priceStateSortRank(pendingTodayClose)).toBeGreaterThan(priceStateSortRank({
      priceState: testPriceState({ basis: "today_close", chipState: "closed" }),
    }));
  });

  it("keeps fresh intraday and current close states out of non-current filters", () => {
    expect(isNonCurrentPrice({
      priceState: testPriceState({ basis: "intraday", chipState: "open_fresh", marketState: "open" }),
    })).toBe(false);
    expect(isNonCurrentPrice({
      priceState: testPriceState({ basis: "today_close", chipState: "closed", marketState: "closed" }),
    })).toBe(false);
  });

  it("maps chip states to the scoped freshness tones", () => {
    expect(getPriceStateToneClassName(testPriceState({ chipState: "open_fresh" }))).toContain("success");
    expect(getPriceStateToneClassName(testPriceState({ chipState: "open_delayed" }))).toBe("bg-warning");
    expect(getPriceStateToneClassName(testPriceState({ chipState: "open_previous_close" }))).toBe("bg-warning");
    expect(getPriceStateToneClassName(testPriceState({ basis: "pending_today_close", chipState: "closed_pending" }))).toBe("bg-warning");
    expect(getPriceStateToneClassName(testPriceState({ chipState: "closed" }))).toBe("bg-slate-400");
    expect(getPriceStateToneClassName(testPriceState({ chipState: "missing", basis: "missing" }))).toBe("bg-destructive");
  });

  it("hydrates dashboard market-state payloads with derived holding counts and calendar warnings", () => {
    const states = hydrateDashboardMarketStates(
      [{
        ...testMarketState({
          marketCode: "TW",
          marketState: "open",
          marketTimeZone: "Asia/Taipei",
        }),
        heldCount: 0,
        openCount: 0,
      } satisfies DashboardMarketStateLike],
      [
        {
          marketCode: "TW",
          priceState: testPriceState({
            marketState: "closed",
            marketStateReason: "calendar_unknown",
            calendarStatus: "calendar_unknown",
            marketLocalDate: "2026-06-19",
          }),
        },
        {
          marketCode: "TW",
          priceState: testPriceState({ marketState: "open" }),
        },
      ],
    );

    expect(states).toEqual([expect.objectContaining({
      marketCode: "TW",
      marketState: "open",
      heldCount: 2,
      openCount: 1,
      calendarStatus: "calendar_unknown",
      marketStateReason: "calendar_unknown",
      marketLocalDate: "2026-06-19",
      marketTimeZone: "Asia/Taipei",
    })]);
  });
});
