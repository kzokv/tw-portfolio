import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import PublicShareNotFound from "../../../app/share/[token]/not-found";
import PublicSharePage from "../../../app/share/[token]/page";

vi.mock("../../../components/layout/ThemeToggle", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle-mock">theme toggle</div>,
}));

const headersMock = vi.mocked(headers);
const notFoundMock = vi.mocked(notFound);

describe("PublicSharePage", () => {
  beforeEach(() => {
    headersMock.mockResolvedValue(new Map([["accept-language", "en-US"]]) as never);
    notFoundMock.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders stable public-page testids without leaking private fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ownerDisplayName: "Keith C",
          expiresAt: "2026-05-18T10:00:00.000Z",
          quoteAsOf: "2026-04-18T14:31:00.000Z",
          holdings: [
            {
              ticker: "2330.TW",
              instrumentName: "TSMC",
              quantity: 500,
              marketValueAmount: 625000,
              marketValueCurrency: "TWD",
              allocationPercent: 50.6,
              quoteStatus: "current",
              averageCostPerShare: 1234.56,
              currentUnitPrice: 6543.21,
              unrealizedPnlAmount: 9876.54,
            },
          ],
          holdingGroups: [
            {
              ticker: "2330.TW",
              instrumentName: "TSMC",
              marketCode: "TW",
              quantity: 500,
              accountCount: 2,
              marketValueAmount: 625000,
              marketValueCurrency: "TWD",
              allocationPercent: 50.6,
              quoteStatus: "current",
              averageCostPerShare: 1234.56,
              currentUnitPrice: 6543.21,
              unrealizedPnlAmount: 9876.54,
            },
          ],
          summary: {
            totalValueByCurrency: [{ currency: "TWD", amount: 1234567 }],
            returnByCurrency: [{ currency: "TWD", returnPercent: 14.2 }],
          },
          dataHealth: {
            holdingCount: 1,
            missingQuoteCount: 0,
            provisionalQuoteCount: 0,
          },
        }),
      }),
    );

    const element = await PublicSharePage({ params: Promise.resolve({ token: "aB3cDeFgHiJkLmNoPqR9Xy" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="public-share-root"');
    expect(html).toContain('data-testid="public-share-owner"');
    expect(html).toContain('data-testid="public-share-summary-total"');
    expect(html).toContain('data-testid="public-share-summary-return"');
    expect(html).toContain('data-testid="public-share-total-TWD"');
    expect(html).toContain('data-testid="public-share-return-TWD"');
    expect(html).toContain('data-testid="public-share-holding-2330.TW-TW"');
    expect(html).toContain("TSMC");
    expect(html).toContain('data-testid="public-share-expires-at"');
    expect(html).toContain('data-testid="public-share-quote-as-of"');
    expect(html).not.toContain("costBasisAmount");
    expect(html).not.toContain("averageCostPerShare");
    expect(html).not.toContain("currentUnitPrice");
    expect(html).not.toContain("unrealizedPnlAmount");
    expect(html).not.toContain("Avg cost");
    expect(html).not.toContain("Unit P&L");
    expect(html).not.toContain("1234.56");
    expect(html).not.toContain("6543.21");
    expect(html).not.toContain("9876.54");

    const fetchMock = vi.mocked(global.fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/share/aB3cDeFgHiJkLmNoPqR9Xy"),
      expect.objectContaining({ cache: "no-store" }),
    );
    const fetchOptions = fetchMock.mock.calls[0]?.[1];
    expect(fetchOptions).not.toHaveProperty("headers");
  });

  it("renders the empty-state contract when there are no holdings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ownerDisplayName: "Portfolio owner",
          expiresAt: "2026-05-18T10:00:00.000Z",
          quoteAsOf: null,
          holdings: [],
          holdingGroups: [],
          summary: {
            totalValueByCurrency: [{ currency: "USD", amount: 0 }],
            returnByCurrency: [{ currency: "USD", returnPercent: 0 }],
          },
          dataHealth: {
            holdingCount: 0,
            missingQuoteCount: 0,
            provisionalQuoteCount: 0,
          },
        }),
      }),
    );

    const element = await PublicSharePage({ params: Promise.resolve({ token: "ZyXwVuTsRqPoNmLkJiHgFe" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="public-share-empty"');
    expect(html).not.toContain('data-testid="public-share-holding-');
  });

  it("does not invent a market code for legacy public-share holdings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ownerDisplayName: "Portfolio owner",
          expiresAt: "2026-05-18T10:00:00.000Z",
          quoteAsOf: null,
          holdings: [
            {
              ticker: "LEGACY",
              instrumentName: "Legacy Holding",
              quantity: 3,
              marketValueAmount: 300,
              marketValueCurrency: "USD",
              allocationPercent: 100,
              quoteStatus: "current",
            },
          ],
          summary: {
            totalValueByCurrency: [{ currency: "USD", amount: 300 }],
            returnByCurrency: [{ currency: "USD", returnPercent: 1.5 }],
          },
          dataHealth: {
            holdingCount: 1,
            missingQuoteCount: 0,
            provisionalQuoteCount: 0,
          },
        }),
      }),
    );

    const element = await PublicSharePage({ params: Promise.resolve({ token: "LegacyPayloadToken123" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="public-share-holding-LEGACY-UNKNOWN"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("LEGACY");
    expect(html).toContain("Legacy Holding");
    expect(html).not.toContain('data-testid="public-share-holding-LEGACY-TW"');
  });

  it("renders missing-quote holdings as unavailable instead of hiding them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          ownerDisplayName: "Portfolio owner",
          expiresAt: "2026-05-18T10:00:00.000Z",
          quoteAsOf: null,
          holdings: [
            {
              ticker: "NODATA",
              quantity: 10,
              marketValueAmount: null,
              marketValueCurrency: "TWD",
              allocationPercent: null,
              quoteStatus: "missing",
            },
          ],
          holdingGroups: [
            {
              ticker: "NODATA",
              marketCode: "TW",
              quantity: 10,
              accountCount: 1,
              marketValueAmount: null,
              marketValueCurrency: "TWD",
              allocationPercent: null,
              quoteStatus: "missing",
            },
          ],
          summary: {
            totalValueByCurrency: [],
            returnByCurrency: [],
          },
          dataHealth: {
            holdingCount: 1,
            missingQuoteCount: 1,
            provisionalQuoteCount: 0,
          },
        }),
      }),
    );

    const element = await PublicSharePage({ params: Promise.resolve({ token: "ZyXwVuTsRqPoNmLkJiHgFe" }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="public-share-holding-NODATA-TW"');
    expect(html).toContain('data-testid="public-share-data-health-warning"');
    expect(html).toContain('data-testid="public-share-holding-quote-status-NODATA-TW"');
    expect(html).toContain("Missing quote");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain('data-testid="public-share-empty"');
    expect(html).not.toContain("costBasisAmount");
  });

  it("[Public Share holdings]: render EN and zh-TW → canonical explicit columns appear with market in Ticker and no sort controls", async () => {
    const response = {
      ownerDisplayName: "Portfolio owner",
      expiresAt: "2026-05-18T10:00:00.000Z",
      quoteAsOf: null,
      holdings: [],
      holdingGroups: [{
        ticker: "2330",
        instrumentName: "TSMC",
        marketCode: "TW",
        quantity: 500,
        accountCount: 2,
        marketValueAmount: 625000,
        marketValueCurrency: "TWD",
        allocationPercent: 50.6,
        quoteStatus: "current",
      }],
      summary: {
        totalValueByCurrency: [{ currency: "TWD", amount: 625000 }],
        returnByCurrency: [{ currency: "TWD", returnPercent: 14.2 }],
      },
      dataHealth: { holdingCount: 1, missingQuoteCount: 0, provisionalQuoteCount: 0 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => response,
    }));

    async function renderFor(language: string) {
      headersMock.mockResolvedValue(new Map([["accept-language", language]]) as never);
      const element = await PublicSharePage({ params: Promise.resolve({ token: `Canonical${language}Token123` }) });
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(element);
      return host;
    }

    const en = await renderFor("en-US");
    expect(Array.from(en.querySelectorAll("[data-testid='public-share-holdings-table'] thead th"), (header) => header.textContent?.trim())).toEqual([
      "Ticker",
      "Accounts",
      "Quantity",
      "Market value",
      "Allocation",
    ]);
    expect(en.querySelector("[data-testid='public-share-holding-group-2330-TW']")?.textContent).toContain("TW");
    expect(en.querySelector("[data-testid='public-share-holdings-table'] button")).toBeNull();
    expect(en.querySelector("[data-testid='public-share-holdings-table'] [aria-sort]")).toBeNull();
    expect(en.textContent).not.toContain("positions");
    expect(en.textContent).not.toContain("Shares");
    expect(en.textContent).not.toContain("Weight");

    const zh = await renderFor("zh-TW");
    expect(Array.from(zh.querySelectorAll("[data-testid='public-share-holdings-table'] thead th"), (header) => header.textContent?.trim())).toEqual([
      "代號",
      "帳戶",
      "數量",
      "市值",
      "配置比例",
    ]);
    expect(zh.querySelector("[data-testid='public-share-holding-group-2330-TW']")?.textContent).toContain("TW");
    expect(zh.textContent).not.toContain("部位");
    expect(zh.querySelector("[data-testid='public-share-holdings-table'] button")).toBeNull();
  });

  it("delegates missing tokens to next/navigation.notFound()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    await expect(
      PublicSharePage({ params: Promise.resolve({ token: "aB3cDeFgHiJkLmNoPqR9Xy" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});

describe("PublicShareNotFound", () => {
  it("renders the generic public not-found contract", async () => {
    headersMock.mockResolvedValue(new Map([["accept-language", "en-US"]]) as never);

    const element = await PublicShareNotFound();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="public-share-not-found"');
    expect(html).toContain('data-testid="public-share-not-found-heading"');
    expect(html).toContain("This link is not available");
    expect(html).toContain('href="/login"');
  });
});
