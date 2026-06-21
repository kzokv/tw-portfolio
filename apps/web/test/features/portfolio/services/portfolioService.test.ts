import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/api", () => ({
  getJson: vi.fn(),
  postNoBody: vi.fn(),
  postJson: vi.fn(),
}));

import {
  fetchPortfolioEnrichmentData,
  fetchPortfolioPageData,
  fetchPortfolioPrimaryData,
  fetchTransactionHistoryPage,
  refreshPortfolioCloses,
  fetchTransactionsPrimaryData,
  fetchTransactionInstrumentCatalog,
} from "../../../../features/portfolio/services/portfolioService";
import { getJson, postNoBody } from "../../../../lib/api";

// KZO-169 — Frontend Implementer's TDD red specs for slice 5 service-layer
// changes (D5c): `?market_code=` is appended for specific markets AND for
// ALL mode (server-side default) so the combobox refetches when the chip
// changes.

describe("fetchTransactionInstrumentCatalog — KZO-169 D5c market_code query", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockResolvedValue({ instruments: [] });
  });

  afterEach(() => {
    vi.mocked(getJson).mockReset();
    vi.mocked(postNoBody).mockReset();
  });

  it("omits market_code when called with no argument", async () => {
    await fetchTransactionInstrumentCatalog();
    expect(getJson).toHaveBeenCalledWith("/instruments");
  });

  it("appends market_code=TW for the TW chip", async () => {
    await fetchTransactionInstrumentCatalog("TW");
    expect(getJson).toHaveBeenCalledWith("/instruments?market_code=TW");
  });

  it("appends market_code=US for the US chip", async () => {
    await fetchTransactionInstrumentCatalog("US");
    expect(getJson).toHaveBeenCalledWith("/instruments?market_code=US");
  });

  it("appends market_code=AU for the AU chip", async () => {
    await fetchTransactionInstrumentCatalog("AU");
    expect(getJson).toHaveBeenCalledWith("/instruments?market_code=AU");
  });

  it("appends market_code=ALL for the All chip (server returns cross-market catalog)", async () => {
    await fetchTransactionInstrumentCatalog("ALL");
    expect(getJson).toHaveBeenCalledWith("/instruments?market_code=ALL");
  });

  it("treats null as omit (no market_code)", async () => {
    await fetchTransactionInstrumentCatalog(null);
    expect(getJson).toHaveBeenCalledWith("/instruments");
  });
});

describe("portfolio primary/enrichment service paths", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockResolvedValue({
      holdings: [],
      holdingGroups: [],
      dividends: { upcoming: [], recent: [] },
      instruments: [],
      accounts: [],
    });
  });

  afterEach(() => {
    vi.mocked(getJson).mockReset();
  });

  it("fetches first-paint primary data from the explicit primary endpoint", async () => {
    await fetchPortfolioPrimaryData();
    expect(getJson).toHaveBeenCalledWith("/portfolio/primary");
  });

  it("fetches transactions primary data from the explicit primary endpoint", async () => {
    await fetchTransactionsPrimaryData();
    expect(getJson).toHaveBeenCalledWith("/transactions/primary");
  });

  it("keeps compatibility page data on the enrichment endpoint", async () => {
    await fetchPortfolioPageData();
    expect(getJson).toHaveBeenCalledWith("/portfolio/enrichment");
  });

  it("fetches secondary enrichment from the explicit enrichment endpoint", async () => {
    await fetchPortfolioEnrichmentData();
    expect(getJson).toHaveBeenCalledWith("/portfolio/enrichment");
  });

  it("posts the close-refresh request without a request body", async () => {
    vi.mocked(postNoBody).mockResolvedValue({
      items: [],
      summary: {
        refreshed: 0,
        current: 0,
        not_eligible: 0,
        missing: 0,
        failed: 0,
        queued: 0,
      },
    });

    await refreshPortfolioCloses();

    expect(postNoBody).toHaveBeenCalledWith("/portfolio/refresh-closes");
  });
});

describe("fetchTransactionHistoryPage", () => {
  beforeEach(() => {
    vi.mocked(getJson).mockResolvedValue({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      aggregates: { realizedPnlByCurrency: [] },
    });
  });

  afterEach(() => {
    vi.mocked(getJson).mockReset();
  });

  it("calls the transaction history endpoint with normalized query params", async () => {
    await fetchTransactionHistoryPage({
      type: "SELL",
      pnl: "realized",
      marketCode: "US",
      accountId: "acc-1",
      ticker: " msft ",
      from: "2026-05-01",
      to: "2026-06-01",
      limit: 25,
      offset: 50,
      sortBy: "realizedPnl",
      sortOrder: "asc",
    });

    expect(getJson).toHaveBeenCalledWith("/transactions/history?type=SELL&pnl=realized&marketCode=US&accountId=acc-1&ticker=MSFT&from=2026-05-01&to=2026-06-01&limit=25&offset=50&sortBy=realizedPnl&sortOrder=asc");
  });
});
