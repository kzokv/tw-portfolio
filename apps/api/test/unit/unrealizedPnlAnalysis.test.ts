import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import {
  buildUnrealizedPnlAnalysis,
  unrealizedPnlAnalysisRouteQuerySchema,
} from "../../src/services/unrealizedPnlAnalysis.js";
import type { HoldingSnapshot, UnrealizedPnlAnalysisSnapshotRow } from "../../src/persistence/types.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import type { BookedTradeEvent, Store } from "../../src/types/store.js";
import type { FxRate } from "../../src/services/market-data/types.js";

let app: AppInstance;
let persistence: MemoryPersistence;

function makeTrade(store: Store, overrides: Partial<BookedTradeEvent> = {}): BookedTradeEvent {
  const feeProfile = store.feeProfiles[0];
  const account = store.accounts[0];
  if (!feeProfile || !account) throw new Error("expected seeded account and fee profile");
  return {
    id: randomUUID(),
    userId: "user-1",
    accountId: account.id,
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2026-01-02",
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: {
      ...feeProfile,
      accountId: overrides.accountId ?? account.id,
    },
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<HoldingSnapshot> = {}): HoldingSnapshot {
  return {
    id: randomUUID(),
    userId: "user-1",
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
    snapshotDate: "2026-01-02",
    quantity: 10,
    closePrice: 100,
    marketValue: 1000,
    costBasis: 1000,
    unrealizedPnl: 0,
    cumulativeRealizedPnl: 0,
    cumulativeDividends: 0,
    isProvisional: false,
    currency: "TWD",
    valueNative: 1000,
    costBasisNative: 1000,
    unrealizedPnlNative: 0,
    providerSource: "test",
    generatedAt: "2026-01-02T00:00:00.000Z",
    generationRunId: "run-1",
    ...overrides,
  };
}

function makeAnalysisSnapshotRow(overrides: Partial<UnrealizedPnlAnalysisSnapshotRow> = {}): UnrealizedPnlAnalysisSnapshotRow {
  return {
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
    snapshotDate: "2026-01-02",
    quantity: 10,
    closePrice: 100,
    providerSource: "test",
    nativeCurrency: "TWD",
    reportingCurrency: "TWD",
    costBasisAmount: 1000,
    marketValueAmount: 1000,
    unrealizedPnlAmount: 0,
    isProvisional: false,
    fxAvailable: true,
    fxAsOfDate: "2026-01-02",
    ...overrides,
  };
}

async function seedInstrument(input: {
  ticker: string;
  marketCode: "TW" | "US" | "AU" | "KR" | "JP";
  instrumentType: "STOCK" | "ETF" | "BOND_ETF";
  name: string;
}): Promise<void> {
  const memory = persistence as MemoryPersistence & {
    _seedInstrument: (instrument: {
      ticker: string;
      marketCode: string;
      instrumentType: string;
      name: string;
      barsBackfillStatus: "ready";
    }, userId?: string) => void;
  };
  memory._seedInstrument({
    ...input,
    barsBackfillStatus: "ready",
  }, "user-1");
  const store = await persistence.loadStore("user-1");
  store.marketData.instruments = store.marketData.instruments
    .filter((instrument) => instrument.ticker !== input.ticker || instrument.marketCode !== input.marketCode)
    .concat({
      ticker: input.ticker,
      marketCode: input.marketCode,
      instrumentType: input.instrumentType,
      name: input.name,
      isProvisional: false,
      lastSyncedAt: null,
    });
  store.instruments = store.instruments
    .filter((instrument) => instrument.ticker !== input.ticker || instrument.marketCode !== input.marketCode)
    .concat({
      ticker: input.ticker,
      marketCode: input.marketCode,
      type: input.instrumentType,
      isProvisional: false,
      lastSyncedAt: null,
    });
}

async function addAccount(overrides: Partial<Store["accounts"][number]> = {}): Promise<Store["accounts"][number]> {
  const store = await persistence.loadStore("user-1");
  const firstAccount = store.accounts[0];
  const firstFeeProfile = store.feeProfiles[0];
  if (!firstAccount) throw new Error("expected seeded account");
  if (!firstFeeProfile) throw new Error("expected seeded fee profile");
  const feeProfileId = overrides.feeProfileId ?? `fp-${store.accounts.length + 1}`;
  store.feeProfiles.push({
    ...firstFeeProfile,
    id: feeProfileId,
    accountId: overrides.id ?? `acc-${store.accounts.length + 1}`,
    name: `${overrides.name ?? `Account ${store.accounts.length + 1}`} Fee Profile`,
  });
  const next = {
    ...firstAccount,
    id: overrides.id ?? `acc-${store.accounts.length + 1}`,
    name: overrides.name ?? `Account ${store.accounts.length + 1}`,
    feeProfileId,
    defaultCurrency: overrides.defaultCurrency ?? firstAccount.defaultCurrency,
    ...overrides,
  };
  store.accounts.push(next);
  await persistence.saveStore(store);
  return next;
}

async function seedTrades(trades: BookedTradeEvent[]): Promise<void> {
  const store = await persistence.loadStore("user-1");
  store.accounting.facts.tradeEvents.push(...trades);
  await persistence.saveStore(store);
}

async function seedSnapshots(snapshots: HoldingSnapshot[]): Promise<void> {
  persistence._seedHoldingSnapshots(snapshots);
}

async function seedFxRates(rates: FxRate[]): Promise<void> {
  await persistence.upsertFxRates(rates);
}

beforeEach(async () => {
  app = await buildApp({ persistenceBackend: "memory" });
  persistence = app.persistence as MemoryPersistence;
});

afterEach(async () => {
  await app.close();
});

describe("buildUnrealizedPnlAnalysis", () => {
  it("builds buy-only daily history with auto-selection and buy markers", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    const store = await persistence.loadStore("user-1");
    await seedTrades([
      makeTrade(store, { tradeDate: "2026-01-02", type: "BUY", quantity: 10 }),
    ]);
    await seedSnapshots([
      makeSnapshot({ snapshotDate: "2026-01-02", unrealizedPnl: 0, unrealizedPnlNative: 0, marketValue: 1000, valueNative: 1000 }),
      makeSnapshot({ snapshotDate: "2026-01-03", unrealizedPnl: 100, unrealizedPnlNative: 100, marketValue: 1100, valueNative: 1100 }),
      makeSnapshot({ snapshotDate: "2026-01-06", unrealizedPnl: 200, unrealizedPnlNative: 200, marketValue: 1200, valueNative: 1200 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-02",
      toDate: "2026-01-06",
    });

    expect(report.portfolioSeries.map((point) => point.date)).toEqual(["2026-01-02", "2026-01-03", "2026-01-06"]);
    expect(report.summary.periodChangeAmount).toBe(200);
    expect(report.rankings).toHaveLength(1);
    expect(report.metadata.reportingCurrencySemantics).toEqual({
      reportingCurrency: "TWD",
      appliesToFields: [
        "startUnrealizedPnlAmount",
        "endUnrealizedPnlAmount",
        "periodChangeAmount",
      ],
    });
    expect(report.metadata.metricDefinitions.periodChangeAmount).toEqual({
      field: "periodChangeAmount",
      amountSemantics: "unrealized_pnl_period_change",
      boundary: "period_change",
      unit: "reporting_currency",
      reportingCurrency: "TWD",
    });
    expect(report.basis).toEqual({
      semantics: "snapshot_valuation",
      priceBasis: "daily_holding_snapshots",
      fxBasis: "snapshot_date_fx",
      reportingCurrency: "TWD",
      startSnapshotDate: "2026-01-02",
      endSnapshotDate: "2026-01-06",
    });
    expect(report.rankings[0]).toEqual(expect.objectContaining({ positionStatus: "open_position" }));
    expect(report.rankings[0]).toEqual(expect.objectContaining({
      snapshotDate: "2026-01-06",
      snapshotProviderSources: ["test"],
      fxAsOfDate: "2026-01-06",
    }));
    expect(report.tickerComposition).toEqual([
      expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
        instrumentName: "TSMC",
        endUnrealizedPnlAmount: 200,
        latestMarketValueAmount: 1200,
        latestCostBasisAmount: 1000,
        latestQuantity: 10,
        contributionSharePercent: 100,
        positionStatus: "open_position",
        snapshotDate: "2026-01-06",
        snapshotProviderSources: ["test"],
        fxAsOfDate: "2026-01-06",
      }),
    ]);
    expect(report.tickerSeries.every((point) => point.positionStatus === "open_position")).toBe(true);
    expect(report.tickerSeries.find((point) => point.date === "2026-01-02")?.closePrice).toBe(100);
    expect(report.candidateTickers).toEqual([{ ticker: "2330", marketCode: "TW" }]);
    expect(report.tradeMarkers).toEqual([
      expect.objectContaining({ ticker: "2330", marketCode: "TW", date: "2026-01-02", kind: "buy" }),
    ]);
  });

  it("preserves resolved FX dates when snapshot FX rolls back", async () => {
    await seedInstrument({ ticker: "AVGO", marketCode: "US", instrumentType: "STOCK", name: "Broadcom" });
    vi.spyOn(persistence, "listUnrealizedPnlAnalysisSnapshots").mockResolvedValue([
      makeAnalysisSnapshotRow({
        ticker: "AVGO",
        marketCode: "US",
        snapshotDate: "2026-07-02",
        nativeCurrency: "USD",
        reportingCurrency: "AUD",
        fxAsOfDate: "2026-07-02",
      }),
      makeAnalysisSnapshotRow({
        ticker: "AVGO",
        marketCode: "US",
        snapshotDate: "2026-07-05",
        nativeCurrency: "USD",
        reportingCurrency: "AUD",
        costBasisAmount: 1000,
        marketValueAmount: 1200,
        unrealizedPnlAmount: 200,
        fxAsOfDate: "2026-07-03",
      }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-07-02",
      toDate: "2026-07-05",
      reportingCurrency: "AUD",
    });

    expect(report.portfolioSeries[report.portfolioSeries.length - 1]?.fxAsOfDate).toBe("2026-07-03");
    expect(report.tickerSeries.find((point) => point.date === "2026-07-05")?.fxAsOfDate).toBe("2026-07-03");
    expect(report.tickerComposition[0]?.fxAsOfDate).toBe("2026-07-03");
    expect(report.rankings[0]?.fxAsOfDate).toBe("2026-07-03");
  });

  it("uses conservative FX dates for aggregate buckets with mixed FX bases", async () => {
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedInstrument({ ticker: "AVGO", marketCode: "US", instrumentType: "STOCK", name: "Broadcom" });
    vi.spyOn(persistence, "listUnrealizedPnlAnalysisSnapshots").mockResolvedValue([
      makeAnalysisSnapshotRow({
        ticker: "0050",
        marketCode: "TW",
        snapshotDate: "2026-07-05",
        nativeCurrency: "TWD",
        reportingCurrency: "TWD",
        costBasisAmount: 1000,
        marketValueAmount: 1100,
        unrealizedPnlAmount: 100,
        fxAsOfDate: "2026-07-05",
      }),
      makeAnalysisSnapshotRow({
        ticker: "AVGO",
        marketCode: "US",
        snapshotDate: "2026-07-05",
        nativeCurrency: "USD",
        reportingCurrency: "TWD",
        costBasisAmount: 3000,
        marketValueAmount: 3600,
        unrealizedPnlAmount: 600,
        fxAsOfDate: "2026-07-03",
      }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-07-05",
      toDate: "2026-07-05",
      reportingCurrency: "TWD",
    });

    expect(report.portfolioSeries[0]?.fxAsOfDate).toBe("2026-07-03");
    expect(report.tickerSeries.find((point) => point.ticker === "0050")?.fxAsOfDate).toBe("2026-07-05");
    expect(report.tickerSeries.find((point) => point.ticker === "AVGO")?.fxAsOfDate).toBe("2026-07-03");
  });

  it("memory snapshot rows preserve resolved FX dates when FX rolls back", async () => {
    await seedSnapshots([
      makeSnapshot({
        ticker: "AVGO",
        marketCode: "US",
        currency: "USD",
        snapshotDate: "2026-07-05",
        costBasis: 100,
        costBasisNative: 100,
        marketValue: 120,
        valueNative: 120,
        unrealizedPnl: 20,
        unrealizedPnlNative: 20,
      }),
    ]);
    await seedFxRates([{ date: "2026-07-03", baseCurrency: "USD", quoteCurrency: "AUD", rate: 1.5, source: "test" }]);

    const rows = await persistence.listUnrealizedPnlAnalysisSnapshots("user-1", {
      startDate: "2026-07-05",
      endDate: "2026-07-05",
      includeProvisional: false,
      reportingCurrency: "AUD",
    });

    expect(rows).toEqual([
      expect.objectContaining({
        ticker: "AVGO",
        marketCode: "US",
        snapshotDate: "2026-07-05",
        reportingCurrency: "AUD",
        costBasisAmount: 150,
        marketValueAmount: 180,
        unrealizedPnlAmount: 30,
        fxAvailable: true,
        fxAsOfDate: "2026-07-03",
      }),
    ]);
  });

  it("excludes sold-out tickers by default and keeps them with markers when requested", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    const store = await persistence.loadStore("user-1");
    await seedTrades([
      makeTrade(store, { tradeDate: "2026-01-02", type: "BUY", quantity: 10 }),
      makeTrade(store, { tradeDate: "2026-01-03", type: "SELL", quantity: 5 }),
      makeTrade(store, { tradeDate: "2026-01-04", type: "SELL", quantity: 5 }),
    ]);
    await seedSnapshots([
      makeSnapshot({ snapshotDate: "2026-01-02", quantity: 10, unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ snapshotDate: "2026-01-03", quantity: 5, costBasis: 500, costBasisNative: 500, marketValue: 600, valueNative: 600, unrealizedPnl: 100, unrealizedPnlNative: 100 }),
      makeSnapshot({ snapshotDate: "2026-01-04", quantity: 0, costBasis: 0, costBasisNative: 0, marketValue: null, valueNative: null, unrealizedPnl: null, unrealizedPnlNative: null }),
    ]);

    const openOnly = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-02",
      toDate: "2026-01-04",
    });
    expect(openOnly.rankings).toHaveLength(0);
    expect(openOnly.portfolioSeries).toEqual([]);
    expect(openOnly.summary.endUnrealizedPnlAmount).toBeNull();
    expect(openOnly.dataHealth.snapshotRowCount).toBe(0);
    expect(openOnly.dataHealth.missingFxRowCount).toBe(0);
    expect(openOnly.dataHealth.nullUnrealizedRowCount).toBe(0);
    expect(openOnly.dataHealth.unavailableRowCount).toBe(0);
    expect(openOnly.dataHealth.excludedSoldOutTickerCount).toBe(1);

    const includeSoldOut = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-02",
      toDate: "2026-01-04",
      positionStatus: "includeClosed",
    });
    expect(includeSoldOut.rankings).toEqual([
      expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
        isSoldOut: true,
        latestQuantity: 0,
        endUnrealizedPnlAmount: 0,
        positionStatus: "closed_position",
      }),
    ]);
    expect(includeSoldOut.tickerSeries.at(-1)).toEqual(expect.objectContaining({
      quantity: 0,
      unrealizedPnlAmount: 0,
      positionStatus: "closed_position",
    }));
    expect(includeSoldOut.tradeMarkers.map((marker) => marker.kind)).toEqual(["buy", "partial_sell", "full_exit"]);
  });

  it("aggregates same-market tickers across accounts and keeps cross-market symbols separate", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "2330", marketCode: "US", instrumentType: "STOCK", name: "Ticker 2330 ADR" });
    const secondAccount = await addAccount({ id: "acc-2", name: "AAA Account", defaultCurrency: "TWD" });
    await seedSnapshots([
      makeSnapshot({ accountId: "acc-1", ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 10, marketValue: 1100, valueNative: 1100, unrealizedPnl: 100, unrealizedPnlNative: 100 }),
      makeSnapshot({ accountId: secondAccount.id, ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 5, costBasis: 400, costBasisNative: 400, marketValue: 550, valueNative: 550, unrealizedPnl: 150, unrealizedPnlNative: 150 }),
      makeSnapshot({ accountId: "acc-1", ticker: "2330", marketCode: "US", currency: "USD", snapshotDate: "2026-01-31", quantity: 2, costBasis: 300, costBasisNative: 10, marketValue: 360, valueNative: 12, unrealizedPnl: 60, unrealizedPnlNative: 2 }),
    ]);
    await seedFxRates([{ date: "2026-01-31", baseCurrency: "USD", quoteCurrency: "TWD", rate: 30, source: "test" }]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-31",
      toDate: "2026-01-31",
      positionStatus: "includeClosed",
    });

    const twRow = report.rankings.find((row) => row.marketCode === "TW" && row.ticker === "2330");
    const usRow = report.rankings.find((row) => row.marketCode === "US" && row.ticker === "2330");
    expect(twRow).toEqual(expect.objectContaining({ latestQuantity: 15, latestMarketValueAmount: 1650 }));
    expect(twRow?.accountIds).toEqual(["acc-1", "acc-2"]);
    expect(twRow?.accountNames).toEqual(["Main", "AAA Account"]);
    expect(usRow).toEqual(expect.objectContaining({ latestQuantity: 2, latestMarketValueAmount: 360 }));
  });

  it("sums different tickers in the same account for portfolio series", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedSnapshots([
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 10, marketValue: 1100, valueNative: 1100, unrealizedPnl: 100, unrealizedPnlNative: 100 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 20, marketValue: 2400, valueNative: 2400, unrealizedPnl: 400, unrealizedPnlNative: 400 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-31",
      toDate: "2026-01-31",
      positionStatus: "includeClosed",
    });

    expect(report.portfolioSeries[0]).toEqual(expect.objectContaining({
      marketValueAmount: 3500,
      unrealizedPnlAmount: 500,
    }));
    expect(report.summary.endUnrealizedPnlAmount).toBe(500);
    expect(report.tickerComposition.map((row) => [row.ticker, row.endUnrealizedPnlAmount, row.contributionSharePercent])).toEqual([
      ["0050", 400, 80],
      ["2330", 100, 20],
    ]);
  });

  it("sorts ticker composition by end unrealized P&L and keeps all-null holdings in health totals", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedInstrument({ ticker: "AAPL", marketCode: "US", instrumentType: "STOCK", name: "Apple" });
    await seedSnapshots([
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 10, marketValue: 1100, valueNative: 1100, unrealizedPnl: 100, unrealizedPnlNative: 100 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 20, marketValue: 2400, valueNative: 2400, unrealizedPnl: 400, unrealizedPnlNative: 400 }),
      makeSnapshot({ ticker: "AAPL", marketCode: "US", snapshotDate: "2026-01-31", quantity: 2, marketValue: null, valueNative: null, unrealizedPnl: null, unrealizedPnlNative: null }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-31",
      toDate: "2026-01-31",
      positionStatus: "includeClosed",
    });

    expect(report.tickerComposition.map((row) => [row.ticker, row.endUnrealizedPnlAmount])).toEqual([
      ["0050", 400],
      ["2330", 100],
      ["AAPL", null],
    ]);
    expect(report.dataHealth.snapshotRowCount).toBe(3);
    expect(report.dataHealth.nullUnrealizedRowCount).toBe(1);
    expect(report.dataHealth.unavailableRowCount).toBe(1);
    expect(report.summary.endUnrealizedPnlAmount).toBeNull();
  });

  it("marks ticker composition unavailable when a ticker is missing the summary end bucket", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedSnapshots([
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 10, marketValue: 1100, valueNative: 1100, unrealizedPnl: 100, unrealizedPnlNative: 100 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-02-03", quantity: 20, marketValue: 2400, valueNative: 2400, unrealizedPnl: 400, unrealizedPnlNative: 400 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-31",
      toDate: "2026-02-03",
      positionStatus: "includeClosed",
    });

    expect(report.summary.endDate).toBe("2026-02-03");
    expect(report.summary.endUnrealizedPnlAmount).toBe(400);
    expect(report.tickerComposition.map((row) => [row.ticker, row.endUnrealizedPnlAmount, row.contributionSharePercent])).toEqual([
      ["0050", 400, 100],
      ["2330", null, null],
    ]);
  });

  it("computes ticker composition share when the total unrealized P&L is negative", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedSnapshots([
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 10, marketValue: 940, valueNative: 940, unrealizedPnl: -60, unrealizedPnlNative: -60 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 20, marketValue: 1960, valueNative: 1960, unrealizedPnl: -40, unrealizedPnlNative: -40 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-31",
      toDate: "2026-01-31",
      positionStatus: "includeClosed",
    });

    expect(report.summary.endUnrealizedPnlAmount).toBe(-100);
    expect(report.tickerComposition.map((row) => [row.ticker, row.endUnrealizedPnlAmount, row.contributionSharePercent])).toEqual([
      ["0050", -40, 40],
      ["2330", -60, 60],
    ]);
  });

  it("returns manually selected ticker series as the rendered candidate set", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedInstrument({ ticker: "0050", marketCode: "US", instrumentType: "ETF", name: "Cross Market 50" });
    const store = await persistence.loadStore("user-1");
    await seedTrades([
      makeTrade(store, { ticker: "0050", marketCode: "TW", tradeDate: "2026-01-02", type: "BUY", quantity: 20 }),
    ]);
    await seedSnapshots([
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 500, unrealizedPnlNative: 500, marketValue: 1500, valueNative: 1500 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 10, unrealizedPnlNative: 10, marketValue: 1010, valueNative: 1010 }),
      makeSnapshot({ ticker: "0050", marketCode: "US", currency: "USD", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "0050", marketCode: "US", currency: "USD", snapshotDate: "2026-01-31", unrealizedPnl: 800, unrealizedPnlNative: 800, marketValue: 1800, valueNative: 1800 }),
    ]);

    const snapshotSpy = vi.spyOn(persistence, "listUnrealizedPnlAnalysisSnapshots");

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      positionStatus: "includeClosed",
      selection: "manualTickers",
      tickerMode: "custom",
      tickerIds: [{ ticker: "0050", marketCode: "TW" }],
    });

    expect(report.rankings.map((row) => row.ticker)).toEqual(["2330", "0050"]);
    expect(snapshotSpy).toHaveBeenNthCalledWith(1, "user-1", expect.objectContaining({
      markets: ["TW"],
      tickers: ["0050"],
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    }));
    expect(snapshotSpy).toHaveBeenNthCalledWith(2, "user-1", expect.objectContaining({
      markets: ["TW"],
      tickers: undefined,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    }));
    expect(report.summary.includedTickerCount).toBe(1);
    expect(new Set(report.tickerSeries.map((point) => point.ticker))).toEqual(new Set(["0050"]));
    expect(report.tickerComposition.map((row) => row.ticker)).toEqual(["0050"]);
    expect(report.candidateTickers).toEqual([{ ticker: "0050", marketCode: "TW" }]);
    expect(report.requestedTickerAvailability).toEqual([
      expect.objectContaining({ tickerId: "TW:0050", eligible: true, reason: null }),
    ]);
    expect(report.query).toEqual(expect.objectContaining({
      selection: "manualTickers",
      tickerMode: "custom",
      tickerIds: ["TW:0050"],
    }));
    expect(report.tradeMarkers).toEqual([
      expect.objectContaining({ ticker: "0050", marketCode: "TW", kind: "buy" }),
    ]);
  });

  it("keeps an empty manual custom ticker scope empty while preserving eligible picker options", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedSnapshots([
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 500, unrealizedPnlNative: 500, marketValue: 1500, valueNative: 1500 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 10, unrealizedPnlNative: 10, marketValue: 1010, valueNative: 1010 }),
    ]);

    const snapshotSpy = vi.spyOn(persistence, "listUnrealizedPnlAnalysisSnapshots");

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      selection: "manualTickers",
      tickerMode: "custom",
      tickerIds: [],
    });

    expect(snapshotSpy).toHaveBeenCalledTimes(1);
    expect(snapshotSpy).toHaveBeenCalledWith("user-1", expect.objectContaining({
      tickers: undefined,
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    }));
    expect(report.query).toEqual(expect.objectContaining({
      selection: "manualTickers",
      tickerMode: "custom",
      tickerIds: [],
    }));
    expect(report.deepLink).toContain("tickerMode=custom");
    expect(report.deepLink).not.toContain("tickerIds=");
    expect(report.rankings.map((row) => `${row.marketCode}:${row.ticker}`)).toEqual(["TW:2330", "TW:0050"]);
    expect(report.summary).toEqual(expect.objectContaining({
      startDate: null,
      endDate: null,
      startUnrealizedPnlAmount: null,
      endUnrealizedPnlAmount: null,
      periodChangeAmount: null,
      currentOpenTickerCount: 0,
      includedTickerCount: 0,
    }));
    expect(report.portfolioSeries).toEqual([]);
    expect(report.tickerSeries).toEqual([]);
    expect(report.tickerComposition).toEqual([]);
    expect(report.candidateTickers).toEqual([]);
    expect(report.requestedTickerAvailability).toEqual([]);
    expect(report.dataHealth.snapshotRowCount).toBe(0);
  });

  it("keeps an empty top-driver custom ticker scope empty while preserving eligible rankings", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedSnapshots([
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 500, unrealizedPnlNative: 500, marketValue: 1500, valueNative: 1500 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 10, unrealizedPnlNative: 10, marketValue: 1010, valueNative: 1010 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      selection: "topDrivers",
      tickerMode: "custom",
      tickerIds: [],
    });

    expect(report.query).toEqual(expect.objectContaining({
      selection: "topDrivers",
      tickerMode: "custom",
      tickerIds: [],
    }));
    expect(report.rankings.map((row) => `${row.marketCode}:${row.ticker}`)).toEqual(["TW:2330", "TW:0050"]);
    expect(report.summary).toEqual(expect.objectContaining({
      startDate: null,
      endDate: null,
      startUnrealizedPnlAmount: null,
      endUnrealizedPnlAmount: null,
      periodChangeAmount: null,
      currentOpenTickerCount: 0,
      includedTickerCount: 0,
    }));
    expect(report.portfolioSeries).toEqual([]);
    expect(report.tickerSeries).toEqual([]);
    expect(report.tickerComposition).toEqual([]);
    expect(report.candidateTickers).toEqual([]);
    expect(report.dataHealth.snapshotRowCount).toBe(0);
  });

  it.each([
    ["omitted ticker mode", undefined],
    ["explicit all-eligible ticker mode", "allEligible" as const],
  ])("normalizes ticker IDs to custom mode for %s", async (_label, tickerMode) => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedSnapshots([
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 500, unrealizedPnlNative: 500, marketValue: 1500, valueNative: 1500 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 10, unrealizedPnlNative: 10, marketValue: 1010, valueNative: 1010 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      positionStatus: "includeClosed",
      tickerIds: [{ ticker: "0050", marketCode: "TW" }],
      ...(tickerMode ? { tickerMode } : {}),
    });

    expect(report.query).toEqual(expect.objectContaining({
      tickerMode: "custom",
      tickerIds: ["TW:0050"],
    }));
    expect(report.deepLink).toContain("tickerIds=TW%3A0050");
    expect(report.deepLink).toContain("tickerMode=custom");
    expect(report.summary.includedTickerCount).toBe(1);
    expect(report.tickerComposition.map((row) => row.ticker)).toEqual(["0050"]);
  });

  it("keeps manual custom tickers eligible when the range ends after the latest snapshot", async () => {
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedSnapshots([
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 10, unrealizedPnlNative: 10, marketValue: 1010, valueNative: 1010 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-02-01",
      positionStatus: "includeClosed",
      selection: "manualTickers",
      tickerMode: "custom",
      tickerIds: [{ ticker: "0050", marketCode: "TW" }],
    });

    expect(report.candidateTickers).toEqual([{ ticker: "0050", marketCode: "TW" }]);
    expect(report.requestedTickerAvailability).toEqual([
      expect.objectContaining({ tickerId: "TW:0050", eligible: true, reason: null }),
    ]);
    expect(report.tickerSeries.map((point) => point.date)).toEqual(["2026-01-01", "2026-01-31"]);
  });

  it("caps manual all-eligible candidates at the safety limit with structured warnings", async () => {
    const snapshots: HoldingSnapshot[] = [];
    for (let index = 0; index < 205; index += 1) {
      const ticker = `T${String(index).padStart(3, "0")}`;
      await seedInstrument({ ticker, marketCode: "US", instrumentType: "STOCK", name: `Ticker ${index}` });
      snapshots.push(
        makeSnapshot({
          ticker,
          marketCode: "US",
          currency: "USD",
          snapshotDate: "2026-01-01",
          unrealizedPnl: 0,
          unrealizedPnlNative: 0,
          marketValue: 1000,
          valueNative: 1000,
        }),
        makeSnapshot({
          ticker,
          marketCode: "US",
          currency: "USD",
          snapshotDate: "2026-01-31",
          unrealizedPnl: index,
          unrealizedPnlNative: index,
          marketValue: 1000 + index,
          valueNative: 1000 + index,
        }),
      );
    }
    await seedSnapshots(snapshots);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      markets: ["US"],
      selection: "manualTickers",
      tickerMode: "allEligible",
      positionStatus: "includeClosed",
      reportingCurrency: "USD",
    });

    expect(report.candidateTickers).toHaveLength(200);
    expect(report.tickerComposition).toHaveLength(205);
    expect(new Set(report.tickerSeries.map((point) => `${point.marketCode}:${point.ticker}`)).size).toBe(200);
    expect(report.warningFacts).toEqual({
      noisyChartLineCount: 200,
      noisyChartThreshold: 20,
      candidateLimitApplied: true,
      candidateLimit: 200,
      omittedEligibleCount: 5,
    });
    expect(report.candidateTickers[0]).toEqual({ marketCode: "US", ticker: "T005" });
    expect(report.candidateTickers.at(-1)).toEqual({ marketCode: "US", ticker: "T204" });
  });

  it("reports unavailable requested custom tickers with stable reason codes", async () => {
    await seedInstrument({ ticker: "AAPL", marketCode: "US", instrumentType: "STOCK", name: "Apple" });
    await seedSnapshots([
      makeSnapshot({
        ticker: "AAPL",
        marketCode: "US",
        currency: "USD",
        snapshotDate: "2026-01-31",
        marketValue: null,
        valueNative: null,
        unrealizedPnl: null,
        unrealizedPnlNative: null,
      }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      markets: ["US"],
      selection: "manualTickers",
      tickerMode: "custom",
      tickerIds: [
        { marketCode: "US", ticker: "AAPL" },
        { marketCode: "US", ticker: "MISSING" },
      ],
      positionStatus: "includeClosed",
      reportingCurrency: "USD",
    });

    expect(report.candidateTickers).toEqual([
      { marketCode: "US", ticker: "AAPL" },
      { marketCode: "US", ticker: "MISSING" },
    ]);
    expect(report.tickerSeries).toEqual([]);
    expect(report.tickerComposition).toEqual([
      expect.objectContaining({ ticker: "AAPL", endUnrealizedPnlAmount: null, contributionSharePercent: null }),
    ]);
    expect(report.requestedTickerAvailability).toEqual([
      expect.objectContaining({
        tickerId: "US:AAPL",
        marketCode: "US",
        ticker: "AAPL",
        instrumentName: "Apple",
        eligible: false,
        reason: "valuationUnavailable",
      }),
      expect.objectContaining({
        tickerId: "US:MISSING",
        marketCode: "US",
        ticker: "MISSING",
        instrumentName: null,
        eligible: false,
        reason: "invalidTicker",
      }),
    ]);
  });

  it("reports requested saved tickers excluded by position scope as not in scope", async () => {
    await seedInstrument({ ticker: "TSLA", marketCode: "US", instrumentType: "STOCK", name: "Tesla" });
    await seedSnapshots([
      makeSnapshot({
        ticker: "TSLA",
        marketCode: "US",
        currency: "USD",
        snapshotDate: "2026-01-01",
        quantity: 5,
        unrealizedPnl: 80,
        unrealizedPnlNative: 80,
        marketValue: 1080,
        valueNative: 1080,
      }),
      makeSnapshot({
        ticker: "TSLA",
        marketCode: "US",
        currency: "USD",
        snapshotDate: "2026-01-31",
        quantity: 0,
        unrealizedPnl: 0,
        unrealizedPnlNative: 0,
        marketValue: 0,
        valueNative: 0,
        costBasis: 0,
        costBasisNative: 0,
      }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      markets: ["US"],
      selection: "manualTickers",
      tickerMode: "custom",
      tickerIds: [{ marketCode: "US", ticker: "TSLA" }],
      positionStatus: "openOnly",
      reportingCurrency: "USD",
    });

    expect(report.candidateTickers).toEqual([{ marketCode: "US", ticker: "TSLA" }]);
    expect(report.tickerComposition).toEqual([]);
    expect(report.requestedTickerAvailability).toEqual([
      expect.objectContaining({ tickerId: "US:TSLA", eligible: false, reason: "notInScope" }),
    ]);
  });

  it("keeps top-driver candidate order in ranked order", async () => {
    await seedInstrument({ ticker: "0001", marketCode: "TW", instrumentType: "STOCK", name: "Alpha" });
    await seedInstrument({ ticker: "9999", marketCode: "TW", instrumentType: "STOCK", name: "Zeta" });
    await seedSnapshots([
      makeSnapshot({ ticker: "0001", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "0001", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 10, unrealizedPnlNative: 10 }),
      makeSnapshot({ ticker: "9999", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "9999", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 50, unrealizedPnlNative: 50 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      selection: "topDrivers",
      drivers: 5,
    });

    expect(report.rankings.map((row) => `${row.marketCode}:${row.ticker}`)).toEqual(["TW:9999", "TW:0001"]);
    expect(report.candidateTickers.map((row) => `${row.marketCode}:${row.ticker}`)).toEqual(["TW:9999", "TW:0001"]);
    expect(report.tickerComposition.map((row) => `${row.marketCode}:${row.ticker}`)).toEqual(["TW:9999", "TW:0001"]);
  });

  it("counts trade markers for ranking rows outside the selected chart lines", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    const store = await persistence.loadStore("user-1");
    await seedTrades([
      makeTrade(store, { ticker: "2330", marketCode: "TW", tradeDate: "2026-01-02", type: "BUY", quantity: 10 }),
      makeTrade(store, { ticker: "0050", marketCode: "TW", tradeDate: "2026-01-02", type: "BUY", quantity: 20 }),
    ]);
    await seedSnapshots([
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-02", unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 500, unrealizedPnlNative: 500, marketValue: 1500, valueNative: 1500 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-02", quantity: 20, unrealizedPnl: 0, unrealizedPnlNative: 0 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", quantity: 20, unrealizedPnl: 20, unrealizedPnlNative: 20, marketValue: 2020, valueNative: 2020 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-02",
      toDate: "2026-01-31",
      drivers: 1 as 5,
      positionStatus: "includeClosed",
    });

    expect(report.candidateTickers).toEqual([{ ticker: "2330", marketCode: "TW" }]);
    expect(report.tickerComposition.map((row) => row.ticker)).toEqual(["2330", "0050"]);
    expect(report.tradeMarkers).toEqual([
      expect.objectContaining({ ticker: "2330", marketCode: "TW", kind: "buy" }),
    ]);
    expect(report.rankings.map((row) => [row.ticker, row.tradeMarkerCount])).toEqual([
      ["2330", 1],
      ["0050", 1],
    ]);
  });

  it("treats zero-quantity sold-out FX rows as deterministic zero exposure", async () => {
    await seedInstrument({ ticker: "AAPL", marketCode: "US", instrumentType: "STOCK", name: "Apple" });
    await seedSnapshots([
      makeSnapshot({
        ticker: "AAPL",
        marketCode: "US",
        currency: "USD",
        snapshotDate: "2026-01-02",
        quantity: 2,
        costBasis: 300,
        costBasisNative: 10,
        marketValue: 360,
        valueNative: 12,
        unrealizedPnl: 60,
        unrealizedPnlNative: 2,
      }),
      makeSnapshot({
        ticker: "AAPL",
        marketCode: "US",
        currency: "USD",
        snapshotDate: "2026-01-31",
        quantity: 0,
        costBasis: 0,
        costBasisNative: 0,
        marketValue: null,
        valueNative: null,
        unrealizedPnl: null,
        unrealizedPnlNative: null,
      }),
    ]);
    await seedFxRates([{ date: "2026-01-02", baseCurrency: "USD", quoteCurrency: "TWD", rate: 30, source: "test" }]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-02",
      toDate: "2026-01-31",
      positionStatus: "includeClosed",
      reportingCurrency: "TWD",
    });

    expect(report.rankings).toEqual([
      expect.objectContaining({ ticker: "AAPL", marketCode: "US", endUnrealizedPnlAmount: 0, latestQuantity: 0 }),
    ]);
    expect(report.tickerSeries.at(-1)).toEqual(expect.objectContaining({
      ticker: "AAPL",
      marketCode: "US",
      quantity: 0,
      unrealizedPnlAmount: 0,
      marketValueAmount: 0,
      costBasisAmount: 0,
      fxAvailable: true,
    }));
    expect(report.dataHealth.missingFxRowCount).toBe(0);
    expect(report.dataHealth.nullUnrealizedRowCount).toBe(0);
    expect(report.dataHealth.unavailableRowCount).toBe(0);
  });

  it("uses actual boundary buckets for period change instead of skipping null boundaries", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedSnapshots([
      makeSnapshot({
        snapshotDate: "2026-01-01",
        closePrice: null,
        marketValue: null,
        valueNative: null,
        unrealizedPnl: null,
        unrealizedPnlNative: null,
        providerSource: null,
      }),
      makeSnapshot({ snapshotDate: "2026-01-15", unrealizedPnl: 100, unrealizedPnlNative: 100, marketValue: 1100, valueNative: 1100 }),
      makeSnapshot({ snapshotDate: "2026-01-31", unrealizedPnl: 200, unrealizedPnlNative: 200, marketValue: 1200, valueNative: 1200 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      positionStatus: "includeClosed",
    });

    expect(report.summary.startDate).toBe("2026-01-01");
    expect(report.summary.startUnrealizedPnlAmount).toBeNull();
    expect(report.summary.periodChangeAmount).toBeNull();
    expect(report.rankings[0]?.startUnrealizedPnlAmount).toBeNull();
    expect(report.rankings[0]?.periodChangeAmount).toBeNull();
  });

  it("sorts unavailable period changes after real movers", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedSnapshots([
      makeSnapshot({
        ticker: "2330",
        marketCode: "TW",
        snapshotDate: "2026-01-01",
        closePrice: null,
        marketValue: null,
        valueNative: null,
        unrealizedPnl: null,
        unrealizedPnlNative: null,
        providerSource: null,
      }),
      makeSnapshot({ ticker: "2330", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 200, unrealizedPnlNative: 200, marketValue: 1200, valueNative: 1200 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-01", unrealizedPnl: 10, unrealizedPnlNative: 10, marketValue: 1010, valueNative: 1010 }),
      makeSnapshot({ ticker: "0050", marketCode: "TW", snapshotDate: "2026-01-31", unrealizedPnl: 20, unrealizedPnlNative: 20, marketValue: 1020, valueNative: 1020 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      positionStatus: "includeClosed",
    });

    expect(report.rankings.map((row) => [row.ticker, row.periodChangeAmount])).toEqual([
      ["0050", 10],
      ["2330", null],
    ]);
    expect(report.candidateTickers[0]).toEqual({ ticker: "0050", marketCode: "TW" });
  });

  it("does not widen an explicit unknown account scope to all accounts", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedSnapshots([
      makeSnapshot({ snapshotDate: "2026-01-31", unrealizedPnl: 100, unrealizedPnlNative: 100, marketValue: 1100, valueNative: 1100 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      accountIds: ["missing-account"],
    });

    expect(report.query.accountIds).toEqual(["missing-account"]);
    expect(report.portfolioSeries).toEqual([]);
    expect(report.tickerSeries).toEqual([]);
    expect(report.rankings).toEqual([]);
    expect(report.dataHealth.snapshotRowCount).toBe(0);
  });

  it("does not show deleted-account snapshots when no active account scope remains", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedSnapshots([
      makeSnapshot({ accountId: "acc-1", snapshotDate: "2026-01-31", unrealizedPnl: 100, unrealizedPnlNative: 100, marketValue: 1100, valueNative: 1100 }),
    ]);
    const store = await persistence.loadStore("user-1");
    store.accounts = [];
    await persistence.saveStore(store);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });

    expect(report.query.accountIds).toEqual([]);
    expect(report.portfolioSeries).toEqual([]);
    expect(report.rankings).toEqual([]);
    expect(report.dataHealth.snapshotRowCount).toBe(0);
  });

  it("falls back to TWD when the stored reporting currency is invalid", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedSnapshots([
      makeSnapshot({ snapshotDate: "2026-01-31", unrealizedPnl: 100, unrealizedPnlNative: 100, marketValue: 1100, valueNative: 1100 }),
    ]);
    await persistence._setUserPreferences("user-1", { reportingCurrency: "BAD" });

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
    });

    expect(report.summary.reportingCurrency).toBe("TWD");
    expect(report.portfolioSeries).toEqual([
      expect.objectContaining({ date: "2026-01-31", unrealizedPnlAmount: 100 }),
    ]);
  });

  it("emits route-state-compatible deep links for custom dates", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedSnapshots([
      makeSnapshot({ snapshotDate: "2026-01-31", unrealizedPnl: 100, unrealizedPnlNative: 100, marketValue: 1100, valueNative: 1100 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "monthly",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      drivers: 10,
      reportingCurrency: "USD",
    });

    expect(report.deepLink).toContain("range=CUSTOM");
    expect(report.deepLink).toContain("fromDate=2026-01-01");
    expect(report.deepLink).toContain("toDate=2026-01-31");
    expect(report.deepLink).toContain("granularity=monthly");
    expect(report.deepLink).toContain("drivers=10");
    expect(report.deepLink).toContain("positionStatus=openOnly");
    expect(report.deepLink).toContain("reportingCurrency=USD");
    expect(report.deepLink).toContain("includeProvisional=false");
    expect(report.deepLink).not.toContain("rankingLimit=");

    const halfOpenReport = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "monthly",
      toDate: "2026-01-31",
    });
    expect(halfOpenReport.deepLink).toContain("range=CUSTOM");
    expect(halfOpenReport.deepLink).toContain("toDate=2026-01-31");
  });

  it("strips unknown route query fields while keeping the new state model", () => {
    const parsed = unrealizedPnlAnalysisRouteQuerySchema.parse({
      selection: "manualTickers",
      tickerMode: "allEligible",
      selectionMode: "manual",
      comparisonLineCount: "99",
    });

    expect(parsed).toEqual({
      selection: "manualTickers",
      tickerMode: "allEligible",
    });
    expect(parsed).not.toHaveProperty("selectionMode");
    expect(parsed).not.toHaveProperty("comparisonLineCount");
  });

  it("emits preference-stable deep links for default-valued presentation fields", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedSnapshots([
      makeSnapshot({ snapshotDate: "2026-01-31", unrealizedPnl: 100, unrealizedPnlNative: 100, marketValue: 1100, valueNative: 1100 }),
    ]);

    const report = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "weekly",
      range: "3M",
      drivers: 5,
      positionStatus: "openOnly",
      reportingCurrency: "TWD",
      includeProvisional: false,
    });

    expect(report.deepLink).toContain("granularity=weekly");
    expect(report.deepLink).not.toContain("drivers=");
    expect(report.deepLink).toContain("positionStatus=openOnly");
    expect(report.deepLink).toContain("reportingCurrency=TWD");
    expect(report.deepLink).toContain("includeProvisional=false");
  });

  it("rejects invalid analysis ranges before range-bound resolution", () => {
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ range: "BAD" }).success).toBe(false);
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ range: "0M" }).success).toBe(false);
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ range: "241M" }).success).toBe(false);
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ range: "51Y" }).success).toBe(false);
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ range: "3M" }).success).toBe(true);
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ range: "ALL" }).success).toBe(true);
  });

  it("returns validation failures for malformed selected ticker refs", () => {
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ tickerIds: "BAD" }).success).toBe(false);
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ tickerIds: "TW" }).success).toBe(false);
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ tickerIds: "BAD:2330" }).success).toBe(false);
    expect(unrealizedPnlAnalysisRouteQuerySchema.safeParse({ tickerIds: "TW:2330" }).success).toBe(true);
  });

  it("excludes all-null FX and provisional rows from chartable candidates", async () => {
    await seedInstrument({ ticker: "AAPL", marketCode: "US", instrumentType: "STOCK", name: "Apple" });
    await seedInstrument({ ticker: "0050", marketCode: "TW", instrumentType: "ETF", name: "Taiwan 50" });
    await seedSnapshots([
      makeSnapshot({
        ticker: "AAPL",
        marketCode: "US",
        currency: "USD",
        snapshotDate: "2026-02-03",
        costBasis: 100,
        costBasisNative: 10,
        marketValue: 120,
        valueNative: 12,
        unrealizedPnl: 20,
        unrealizedPnlNative: 2,
      }),
      makeSnapshot({
        ticker: "0050",
        marketCode: "TW",
        snapshotDate: "2026-02-03",
        isProvisional: true,
        closePrice: null,
        marketValue: null,
        valueNative: null,
        unrealizedPnl: null,
        unrealizedPnlNative: null,
        providerSource: null,
      }),
    ]);

    const withoutProvisional = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-02-03",
      toDate: "2026-02-03",
      positionStatus: "includeClosed",
      reportingCurrency: "TWD",
    });
    expect(withoutProvisional.dataHealth.provisionalRowCount).toBe(0);
    expect(withoutProvisional.dataHealth.snapshotRowCount).toBe(1);
    expect(withoutProvisional.dataHealth.missingFxRowCount).toBe(1);
    expect(withoutProvisional.dataHealth.nullUnrealizedRowCount).toBe(1);
    expect(withoutProvisional.dataHealth.unavailableRowCount).toBe(1);
    expect(withoutProvisional.portfolioSeries).toEqual([
      expect.objectContaining({
        date: "2026-02-03",
        unrealizedPnlAmount: null,
        marketValueAmount: null,
      }),
    ]);

    const withProvisional = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2026-02-03",
      toDate: "2026-02-03",
      positionStatus: "includeClosed",
      reportingCurrency: "TWD",
      includeProvisional: true,
    });
    expect(withProvisional.dataHealth.provisionalRowCount).toBe(1);
    expect(withProvisional.dataHealth.snapshotRowCount).toBe(2);
    expect(withProvisional.dataHealth.missingFxRowCount).toBe(1);
    expect(withProvisional.dataHealth.nullUnrealizedRowCount).toBe(2);
    expect(withProvisional.dataHealth.unavailableRowCount).toBe(2);
    expect(withProvisional.portfolioSeries).toEqual([
      expect.objectContaining({
        date: "2026-02-03",
        unrealizedPnlAmount: null,
        marketValueAmount: null,
      }),
    ]);
  });

  it("uses period-end bucket dates for daily, weekly, monthly, and yearly granularity", async () => {
    await seedInstrument({ ticker: "2330", marketCode: "TW", instrumentType: "STOCK", name: "TSMC" });
    await seedSnapshots([
      makeSnapshot({ snapshotDate: "2025-12-31", unrealizedPnl: 10, unrealizedPnlNative: 10, marketValue: 1010, valueNative: 1010 }),
      makeSnapshot({ snapshotDate: "2026-01-05", unrealizedPnl: 20, unrealizedPnlNative: 20, marketValue: 1020, valueNative: 1020 }),
      makeSnapshot({ snapshotDate: "2026-01-08", unrealizedPnl: 30, unrealizedPnlNative: 30, marketValue: 1030, valueNative: 1030 }),
      makeSnapshot({ snapshotDate: "2026-01-16", unrealizedPnl: 40, unrealizedPnlNative: 40, marketValue: 1040, valueNative: 1040 }),
    ]);

    const daily = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "daily",
      fromDate: "2025-12-31",
      toDate: "2026-01-16",
      positionStatus: "includeClosed",
    });
    const weekly = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "weekly",
      fromDate: "2025-12-31",
      toDate: "2026-01-16",
      positionStatus: "includeClosed",
    });
    const monthly = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "monthly",
      fromDate: "2025-12-31",
      toDate: "2026-01-16",
      positionStatus: "includeClosed",
    });
    const yearly = await buildUnrealizedPnlAnalysis(app, "user-1", {
      granularity: "yearly",
      fromDate: "2025-12-31",
      toDate: "2026-01-16",
      positionStatus: "includeClosed",
    });

    expect(daily.portfolioSeries.map((point) => point.date)).toEqual(["2025-12-31", "2026-01-05", "2026-01-08", "2026-01-16"]);
    expect(weekly.portfolioSeries.map((point) => point.date)).toEqual(["2025-12-31", "2026-01-08", "2026-01-16"]);
    expect(monthly.portfolioSeries.map((point) => point.date)).toEqual(["2025-12-31", "2026-01-16"]);
    expect(yearly.portfolioSeries.map((point) => point.date)).toEqual(["2025-12-31", "2026-01-16"]);
  });
});
