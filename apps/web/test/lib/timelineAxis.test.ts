import { describe, expect, it } from "vitest";

import { buildTimelineAxis, resolveAutoTimelineMode } from "../../lib/timelineAxis";

describe("timelineAxis", () => {
  it("resolves automatic timeline modes from the selected range length", () => {
    expect(resolveAutoTimelineMode("2026-01-01", "2026-01-31")).toBe("day");
    expect(resolveAutoTimelineMode("2026-01-01", "2026-06-01")).toBe("week");
    expect(resolveAutoTimelineMode("2026-01-01", "2027-12-31")).toBe("month");
    expect(resolveAutoTimelineMode("2020-01-01", "2026-12-31")).toBe("year");
  });

  it("uses UTC domains and calendar boundaries for ticks", () => {
    const axis = buildTimelineAxis({
      endDate: "2026-03-01",
      locale: "en",
      mode: "month",
      pointDates: ["2026-01-31", "2026-02-01", "2026-02-15", "2026-03-01"],
      startDate: "2026-01-31",
    });

    expect(axis.domain).toEqual([Date.UTC(2026, 0, 31), Date.UTC(2026, 2, 1)]);
    expect(axis.ticks).toEqual([Date.UTC(2026, 0, 31), Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)]);
    expect(axis.tickFormatter(Date.UTC(2026, 1, 1))).toBe("Feb 26");
  });

  it("keeps sparse snapshot ticks aligned with the requested calendar window", () => {
    const axis = buildTimelineAxis({
      endDate: "2026-06-10",
      locale: "en",
      mode: "week",
      pointDates: ["2026-05-11", "2026-05-29", "2026-06-10"],
      startDate: "2026-03-10",
    });

    expect(axis.domain).toEqual([Date.UTC(2026, 2, 10), Date.UTC(2026, 5, 10)]);
    expect(axis.ticks).toEqual([
      Date.UTC(2026, 2, 10),
      Date.UTC(2026, 2, 23),
      Date.UTC(2026, 3, 6),
      Date.UTC(2026, 3, 20),
      Date.UTC(2026, 4, 4),
      Date.UTC(2026, 4, 18),
      Date.UTC(2026, 5, 1),
      Date.UTC(2026, 5, 10),
    ]);
    expect(axis.tickFormatter(Date.UTC(2026, 2, 23))).toBe("Mar 23");
  });
});
