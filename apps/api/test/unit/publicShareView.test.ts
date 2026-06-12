import { describe, expect, it } from "vitest";
import type { QuoteSnapshot } from "@vakwen/domain";
import type { Store } from "../../src/types/store.js";
import { createStore } from "../../src/services/store.js";
import { buildPublicShareView } from "../../src/services/publicShareView.js";

function seedStoreWithHoldings(
  holdings: Array<{ accountId?: string; ticker: string; quantity: number; costBasisAmount: number; currency: "TWD" | "USD" | "AUD" }>,
): Store {
  const store = createStore();
  store.marketData.instruments = [
    { ticker: "2330", instrumentType: "STOCK", marketCode: "TW", name: "TSMC", isProvisional: false, lastSyncedAt: null },
    { ticker: "AAPL", instrumentType: "STOCK", marketCode: "US", name: "Apple Inc.", isProvisional: false, lastSyncedAt: null },
    { ticker: "BHP", instrumentType: "STOCK", marketCode: "AU", name: "BHP Group", isProvisional: false, lastSyncedAt: null },
  ];
  store.accounting.projections.holdings = holdings.map((h) => ({
    accountId: h.accountId ?? "acc-1",
    ticker: h.ticker,
    quantity: h.quantity,
    costBasisAmount: h.costBasisAmount,
    currency: h.currency,
  }));
  return store;
}

function quote(ticker: string, close: number): QuoteSnapshot {
  return {
    ticker,
    close,
    previousClose: null,
    change: null,
    changePercent: null,
    asOf: "2026-04-18",
    source: "test",
    isProvisional: false,
  };
}

describe("buildPublicShareView", () => {
  const expiresAt = "2026-05-18T00:00:00.000Z";
  const ownerDisplayName = "Jane Owner";

  it("filters zero-quantity holdings and discloses holdings with missing quotes", () => {
    // Arrange
    const store = seedStoreWithHoldings([
      { ticker: "2330", quantity: 100, costBasisAmount: 50_000, currency: "TWD" },
      { ticker: "0050", quantity: 0, costBasisAmount: 20_000, currency: "TWD" }, // zero-qty — filtered
      { ticker: "NODATA", quantity: 50, costBasisAmount: 10_000, currency: "TWD" }, // no quote — omitted
    ]);
    const quotes: Record<string, QuoteSnapshot | null> = {
      "2330": quote("2330", 600), // 100 × 600 = 60_000
      NODATA: null,
    };

    // Act
    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    // Assert
    expect(view.holdings).toHaveLength(2);
    expect(view.holdings[0]!.ticker).toBe("2330");
    expect(view.holdings[0]).toEqual(expect.objectContaining({
      instrumentName: "TSMC",
      marketValueAmount: 60_000,
      allocationPercent: null,
      quoteStatus: "current",
    }));
    expect(view.holdings[1]).toEqual(expect.objectContaining({
      ticker: "NODATA",
      marketValueAmount: null,
      allocationPercent: null,
      quoteStatus: "missing",
    }));
    expect(view.dataHealth).toEqual({
      holdingCount: 2,
      missingQuoteCount: 1,
      provisionalQuoteCount: 0,
    });
  });

  it("sorts holdings by market value DESC", () => {
    // Arrange
    const store = seedStoreWithHoldings([
      { ticker: "SMALL", quantity: 10, costBasisAmount: 100, currency: "TWD" },
      { ticker: "BIG", quantity: 100, costBasisAmount: 10_000, currency: "TWD" },
      { ticker: "MID", quantity: 50, costBasisAmount: 5_000, currency: "TWD" },
    ]);
    const quotes: Record<string, QuoteSnapshot | null> = {
      SMALL: quote("SMALL", 10), // 100
      BIG: quote("BIG", 200), // 20_000
      MID: quote("MID", 100), // 5_000
    };

    // Act
    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    // Assert
    expect(view.holdings.map((h) => h.ticker)).toEqual(["BIG", "MID", "SMALL"]);
  });

  it("never exposes costBasisAmount in the output", () => {
    // Arrange
    const store = seedStoreWithHoldings([
      { ticker: "2330", quantity: 100, costBasisAmount: 50_000, currency: "TWD" },
    ]);
    const quotes = { "2330": quote("2330", 600) };

    // Act
    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    // Assert — recursive deep scan for any key containing "cost" or "basis"
    const flat = JSON.stringify(view);
    expect(flat).not.toMatch(/cost[-_]?basis/i);
    expect(flat).not.toMatch(/"costBasisAmount"/);
    expect(flat).not.toMatch(/"averageCostPerShare"/);
    expect(flat).not.toMatch(/"currentUnitPrice"/);
    expect(flat).not.toMatch(/"unrealizedPnlAmount"/);
    for (const holding of view.holdings) {
      expect(Object.keys(holding)).not.toContain("costBasisAmount");
      expect(Object.keys(holding)).not.toContain("averageCostPerShare");
      expect(Object.keys(holding)).not.toContain("currentUnitPrice");
      expect(Object.keys(holding)).not.toContain("unrealizedPnlAmount");
    }
  });

  it("returns per-currency totals and returns (no base-currency conversion)", () => {
    // Arrange
    const store = seedStoreWithHoldings([
      { ticker: "2330", quantity: 100, costBasisAmount: 50_000, currency: "TWD" }, // mv 60_000 TWD
      { ticker: "AAPL", quantity: 10, costBasisAmount: 1_500, currency: "USD" }, // mv 2_000 USD
    ]);
    const quotes: Record<string, QuoteSnapshot | null> = {
      "2330": quote("2330", 600),
      AAPL: quote("AAPL", 200),
    };

    // Act
    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    // Assert
    const totals = new Map(view.summary.totalValueByCurrency.map((r) => [r.currency, r.amount]));
    expect(totals.get("TWD")).toBe(60_000);
    expect(totals.get("USD")).toBe(2_000);

    const returns = new Map(view.summary.returnByCurrency.map((r) => [r.currency, r.returnPercent]));
    // (60_000 - 50_000) / 50_000 = 20%
    expect(returns.get("TWD")).toBeCloseTo(20, 2);
    // (2_000 - 1_500) / 1_500 = 33.33%
    expect(returns.get("USD")).toBeCloseTo(33.33, 1);
  });

  it("handles an empty portfolio with empty summary arrays and null quoteAsOf", () => {
    // Arrange
    const store = seedStoreWithHoldings([]);
    const quotes: Record<string, QuoteSnapshot | null> = {};

    // Act
    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    // Assert
    expect(view.holdings).toEqual([]);
    expect(view.summary.totalValueByCurrency).toEqual([]);
    expect(view.summary.returnByCurrency).toEqual([]);
    expect(view.quoteAsOf).toBeNull();
  });

  it("keeps all-quotes-missing portfolios visible as unavailable holdings", () => {
    // Arrange
    const store = seedStoreWithHoldings([
      { ticker: "2330", quantity: 100, costBasisAmount: 50_000, currency: "TWD" },
    ]);
    const quotes = { "2330": null };

    // Act
    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    // Assert
    expect(view.holdings).toEqual([
      expect.objectContaining({
        ticker: "2330",
        instrumentName: "TSMC",
        marketValueAmount: null,
        allocationPercent: null,
        quoteStatus: "missing",
      }),
    ]);
    expect(view.holdingGroups).toEqual([
      expect.objectContaining({
        ticker: "2330",
        instrumentName: "TSMC",
        marketValueAmount: null,
        allocationPercent: null,
        quoteStatus: "missing",
      }),
    ]);
    expect(view.summary.totalValueByCurrency).toEqual([]);
    expect(view.summary.returnByCurrency).toEqual([]);
    expect(view.dataHealth.missingQuoteCount).toBe(1);
    expect(view.quoteAsOf).toBeNull();
  });

  it("does not publish allocation or return percentages when a currency has missing quotes", () => {
    const store = seedStoreWithHoldings([
      { ticker: "2330", quantity: 100, costBasisAmount: 50_000, currency: "TWD" },
      { ticker: "NODATA", quantity: 50, costBasisAmount: 10_000, currency: "TWD" },
    ]);
    const quotes: Record<string, QuoteSnapshot | null> = {
      "2330": quote("2330", 600),
      NODATA: null,
    };

    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    expect(view.summary.totalValueByCurrency).toEqual([{ currency: "TWD", amount: 60_000 }]);
    expect(view.summary.returnByCurrency).toEqual([]);
    expect(view.holdings).toEqual([
      expect.objectContaining({
        ticker: "2330",
        marketValueAmount: 60_000,
        allocationPercent: null,
        quoteStatus: "current",
      }),
      expect.objectContaining({
        ticker: "NODATA",
        marketValueAmount: null,
        allocationPercent: null,
        quoteStatus: "missing",
      }),
    ]);
  });

  it("computes allocationPercent within each currency group", () => {
    // Arrange — two TWD holdings: 60_000 and 40_000
    const store = seedStoreWithHoldings([
      { ticker: "AAA", quantity: 100, costBasisAmount: 50_000, currency: "TWD" },
      { ticker: "BBB", quantity: 50, costBasisAmount: 30_000, currency: "TWD" },
    ]);
    const quotes: Record<string, QuoteSnapshot | null> = {
      AAA: quote("AAA", 600), // 60_000
      BBB: quote("BBB", 800), // 40_000
    };

    // Act
    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    // Assert — sum of allocations within a currency equals 100
    const allocations = view.holdings.map((h) => h.allocationPercent);
    expect(allocations).not.toContain(null);
    const sum = allocations.reduce<number>((acc, allocation) => acc + allocation!, 0);
    expect(sum).toBeCloseTo(100, 1);
    expect(view.holdings[0]!.allocationPercent).toBeCloseTo(60, 1);
    expect(view.holdings[1]!.allocationPercent).toBeCloseTo(40, 1);
  });

  it("uses the freshest quote.asOf across included holdings", () => {
    // Arrange
    const store = seedStoreWithHoldings([
      { ticker: "AAA", quantity: 100, costBasisAmount: 100, currency: "TWD" },
      { ticker: "BBB", quantity: 100, costBasisAmount: 100, currency: "TWD" },
    ]);
    const quotes: Record<string, QuoteSnapshot | null> = {
      AAA: { ...quote("AAA", 10), asOf: "2026-04-17" },
      BBB: { ...quote("BBB", 10), asOf: "2026-04-18" },
    };

    // Act
    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    // Assert
    expect(view.quoteAsOf).toBe("2026-04-18");
  });

  it("uses market-qualified quotes for cross-listed bare tickers", () => {
    const store = seedStoreWithHoldings([
      { accountId: "acc-aud", ticker: "BHP", quantity: 10, costBasisAmount: 400, currency: "AUD" },
      { accountId: "acc-usd", ticker: "BHP", quantity: 10, costBasisAmount: 500, currency: "USD" },
    ]);
    store.accounts.push(
      {
        id: "acc-aud",
        name: "AUD",
        userId: "user-1",
        feeProfileId: store.feeProfiles[0]!.id,
        defaultCurrency: "AUD",
        accountType: "broker",
      },
      {
        id: "acc-usd",
        name: "USD",
        userId: "user-1",
        feeProfileId: store.feeProfiles[0]!.id,
        defaultCurrency: "USD",
        accountType: "broker",
      },
    );
    const quotes: Record<string, QuoteSnapshot | null> = {
      "BHP:AU": { ...quote("BHP", 44), marketCode: "AU" },
      "BHP:US": { ...quote("BHP", 58), marketCode: "US" },
    };

    const view = buildPublicShareView(store, quotes, ownerDisplayName, expiresAt);

    const totals = new Map(view.summary.totalValueByCurrency.map((row) => [row.currency, row.amount]));
    expect(totals.get("AUD")).toBe(440);
    expect(totals.get("USD")).toBe(580);
  });
});
