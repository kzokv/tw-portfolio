import { describe, expect, it, vi } from "vitest";
import {
  calendarMonthFromSearchParams,
  calendarQueryFromSearchParams,
  monthQuery,
  searchParamsToReviewQuery,
} from "../../../components/dividends/dividendsPageQuery";

describe("dividendsPageQuery", () => {
  it("accepts a valid month query value", () => {
    expect(calendarMonthFromSearchParams({ month: "2026-07" })).toBe("2026-07");
    expect(calendarQueryFromSearchParams({ month: "2026-07" })).toEqual({
      fromPaymentDate: "2026-07-01",
      toPaymentDate: "2026-07-31",
      limit: 500,
    });
  });

  it("falls back to the current UTC month when the month query is invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T09:00:00.000Z"));

    expect(calendarMonthFromSearchParams({ month: "2026-13" })).toBe("2026-07");
    expect(calendarMonthFromSearchParams({ month: "bad-input" })).toBe("2026-07");
    expect(calendarMonthFromSearchParams({})).toBe("2026-07");

    vi.useRealTimers();
  });

  it("builds inclusive month boundaries from a month key", () => {
    expect(monthQuery("2026-02")).toEqual({
      fromPaymentDate: "2026-02-01",
      toPaymentDate: "2026-02-28",
      limit: 500,
    });
  });

  it("maps needs-reconciliation status into the review query", () => {
    const query = searchParamsToReviewQuery(new URLSearchParams([
      ["status", "needsReconciliation"],
      ["ticker", "2330"],
      ["marketCode", "TW"],
      ["accountId", "acc-1"],
      ["sortBy", "ticker"],
      ["sortOrder", "asc"],
      ["page", "2"],
      ["limit", "50"],
    ]));

    expect(query).toMatchObject({
      tickers: ["2330"],
      marketCode: "TW",
      accountId: "acc-1",
      reconciliationStatus: "open",
      excludeExpected: true,
      sortBy: "ticker",
      sortOrder: "asc",
      page: 2,
      limit: 50,
    });
  });

  it("preserves repeated ticker parameters while remaining compatible with one ticker", () => {
    const repeated = searchParamsToReviewQuery(new URLSearchParams([
      ["ticker", "3714"],
      ["ticker", "2886"],
      ["ticker", "3714"],
    ]));
    const single = searchParamsToReviewQuery(new URLSearchParams([["ticker", "2330"]]));

    expect(repeated.tickers).toEqual(["3714", "2886"]);
    expect(single.tickers).toEqual(["2330"]);
  });

  it("normalizes ticker parameters before deduplication and eligibility checks", () => {
    const query = searchParamsToReviewQuery(new URLSearchParams([
      ["ticker", " tsmc "],
      ["ticker", "TSMC"],
      ["ticker", "2886"],
    ]));

    expect(query.tickers).toEqual(["TSMC", "2886"]);
  });

  it("falls back to the default review page size when the limit is unsupported", () => {
    const query = searchParamsToReviewQuery(new URLSearchParams([
      ["limit", "13"],
    ]));

    expect(query.limit).toBe(10);
  });

  it("maps legacy needs-review status into the review query", () => {
    const query = searchParamsToReviewQuery(new URLSearchParams([
      ["status", "needs-review"],
    ]));

    expect(query).toMatchObject({
      reconciliationStatus: "open",
      excludeExpected: true,
    });
  });

  it("keeps separate cash and stock review statuses in the query", () => {
    const query = searchParamsToReviewQuery(new URLSearchParams([
      ["cashStatus", "explained"],
      ["stockStatus", "needs_calculation"],
    ]));

    expect(query.cashStatus).toBe("explained");
    expect(query.stockStatus).toBe("needs_calculation");
  });

  it("omits empty date filters when the selected preset resolves to no range", () => {
    const query = searchParamsToReviewQuery(new URLSearchParams([
      ["preset", "unspecified"],
      ["status", "all"],
    ]));

    expect(query.fromPaymentDate).toBeUndefined();
    expect(query.toPaymentDate).toBeUndefined();
    expect(query.postingStatus).toBeUndefined();
    expect(query.reconciliationStatus).toBeUndefined();
    expect(query.sortBy).toBe("paymentDate");
    expect(query.sortOrder).toBe("desc");
    expect(query.page).toBe(1);
  });

  it("keeps explicit date filters for the yearRange preset", () => {
    const query = searchParamsToReviewQuery(new URLSearchParams([
      ["preset", "yearRange"],
      ["fromPaymentDate", "2024-01-01"],
      ["toPaymentDate", "2026-12-31"],
    ]));

    expect(query.fromPaymentDate).toBe("2024-01-01");
    expect(query.toPaymentDate).toBe("2026-12-31");
  });
});
