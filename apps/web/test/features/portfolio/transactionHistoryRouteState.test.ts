import { describe, expect, it } from "vitest";
import {
  parseTransactionHistoryRouteState,
  transactionHistoryRouteStateToSearchParams,
} from "../../../features/portfolio/transactionHistoryRouteState";

describe("transactionHistoryRouteState", () => {
  it("normalizes BUY + realized queries to SELL", () => {
    const state = parseTransactionHistoryRouteState(new URLSearchParams("type=BUY&pnl=realized"));

    expect(state.type).toBe("SELL");
    expect(state.pnl).toBe("realized");
  });

  it("normalizes default type + realized queries to explicit SELL", () => {
    const state = parseTransactionHistoryRouteState(new URLSearchParams("pnl=realized"));

    expect(state.type).toBe("SELL");
    expect(transactionHistoryRouteStateToSearchParams(state).toString()).toBe("type=SELL&pnl=realized");
  });

  it("serializes only non-default params and strips unsafe returnTo", () => {
    const state = parseTransactionHistoryRouteState({
      marketCode: "US",
      returnTo: "https://evil.example",
      ticker: " msft ",
    });

    expect(transactionHistoryRouteStateToSearchParams(state).toString()).toBe("marketCode=US&ticker=MSFT");
  });
});
