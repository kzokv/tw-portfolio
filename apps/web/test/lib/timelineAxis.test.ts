import { describe, expect, it } from "vitest";

import { buildTimelineAxis, resolveAutoTimelineMode } from "../../lib/timelineAxis";

describe("timelineAxis", () => {
  it("resolves automatic timeline modes from the selected range length", () => {
    expect(resolveAutoTimelineMode("2026-01-01", "2026-01-31")).toBe("day");
    expect(resolveAutoTimelineMode("2026-01-01", "2026-06-01")).toBe("week");
    expect(resolveAutoTimelineMode("2026-01-01", "2027-12-31")).toBe("month");
    expect(resolveAutoTimelineMode("2020-01-01", "2026-12-31")).toBe("year");
  });

  it("uses UTC domains and source snapshot dates for ticks", () => {
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
});
