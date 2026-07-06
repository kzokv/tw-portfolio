import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
  patchJson: vi.fn(),
  postJson: vi.fn(),
}));

import { getJson } from "../../../lib/api";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendLedgerReview,
} from "../../../features/dividends/services/dividendService";

describe("dividendService calendar snapshot", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockResolvedValue({
      events: [{ id: "event-1", ticker: "2330" }],
      ledgerEntries: [{ id: "ledger-1", ticker: "2330" }],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads the combined calendar endpoint", async () => {
    const snapshot = await fetchDividendCalendarSnapshot({
      fromPaymentDate: "2026-07-01",
      toPaymentDate: "2026-07-31",
      accountId: "acc-1",
      marketCode: "TW",
      limit: 50,
    });

    expect(getJson).toHaveBeenCalledWith(
      "/portfolio/dividends/calendar?limit=50&fromPaymentDate=2026-07-01&toPaymentDate=2026-07-31&accountId=acc-1&marketCode=TW",
    );
    expect(snapshot).toEqual({
      events: [{ id: "event-1", ticker: "2330" }],
      ledgerEntries: [{ id: "ledger-1", ticker: "2330" }],
    });
  });

  it("sends marketCode through the review endpoint query", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({
      reviewRows: [],
      total: 0,
      aggregates: {},
    });

    await fetchDividendLedgerReview({
      ticker: "BHP",
      marketCode: "AU",
      page: 1,
      limit: 25,
    });

    expect(getJson).toHaveBeenCalledWith(
      "/portfolio/dividends/review?ticker=BHP&marketCode=AU&page=1&limit=25",
    );
  });
});
