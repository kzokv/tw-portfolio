import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "../../../features/dashboard/types";
import type { InstrumentCatalogItemDto, TransactionHistoryItemDto } from "@vakwen/shared-types";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "../../../lib/api";
import { buildPrimaryTickerDetails, fetchTickerDetails } from "../../../features/portfolio/services/tickerDetailsService";

const getJsonMock = vi.mocked(getJson);

const duplicateTickerInstrument: InstrumentCatalogItemDto = {
  ticker: "2330",
  name: "TSMC ADR",
  marketCode: "US",
  instrumentType: "STOCK",
  sector: null,
  barsBackfillStatus: "complete",
  lastRepairAt: null,
  repairAvailableAt: null,
  gicsIndustryGroup: null,
};

const scopedDashboard = {
  settings: null,
  holdings: [{
    accountId: "acc-1",
    accountName: "Main Brokerage",
    ticker: "2330",
    instrumentName: "台積電",
    marketCode: "TW",
    quantity: 10,
    costBasisAmount: 1000,
    currency: "TWD",
    averageCostPerShare: 100,
    currentUnitPrice: null,
    marketValueAmount: null,
    unrealizedPnlAmount: null,
    allocationPct: null,
    change: null,
    changePercent: null,
    previousClose: null,
    quoteStatus: "missing",
    nextDividendDate: null,
    lastDividendPostedDate: null,
    priceState: null,
  }],
  holdingGroups: [],
  instruments: [{
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    isProvisional: false,
  }],
  accounts: [],
  dividends: { upcoming: [], recent: [] },
  actions: { integrityIssue: null, recomputeAvailable: false },
  feeProfiles: [],
  feeProfileBindings: [],
} as unknown as DashboardSnapshot;

const scopedTransactions: TransactionHistoryItemDto[] = [{
  id: "tx-1",
  accountId: "acc-1",
  accountName: "Main Brokerage",
  ticker: "2330",
  marketCode: "TW",
  instrumentType: "STOCK",
  type: "BUY",
  quantity: 10,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: "2026-01-02",
  tradeTimestamp: "2026-01-02T00:00:00.000Z",
  bookingSequence: 1,
  commissionAmount: 0,
  taxAmount: 0,
  isDayTrade: false,
  realizedPnlAmount: null,
  realizedPnlCurrency: null,
  feeProfileId: "fp-1",
  feeProfileName: "Default",
  bookedAt: "2026-01-02T00:00:00.000Z",
  feesSource: "CALCULATED",
}];

describe("buildPrimaryTickerDetails", () => {
  beforeEach(() => {
    getJsonMock.mockReset();
    getJsonMock.mockResolvedValue({});
  });

  it("prefers the market-scoped dashboard instrument over a broad duplicate ticker match", () => {
    const details = buildPrimaryTickerDetails({
      ticker: "2330",
      accountId: "acc-1",
      marketCode: "TW",
      dashboard: scopedDashboard,
      transactions: scopedTransactions,
      instrument: duplicateTickerInstrument,
    });

    expect(details.identity.name).toBe("台積電");
    expect(details.identity.marketCode).toBe("TW");
    expect(details.fundamentals.panels[0]?.items.find((item) => item.key === "market")?.value).toBeNull();
  });

  it("forwards multi-account scope when fetching full ticker details", async () => {
    await fetchTickerDetails({
      ticker: "2330",
      accountIds: ["acc-1", "acc-2"],
      marketCode: "TW",
      dashboard: scopedDashboard,
      transactions: scopedTransactions,
      instrument: null,
    });

    expect(getJsonMock).toHaveBeenCalledWith("/tickers/2330/details?accountIds=acc-1%2Cacc-2&marketCode=TW");
  });
});
