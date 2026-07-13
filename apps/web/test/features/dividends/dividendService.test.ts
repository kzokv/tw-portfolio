import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
  patchJson: vi.fn(),
  postJson: vi.fn(),
}));

import { getJson } from "../../../lib/api";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendDailyHighlights,
  fetchDividendReviewEnrichment,
  fetchDividendReviewPrimary,
  fetchDividendLedgerReview,
  fetchDividendLedgerEntry,
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
    const signal = new AbortController().signal;
    const snapshot = await fetchDividendCalendarSnapshot({
      fromPaymentDate: "2026-07-01",
      toPaymentDate: "2026-07-31",
      accountId: "acc-1",
      marketCode: "TW",
      limit: 50,
    }, { signal });

    expect(getJson).toHaveBeenCalledWith(
      "/portfolio/dividends/calendar?limit=50&fromPaymentDate=2026-07-01&toPaymentDate=2026-07-31&accountId=acc-1&marketCode=TW",
      { signal },
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

  it("reads the dedicated daily highlights endpoint", async () => {
    const signal = new AbortController().signal;
    vi.mocked(getJson).mockResolvedValueOnce({
      payingToday: [{ id: "daily-1" }],
      exDividendToday: [{ id: "daily-2" }],
    });

    const payload = await fetchDividendDailyHighlights({ signal });

    expect(getJson).toHaveBeenCalledWith("/portfolio/dividends/daily-highlights", { signal });
    expect(payload).toEqual({
      payingToday: [{ id: "daily-1" }],
      exDividendToday: [{ id: "daily-2" }],
    });
  });

  it("splits primary and enrichment queries, forwards abort signals, and keeps sort/page out of enrichment", async () => {
    const signal = new AbortController().signal;
    vi.mocked(getJson).mockResolvedValue({ reviewRows: [], total: 0, years: [], accounts: [] });

    const query = {
      fromPaymentDate: "2026-01-01",
      toPaymentDate: "2026-12-31",
      sourceComposition: "pending" as const,
      sortBy: "varianceAmount" as const,
      sortOrder: "asc" as const,
      page: 2,
      limit: 25 as const,
    };
    await fetchDividendReviewPrimary(query, { signal });
    await fetchDividendReviewEnrichment(query, { signal });

    expect(getJson).toHaveBeenNthCalledWith(
      1,
      "/portfolio/dividends/review/primary?fromPaymentDate=2026-01-01&toPaymentDate=2026-12-31&sourceComposition=pending&sortBy=varianceAmount&sortOrder=asc&page=2&limit=25",
      { signal },
    );
    expect(getJson).toHaveBeenNthCalledWith(
      2,
      "/portfolio/dividends/review/enrichment?fromPaymentDate=2026-01-01&toPaymentDate=2026-12-31&sourceComposition=pending",
      { signal },
    );
  });

  it("forwards abort signals when lazily loading a ledger row detail", async () => {
    const signal = new AbortController().signal;
    vi.mocked(getJson).mockResolvedValue({ id: "ledger-1" });

    await fetchDividendLedgerEntry("ledger/1", { signal });

    expect(getJson).toHaveBeenCalledWith(
      "/portfolio/dividends/postings/ledger%2F1",
      { signal },
    );
  });
});
