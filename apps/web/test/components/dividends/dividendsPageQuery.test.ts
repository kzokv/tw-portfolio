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
    ]));

    expect(query).toMatchObject({
      ticker: "2330",
      marketCode: "TW",
      accountId: "acc-1",
      postingStatus: "posted",
      reconciliationStatus: "open",
      sortBy: "ticker",
      sortOrder: "asc",
      page: 2,
      limit: 25,
    });
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
});
