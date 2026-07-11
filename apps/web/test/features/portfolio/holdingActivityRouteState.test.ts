import { describe, expect, it } from "vitest";
import {
  mergeHoldingActivityRouteStateIntoSearchParams,
  parseHoldingActivityRouteState,
} from "../../../features/portfolio/holdingActivityRouteState";

describe("holding activity route state", () => {
  it("preserves independent pages for the matching holding scope", () => {
    const state = parseHoldingActivityRouteState(new URLSearchParams(
      "holdingActivityTicker=2330&holdingActivityMarketCode=TW&holdingActivityAccountId=acc-1&holdingActivityPositionActionsPage=3&holdingActivityPositionActionsLimit=25&holdingActivityPostedPage=4&holdingActivityPostedLimit=50",
    ), { ticker: "2330", marketCode: "TW", accountId: "acc-1" });

    expect(state).toMatchObject({
      positionActionsPage: 3,
      positionActionsLimit: 25,
      postedPage: 4,
      postedLimit: 50,
    });
  });

  it.each([
    { ticker: "2317", marketCode: "TW", accountId: "acc-1" },
    { ticker: "2330", marketCode: "US", accountId: "acc-1" },
    { ticker: "2330", marketCode: "TW", accountId: "acc-2" },
  ])("resets both pages when the holding scope changes", (scope) => {
    const state = parseHoldingActivityRouteState(new URLSearchParams(
      "holdingActivityTicker=2330&holdingActivityMarketCode=TW&holdingActivityAccountId=acc-1&holdingActivityPositionActionsPage=3&holdingActivityPositionActionsLimit=25&holdingActivityPostedPage=4&holdingActivityPostedLimit=50",
    ), scope);

    expect(state.positionActionsPage).toBe(1);
    expect(state.postedPage).toBe(1);
  });

  it("writes page-one state when either independent limit changes", () => {
    const params = mergeHoldingActivityRouteStateIntoSearchParams(new URLSearchParams("tab=portfolio"), {
      ticker: "2330",
      marketCode: "TW",
      positionActionsPage: 1,
      positionActionsLimit: 50,
      postedPage: 1,
      postedLimit: 25,
    });

    expect(params.get("holdingActivityPositionActionsPage")).toBe("1");
    expect(params.get("holdingActivityPositionActionsLimit")).toBe("50");
    expect(params.get("holdingActivityPostedPage")).toBe("1");
    expect(params.get("holdingActivityPostedLimit")).toBe("25");
  });
});
