import { describe, expect, it } from "vitest";
import { getDictionary } from "../../../lib/i18n";
import {
  buildTickerShareSummaries,
  dividendEventTypeLabel,
  formatDividendRatio,
  formatDividendShares,
  stockRatioStateLabel,
} from "../../../features/dividends/presentation";

const dict = getDictionary("en");

describe("dividend presentation helpers", () => {
  it("labels cash, stock, and mixed dividend event types", () => {
    expect(dividendEventTypeLabel(dict, "CASH")).toBe(dict.dividends.eventType.cash);
    expect(dividendEventTypeLabel(dict, "STOCK")).toBe(dict.dividends.eventType.stock);
    expect(dividendEventTypeLabel(dict, "CASH_AND_STOCK")).toBe(dict.dividends.eventType.cashAndStock);
  });

  it("marks unresolved stock ratios when the ratio is missing or needs action", () => {
    expect(stockRatioStateLabel(dict, "unresolved")).toBe(dict.dividends.stockRatioState.unresolved);
    expect(stockRatioStateLabel(dict, "authoritative", "needs_action")).toBe(dict.dividends.stockRatioState.unresolved);
    expect(stockRatioStateLabel(dict, "derived_non_authoritative")).toBe(dict.dividends.stockRatioState.derived);
    expect(stockRatioStateLabel(dict, "authoritative")).toBe(dict.dividends.stockRatioState.authoritative);
  });

  it("formats stock ratios and share counts for display", () => {
    expect(formatDividendRatio(0.025, "en")).toBe("0.025");
    expect(formatDividendShares(12.5, "en", dict)).toBe(`12.5 ${dict.dividends.sharesUnit}`);
  });

  it("groups per-ticker share summaries without summing different tickers together", () => {
    expect(buildTickerShareSummaries([
      { marketCode: "TW", ticker: "2330", tickerName: "TSMC", quantity: 10 },
      { marketCode: "TW", ticker: "2330", tickerName: "TSMC", quantity: 5 },
      { marketCode: "US", ticker: "MSFT", tickerName: "Microsoft", quantity: 2 },
      { marketCode: "AU", ticker: "BHP", quantity: 7 },
    ], "en", dict, 2)).toEqual({
      count: 3,
      items: [
        `2330 TSMC: ${formatDividendShares(15, "en", dict)}`,
        `BHP: ${formatDividendShares(7, "en", dict)}`,
      ],
      overflowCount: 1,
    });
  });
});
