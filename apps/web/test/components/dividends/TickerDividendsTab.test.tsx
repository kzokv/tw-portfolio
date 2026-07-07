import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TickerDividendsTab } from "../../../components/dividends/TickerDividendsTab";
import { getDictionary } from "../../../lib/i18n";

const dict = getDictionary("en");

describe("TickerDividendsTab", () => {
  it("includes row-specific date bounds in ticker Review links", () => {
    const html = renderToStaticMarkup(
      <TickerDividendsTab
        dict={dict}
        locale="en"
        marketCode="TW"
        ticker="2330"
        tickerName="TSMC"
        dividends={{
          upcomingCount: 1,
          nextPaymentDate: "2027-03-15",
          lastPostedDate: "2024-07-12",
          openReconciliationCount: 1,
          upcoming: [{
            accountId: "acc-1",
            accountName: "Main",
            ticker: "2330",
            tickerName: "TSMC",
            marketCode: "TW",
            exDividendDate: "2027-02-20",
            paymentDate: "2027-03-15",
            expectedAmount: 120,
            currency: "TWD",
            status: "declared",
          }],
          recent: [{
            accountId: "acc-1",
            accountName: "Main",
            ticker: "2330",
            tickerName: "TSMC",
            marketCode: "TW",
            dividendLedgerEntryId: "ledger-old",
            paymentDate: "2024-07-12",
            postedAt: "2026-01-02T12:00:00.000Z",
            netAmount: 96,
            grossAmount: 120,
            deductionAmount: 24,
            currency: "TWD",
            sourceSummary: "Cash dividend",
            reconciliationStatus: "open",
            status: "unreconciled",
          }],
        }}
        onMarkMatched={() => {}}
        pendingLedgerEntryId={null}
        canWriteDividends
      />,
    );

    expect(html).toContain("fromPaymentDate=2027-01-01&amp;toPaymentDate=2027-12-31");
    expect(html).toContain("fromPaymentDate=2024-01-01&amp;toPaymentDate=2024-12-31");
  });

  it("shows a TBD summary instead of no-upcoming copy when upcoming rows have no payment date", () => {
    const html = renderToStaticMarkup(
      <TickerDividendsTab
        dict={dict}
        locale="en"
        marketCode="TW"
        ticker="2330"
        tickerName="TSMC"
        dividends={{
          upcomingCount: 1,
          nextPaymentDate: null,
          lastPostedDate: null,
          openReconciliationCount: 0,
          upcoming: [{
            accountId: "acc-1",
            accountName: "Main",
            ticker: "2330",
            tickerName: "TSMC",
            marketCode: "TW",
            exDividendDate: "2027-02-20",
            paymentDate: null,
            expectedAmount: 120,
            currency: "TWD",
            status: "declared",
          }],
          recent: [],
        }}
        onMarkMatched={() => {}}
        pendingLedgerEntryId={null}
        canWriteDividends
      />,
    );

    expect(html).toContain(dict.dividends.paymentDateTbdSection);
    expect(html).not.toContain(dict.dividends.ticker.summary.noUpcoming);
  });

  it("hides Mark matched actions when dividend writes are disabled", () => {
    const html = renderToStaticMarkup(
      <TickerDividendsTab
        dict={dict}
        locale="en"
        marketCode="TW"
        ticker="2330"
        tickerName="TSMC"
        dividends={{
          upcomingCount: 0,
          nextPaymentDate: null,
          lastPostedDate: "2024-07-12",
          openReconciliationCount: 1,
          upcoming: [],
          recent: [{
            accountId: "acc-1",
            accountName: "Main",
            ticker: "2330",
            tickerName: "TSMC",
            marketCode: "TW",
            dividendLedgerEntryId: "ledger-readonly",
            paymentDate: "2024-07-12",
            postedAt: "2026-01-02T12:00:00.000Z",
            netAmount: 96,
            grossAmount: 120,
            deductionAmount: 24,
            currency: "TWD",
            sourceSummary: "Cash dividend",
            reconciliationStatus: "open",
            status: "unreconciled",
          }],
        }}
        onMarkMatched={() => {}}
        pendingLedgerEntryId={null}
        canWriteDividends={false}
      />,
    );

    expect(html).not.toContain("ticker-dividends-mark-matched-ledger-readonly");
    expect(html).not.toContain("ticker-reconciliation-mark-matched-ledger-readonly");
    expect(html).toContain("ticker-posted-dividend-review-0");
    expect(html).toContain("ticker-open-reconciliation-review-0");
  });
});
