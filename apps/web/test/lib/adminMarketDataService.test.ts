import { describe, expect, it, vi } from "vitest";
import {
  bulkUpdateMarketUnresolvedState,
  fetchMarketUnresolved,
  previewMarketCalendarImport,
  updateMarketUnresolvedState,
} from "../../lib/adminMarketDataService";
import { getJson, postJson } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  getJson: vi.fn(),
  patchJson: vi.fn(),
  postJson: vi.fn(),
}));

const getJsonMock = vi.mocked(getJson);
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

  it("builds market unresolved query strings through the web-local contract", async () => {
    getJsonMock.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 25 });

    await fetchMarketUnresolved("AU", {
      page: 2,
      limit: 50,
      providerId: "yahoo-finance-au",
      state: "ignored",
      errorCode: "provider_symbol_unresolved",
      search: "ABP",
      sort: "updated_desc",
    });

    expect(getJsonMock).toHaveBeenCalledWith(
      "/admin/market-data/AU/unresolved?page=2&limit=50&providerId=yahoo-finance-au&state=ignored&errorCode=provider_symbol_unresolved&search=ABP&sort=updated_desc",
    );
  });

  it("posts market-scoped unresolved lifecycle updates", async () => {
    postJsonMock.mockResolvedValueOnce({ item: { sourceSymbol: "ABP", state: "ignored" } });
    await updateMarketUnresolvedState("AU", {
      providerId: "yahoo-finance-au",
      errorCode: "provider_symbol_unresolved",
      sourceSymbol: "ABP",
      state: "ignored",
    });

    expect(postJsonMock).toHaveBeenCalledWith("/admin/market-data/AU/unresolved/state", {
      providerId: "yahoo-finance-au",
      errorCode: "provider_symbol_unresolved",
      sourceSymbol: "ABP",
      state: "ignored",
    });

    postJsonMock.mockResolvedValueOnce({ updatedCount: 2 });
    await bulkUpdateMarketUnresolvedState("AU", {
      state: "unsupported",
      acknowledged: true,
      scope: {
        type: "selected_items",
        items: [
          { providerId: "yahoo-finance-au", marketCode: "AU", errorCode: "provider_symbol_unresolved", sourceSymbol: "ABP" },
          { providerId: "yahoo-finance-au", marketCode: "AU", errorCode: "provider_symbol_unresolved", sourceSymbol: "CDX" },
        ],
      },
    });

    expect(postJsonMock).toHaveBeenCalledWith("/admin/market-data/AU/unresolved/state/bulk", {
      state: "unsupported",
      acknowledged: true,
      scope: {
        type: "selected_items",
        items: [
          { providerId: "yahoo-finance-au", marketCode: "AU", errorCode: "provider_symbol_unresolved", sourceSymbol: "ABP" },
          { providerId: "yahoo-finance-au", marketCode: "AU", errorCode: "provider_symbol_unresolved", sourceSymbol: "CDX" },
        ],
      },
    });
  });
});
