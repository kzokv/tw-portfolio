import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import {
  confirmAdminMarketCalendarImport,
  previewAdminMarketCalendarImport,
} from "../../src/services/market-data/marketCalendarService.js";
import { buildPortfolioReport } from "../../src/services/reports.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let userId: string;

describe("buildPortfolioReport", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
    const authUser = await app.persistence.resolveOrCreateUser("google", "reports-unit-user", {
      email: "reports-unit-user@example.com",
      name: "Reports Unit User",
    });
    userId = authUser.userId;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (app) await app.close();
  });

  it("populates allocation.byTicker from scoped translated holding groups", async () => {
    const store = await app.persistence.loadStore(userId);
    const account = store.accounts[0];
    const feeProfile = store.feeProfiles[0];
    if (!account || !feeProfile) throw new Error("expected seeded default account and fee profile");

    store.accounting.projections.holdings.push(
      {
        accountId: account.id,
        ticker: "2330",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
      },
      {
        accountId: account.id,
        ticker: "2317",
        quantity: 5,
        costBasisAmount: 500,
        currency: "TWD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "buy-2330",
        userId,
        accountId: account.id,
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
      },
      {
        id: "buy-2317",
        userId,
        accountId: account.id,
        ticker: "2317",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 5,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-06-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
      },
    );
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedInstrument?: (instrument: {
        ticker: string;
        name: string;
        instrumentType: "STOCK" | "ETF" | "BOND_ETF";
        marketCode: "TW" | "US" | "AU";
        barsBackfillStatus: "pending" | "backfilling" | "ready" | "failed";
      }) => void;
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };

    memoryPersistence._seedInstrument?.({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    memoryPersistence._seedInstrument?.({
      ticker: "2317",
      name: "Hon Hai",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-03",
        open: 100,
        high: 106,
        low: 99,
        close: 105,
        volume: 10_000,
        source: "test",
        ingestedAt: "2026-06-03T10:00:00.000Z",
      },
    ]);

    const report = await buildPortfolioReport(app, userId, { scope: "TW" });

    expect(report.allocation.byTicker).toEqual([
      expect.objectContaining({
        ticker: "2330",
        instrumentName: "TSMC",
        marketCode: "TW",
        accountCount: 1,
        reportingCurrency: "TWD",
        reportingAmount: 1050,
        portfolioAllocationPercent: 67.7419,
        allocationBasisUsed: "market_value",
        allocationBasisFallbackReason: null,
        fxStatus: "complete",
      }),
      expect.objectContaining({
        ticker: "2317",
        instrumentName: "Hon Hai",
        marketCode: "TW",
        accountCount: 1,
        reportingCurrency: "TWD",
        reportingAmount: 500,
        portfolioAllocationPercent: 32.2581,
        allocationBasisUsed: "cost_basis",
        allocationBasisFallbackReason: "missing_quote",
        quoteStatus: "missing",
        fxStatus: "complete",
      }),
    ]);
  });

  it("discloses report valuation basis for holiday rollback markets", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00.000Z"));

    const preview = await previewAdminMarketCalendarImport(app.persistence, "US", {
      calendarYear: 2026,
      retrievedAt: "2026-07-05T00:00:00.000Z",
      coverage: { scope: "full_year", evidence: "Unit test confirmed coverage." },
      exceptions: [
        {
          date: "2026-07-03",
          status: "closed",
          name: "Independence Day observed",
          evidence: "Unit test holiday",
          overrideReason: "unit_test",
        },
      ],
    });
    await confirmAdminMarketCalendarImport(app.persistence, "US", preview.previewToken);

    const store = await app.persistence.loadStore(userId);
    const account = store.accounts[0];
    const feeProfile = store.feeProfiles[0];
    if (!account || !feeProfile) throw new Error("expected seeded default account and fee profile");

    store.accounting.projections.holdings.push({
      accountId: account.id,
      ticker: "AVGO",
      quantity: 2,
      costBasisAmount: 400,
      currency: "USD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "buy-avgo",
      userId,
      accountId: account.id,
      ticker: "AVGO",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 2,
      unitPrice: 200,
      priceCurrency: "USD",
      tradeDate: "2026-07-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
    });
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedInstrument?: (instrument: {
        ticker: string;
        name: string;
        instrumentType: "STOCK" | "ETF" | "BOND_ETF";
        marketCode: "TW" | "US" | "AU";
        barsBackfillStatus: "pending" | "backfilling" | "ready" | "failed";
      }) => void;
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedInstrument?.({
      ticker: "AVGO",
      name: "Broadcom",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "ready",
    });
    const refreshedStore = await app.persistence.loadStore(userId);
    refreshedStore.marketData.instruments = refreshedStore.marketData.instruments
      .filter((instrument) => instrument.ticker !== "AVGO" || instrument.marketCode !== "US")
      .concat({
        ticker: "AVGO",
        marketCode: "US",
        instrumentType: "STOCK",
        name: "Broadcom",
        isProvisional: false,
        lastSyncedAt: null,
      });
    refreshedStore.instruments = refreshedStore.instruments
      .filter((instrument) => instrument.ticker !== "AVGO" || instrument.marketCode !== "US")
      .concat({
        ticker: "AVGO",
        marketCode: "US",
        type: "STOCK",
        isProvisional: false,
        lastSyncedAt: null,
      });
    await app.persistence.saveStore(refreshedStore);
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "AVGO",
        marketCode: "US",
        barDate: "2026-07-02",
        open: 210,
        high: 214,
        low: 209,
        close: 212,
        volume: 1_000,
        source: "test-us-close",
        ingestedAt: "2026-07-02T21:00:00.000Z",
      },
    ]);
    await app.persistence.upsertFxRates([
      {
        date: "2026-07-02",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 32,
        source: "test-fx",
      },
    ]);

    const report = await buildPortfolioReport(app, userId, { scope: "all", currencyMode: "specified", currency: "TWD" });
    const usBasis = report.diagnostics.valuationBasis?.markets.find((market) => market.marketCode === "US");
    const usDiagnostics = report.diagnostics.markets.find((market) => market.marketCode === "US");

    expect(usBasis).toEqual(expect.objectContaining({
      expectedLatestValuationDate: "2026-07-02",
      quoteAsOfDate: "2026-07-02",
      quoteSource: "test-us-close",
      quoteSourceKind: "primary_daily",
      closureDate: "2026-07-03",
      closureName: "Independence Day observed",
      closureReason: "market_holiday",
      fxAsOfDate: "2026-07-02",
      reportingCurrency: report.query.reportingCurrency,
    }));
    expect(usDiagnostics?.basis).toEqual(usBasis);
    expect(report.diagnostics.valuationBasis?.markets.map((market) => market.marketCode)).toEqual([
      "AU",
      "JP",
      "KR",
      "TW",
      "US",
    ]);
  });
});
