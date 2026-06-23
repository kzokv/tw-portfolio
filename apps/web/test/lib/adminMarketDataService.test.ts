import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  bulkUpdateProviderUnresolvedState,
  fetchOperationLogs,
  previewMarketCalendarImport,
  reverifyProviderMapping,
  revertProviderMapping,
} from "../../lib/adminMarketDataService";
import { ApiError, getJson, postJson } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly status: number, public readonly code?: string) {
      super(message);
      this.name = "ApiError";
    }
  },
  getJson: vi.fn(),
  patchJson: vi.fn(),
  postJson: vi.fn(),
}));

const getJsonMock = vi.mocked(getJson);
const postJsonMock = vi.mocked(postJson);

describe("adminMarketDataService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("maps bulk unresolved responses that return result.succeeded instead of updatedCount", async () => {
    postJsonMock.mockResolvedValueOnce({
      operation: { id: "OP-1" },
      result: { status: "completed", succeeded: 3, failed: 1 },
    });

    const result = await bulkUpdateProviderUnresolvedState({
      providerId: "yahoo-finance-kr",
      state: "ignored",
      scope: {
        type: "filter",
        marketCode: "KR",
        errorCode: "yahoo_finance_kr_symbol_unresolved",
        state: "active",
      },
      acknowledged: true,
    });

    expect(result.updatedCount).toBe(3);
  });

  it("omits resolvedSymbol from mapping reverify and revert payloads", async () => {
    postJsonMock.mockResolvedValue({ operation: { id: "OP-2" } });

    await reverifyProviderMapping({
      providerId: "yahoo-finance-kr",
      mapping: { marketCode: "KR", sourceSymbol: "005930", resolvedSymbol: "005930.KS" },
      resolverMode: "quote_first",
    });
    await revertProviderMapping({
      providerId: "yahoo-finance-kr",
      mapping: { marketCode: "KR", sourceSymbol: "005930", resolvedSymbol: "005930.KS" },
      typedConfirmation: "REVERT 005930",
    });

    expect(postJsonMock).toHaveBeenNthCalledWith(
      1,
      "/admin/providers/yahoo-finance-kr/mappings/reverify",
      { marketCode: "KR", sourceSymbol: "005930", resolverMode: "quote_first" },
    );
    expect(postJsonMock).toHaveBeenNthCalledWith(
      2,
      "/admin/providers/yahoo-finance-kr/mappings/revert",
      { marketCode: "KR", sourceSymbol: "005930", typedConfirmation: "REVERT 005930" },
    );
  });

  it("falls back to provider logs when the normalized market-data logs endpoint is unavailable", async () => {
    getJsonMock
      .mockRejectedValueOnce(new ApiError("missing", 404, "missing"))
      .mockResolvedValueOnce({
        items: [{ id: "1", occurredAt: "2026-06-23T00:00:00.000Z", phase: "running", message: "legacy log", operationId: "OP-1" }],
        total: 1,
        page: 1,
        limit: 10,
      });

    const result = await fetchOperationLogs({
      marketCode: "KR",
      providerId: "yahoo-finance-kr",
      operationId: "OP-1",
      page: 1,
      limit: 10,
    });

    expect(getJsonMock).toHaveBeenNthCalledWith(1, "/admin/market-data/KR/operations/OP-1/logs?page=1&limit=10");
    expect(getJsonMock).toHaveBeenNthCalledWith(2, "/admin/providers/yahoo-finance-kr/logs?operationId=OP-1&page=1&limit=10");
    expect(result.items[0]).toMatchObject({ message: "legacy log", level: "running" });
  });
});
