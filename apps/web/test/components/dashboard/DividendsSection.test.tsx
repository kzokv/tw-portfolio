import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DividendsSection } from "../../../components/dashboard/DividendsSection";
import { getDictionary } from "../../../lib/i18n";

describe("DividendsSection", () => {
  it("renders ticker display names when present on upcoming dividend rows", () => {
    const html = renderToStaticMarkup(
      <DividendsSection
        upcoming={[{
          accountId: "acc-1",
          accountName: "Main",
          ticker: "2330",
          tickerName: "TSMC",
          exDividendDate: "2026-07-10",
          paymentDate: "2026-07-25",
          expectedAmount: 120,
          currency: "TWD",
          status: "expected",
        }]}
        recent={[]}
        dict={getDictionary("en")}
        locale="en"
      />,
    );

    expect(html).toContain("2330");
    expect(html).toContain("TSMC");
    expect(html).toContain("Main");
  });
});
