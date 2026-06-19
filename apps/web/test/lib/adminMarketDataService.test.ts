import { describe, expect, it, vi } from "vitest";
import { previewMarketCalendarImport } from "../../lib/adminMarketDataService";
import { postJson } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getJson: vi.fn(),
  patchJson: vi.fn(),
  postJson: vi.fn(),
}));

const postJsonMock = vi.mocked(postJson);

describe("adminMarketDataService", () => {
  it("maps calendar preview exception diff fields into preview rows and counts", async () => {
    postJsonMock.mockResolvedValueOnce({
      marketCode: "TW",
      calendarYear: 2026,
      source: { label: "TWSE" },
      sourceType: "official_source",
      sourceUrl: "https://www.twse.com.tw/holidaySchedule/holidaySchedule",
      retrievedAt: "2026-06-19T00:00:00.000Z",
      exceptionCount: 3,
      annualCounts: {
        tradingDayCount: 240,
        nonTradingDayCount: 125,
        weekdayClosedCount: 3,
        weekendOpenCount: 0,
      },
      replaceConfirmedRequired: false,
      warnings: ["Review holiday source"],
      diff: {
        addedExceptions: ["2026-01-01"],
        changedExceptions: ["2026-02-16"],
        removedExceptions: ["2026-12-31"],
      },
      previewToken: "preview-1",
    });

    const result = await previewMarketCalendarImport("TW", {
      sourceId: "twse",
      normalizedPayload: "{}",
    });

    expect(result.preview).toMatchObject({
      added: 1,
      changed: 1,
      removed: 1,
      previewToken: "preview-1",
      warnings: ["Review holiday source"],
      confirmable: true,
      replaceConfirmedRequired: false,
    });
    expect(result.preview.rows).toEqual([
      { date: "2026-01-01", session: "added", evidence: "TWSE" },
      { date: "2026-02-16", session: "changed", evidence: "TWSE" },
      { date: "2026-12-31", session: "removed", evidence: "TWSE" },
    ]);
  });
});
