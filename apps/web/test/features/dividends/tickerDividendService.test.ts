import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", () => ({ getJson: vi.fn() }));

import { getJson } from "../../../lib/api";
import {
  fetchTickerOpenReconciliation,
  fetchTickerPostedDividendHistory,
  fetchTickerUpcomingDividends,
} from "../../../features/dividends/services/tickerDividendService";

describe("tickerDividendService", () => {
  afterEach(() => vi.clearAllMocks());

  it("uses the dedicated upcoming endpoint with ticker scope", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({ upcomingDividends: { page: 1, limit: 50, total: 0, items: [] } });
    const signal = new AbortController().signal;
    await fetchTickerUpcomingDividends("2330", { accountId: "acc-1", marketCode: "TW", page: 1, limit: 50 }, { signal });
    expect(getJson).toHaveBeenCalledWith("/tickers/2330/dividends/upcoming?accountId=acc-1&marketCode=TW&page=1&limit=50", { signal });
  });

  it("uses the dedicated open-reconciliation endpoint independently", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({ openReconciliation: { page: 1, limit: 50, total: 1, items: [{ dividendLedgerEntryId: "open-only" }] } });
    const result = await fetchTickerOpenReconciliation("2330", { accountIds: ["acc-1", "acc-2"], page: 1, limit: 50 });
    expect(getJson).toHaveBeenCalledWith("/tickers/2330/dividends/open-reconciliation?accountIds=acc-1%2Cacc-2&page=1&limit=50", { signal: undefined });
    expect(result.items[0]?.dividendLedgerEntryId).toBe("open-only");
  });

  it("passes server page and limit to posted history", async () => {
    vi.mocked(getJson).mockResolvedValueOnce({ postedHistory: { page: 3, limit: 25, total: 70, items: [] } });
    const result = await fetchTickerPostedDividendHistory("BRK/B", { marketCode: "US", page: 3, limit: 25 });
    expect(getJson).toHaveBeenCalledWith("/tickers/BRK%2FB/dividends/posted-history?marketCode=US&page=3&limit=25", { signal: undefined });
    expect(result).toMatchObject({ page: 3, limit: 25, total: 70 });
  });
});
