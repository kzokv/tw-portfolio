import { describe, it, expect, vi, afterEach } from "vitest";
import { FinMindMarketDataProvider } from "../../src/services/market-data/providers/finmind.js";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";

vi.mock("@tw-portfolio/config", () => ({
  Env: { FINMIND_API_TOKEN: "test-token" },
}));

function makeProvider(): FinMindMarketDataProvider {
  return new FinMindMarketDataProvider({
    token: "test-token",
    baseUrl: "https://api.finmindtrade.com/api/v4/data",
    rateLimiter: new RateLimiter(600),
  });
}

describe("FinMindMarketDataProvider.fetchDividends mapper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts 3 new typed fields and rawProviderData passthrough", async () => {
    const mockRow = {
      date: "2025-06-15",
      stock_id: "2330",
      CashEarningsDistribution: 2.5,
      CashStatutorySurplus: 0,
      StockEarningsDistribution: 0,
      StockStatutorySurplus: 0,
      CashExDividendTradingDate: "2025-06-15",
      CashDividendPaymentDate: "2025-07-15",
      StockExDividendTradingDate: "",
      year: "2024",
      AnnouncementDate: "2025-05-01",
      ParticipateDistributionOfTotalShares: 25933632588,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: "success", status: 200, data: [mockRow] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const provider = makeProvider();
    const records = await provider.fetchDividends("2330");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ticker: "2330",
      exDividendDate: "2025-06-15",
      paymentDate: "2025-07-15",
      cashDividendPerShare: 2.5,
      stockDividendPerShare: 0,
      fiscalYearPeriod: "2024",
      announcementDate: "2025-05-01",
      totalDistributionShares: 25933632588,
      sourceId: "finmind",
    });

    // rawProviderData is the full original row
    expect(records[0]!.rawProviderData).toEqual(mockRow);
    expect(records[0]!.rawProviderData).toHaveProperty("CashEarningsDistribution", 2.5);
    expect(records[0]!.rawProviderData).toHaveProperty("year", "2024");
  });

  it("omits new fields when provider returns empty/zero values", async () => {
    const mockRow = {
      date: "2025-06-15",
      stock_id: "2330",
      CashEarningsDistribution: 1.0,
      CashStatutorySurplus: 0,
      StockEarningsDistribution: 0,
      StockStatutorySurplus: 0,
      CashExDividendTradingDate: "2025-06-15",
      CashDividendPaymentDate: "2025-07-15",
      StockExDividendTradingDate: "",
      year: "",
      AnnouncementDate: "",
      ParticipateDistributionOfTotalShares: 0,
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: "success", status: 200, data: [mockRow] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const provider = makeProvider();
    const records = await provider.fetchDividends("2330");

    expect(records).toHaveLength(1);
    expect(records[0]!.fiscalYearPeriod).toBeUndefined();
    expect(records[0]!.announcementDate).toBeUndefined();
    expect(records[0]!.totalDistributionShares).toBeUndefined();
    // rawProviderData is always present
    expect(records[0]!.rawProviderData).toBeDefined();
  });
});
