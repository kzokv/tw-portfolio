import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
  patchJson: vi.fn(),
  postJson: vi.fn(),
}));

import { getJson, patchJson } from "../../../lib/api";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendDailyHighlights,
  fetchDividendReviewEnrichment,
  fetchDividendReviewPrimary,
  fetchDividendLedgerReview,
  fetchDividendLedgerEntry,
  updateDividendStockReconciliation,
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
      tickers: ["2886", "3714"],
      sourceComposition: "pending" as const,
      cashStatus: "explained" as const,
      stockStatus: "variance" as const,
      sortBy: "varianceAmount" as const,
      sortOrder: "asc" as const,
      page: 2,
      limit: 25 as const,
    };
    await fetchDividendReviewPrimary(query, { signal });
    await fetchDividendReviewEnrichment(query, { signal });

    expect(getJson).toHaveBeenNthCalledWith(
      1,
      "/portfolio/dividends/review/primary?fromPaymentDate=2026-01-01&toPaymentDate=2026-12-31&ticker=2886&ticker=3714&cashStatus=explained&stockStatus=variance&sourceComposition=pending&sortBy=varianceAmount&sortOrder=asc&page=2&limit=25",
      { signal },
    );
    expect(getJson).toHaveBeenNthCalledWith(
      2,
      "/portfolio/dividends/review/enrichment?fromPaymentDate=2026-01-01&toPaymentDate=2026-12-31&ticker=2886&ticker=3714&cashStatus=explained&stockStatus=variance&sourceComposition=pending",
      { signal },
    );
  });

  it("preserves a legacy single ticker in enrichment queries", async () => {
    vi.mocked(getJson).mockResolvedValue({});

    await fetchDividendReviewEnrichment({ ticker: "2330" });

    expect(getJson).toHaveBeenCalledWith(
      "/portfolio/dividends/review/enrichment?ticker=2330",
      { signal: undefined },
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

  it("updates stock reconciliation with status, explanation, and optimistic version", async () => {
    vi.mocked(patchJson).mockResolvedValueOnce({ ledgerEntry: { id: "ledger-1", version: 4, stockReconciliationStatus: "explained" } });

    await expect(updateDividendStockReconciliation("ledger/1", {
      status: "explained",
      note: "Broker confirmed fractional settlement.",
      expectedVersion: 3,
    })).resolves.toMatchObject({ id: "ledger-1", version: 4, stockReconciliationStatus: "explained" });

    expect(patchJson).toHaveBeenCalledWith(
      "/portfolio/dividends/postings/ledger%2F1/stock-reconciliation",
      { status: "explained", note: "Broker confirmed fractional settlement.", expectedVersion: 3 },
    );
  });

  it("forwards an explicit null stock reconciliation note when the explanation is cleared", async () => {
    vi.mocked(patchJson).mockResolvedValueOnce({ ledgerEntry: { id: "ledger-1", version: 5, stockReconciliationStatus: "variance", stockReconciliationNote: null } });

    await expect(updateDividendStockReconciliation("ledger/1", {
      status: "variance",
      note: null,
      expectedVersion: 4,
    })).resolves.toMatchObject({ id: "ledger-1", version: 5, stockReconciliationStatus: "variance", stockReconciliationNote: null });

    expect(patchJson).toHaveBeenCalledWith(
      "/portfolio/dividends/postings/ledger%2F1/stock-reconciliation",
      { status: "variance", note: null, expectedVersion: 4 },
    );
  });
});
