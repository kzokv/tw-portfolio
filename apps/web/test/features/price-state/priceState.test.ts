import { describe, expect, it } from "vitest";
import { isNonCurrentPrice, priceStateSortRank } from "../../../features/price-state/priceState";
import { testPriceState } from "../../fixtures/priceState";

describe("priceState freshness helpers", () => {
  it("treats pending today close as non-current even when rendered as a closed-market chip", () => {
    const pendingTodayClose = {
      priceState: testPriceState({
        basis: "pending_today_close",
        chipState: "closed",
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
});
