import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tw-portfolio/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tw-portfolio/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "dev_bypass" as const },
  };
});

import {
  calculateBuyFees,
  calculateSellFees,
  roundToDecimal,
  type DailyBar,
  type FeeProfile,
} from "@tw-portfolio/domain";
import { buildApp } from "../../src/app.js";
// KZO-163: provider class lives at providers/mockFinmind.ts; method renamed fetchDailyBars → fetchBars.
import { MockFinMindMarketDataProvider } from "../../src/services/market-data/providers/index.js";
import { RateLimitedError } from "../../src/services/market-data/types.js";
import { _resetMarketDataPriceBuckets } from "../../src/lib/marketDataPriceRateLimit.js";

let app: Awaited<ReturnType<typeof buildApp>>;
const authHeaders = { "x-user-id": "user-1" };

function seedDailyBars(bars: DailyBar[]): void {
  if (!("_seedDailyBars" in app.persistence) || typeof app.persistence._seedDailyBars !== "function") {
    throw new Error("memory persistence _seedDailyBars helper is unavailable");
  }
  app.persistence._seedDailyBars(bars);
}

describe("transaction form polish routes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", seedMemoryCatalog: true });
    _resetMarketDataPriceBuckets();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    _resetMarketDataPriceBuckets();
    if (app) await app.close();
  });

  it("PATCH /accounts/:id allows name-only updates", async () => {
    const before = await app.persistence.loadStore("user-1");
    const original = before.accounts.find((account) => account.id === "acc-1");
    expect(original).toBeDefined();

    const response = await app.inject({
      method: "PATCH",
      url: "/accounts/acc-1",
      headers: authHeaders,
      payload: { name: "Renamed Account" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        id: "acc-1",
        name: "Renamed Account",
        feeProfileId: original?.feeProfileId,
      }),
    );
  });

  it("GET /market-data/price returns an exact DB bar when present", async () => {
    seedDailyBars([
      {
        ticker: "2330",
        barDate: "2026-01-15",
        open: 998,
        high: 1008,
        low: 995,
        close: 1005,
        volume: 100_000,
        source: "seed",
        ingestedAt: "2026-01-15T00:00:00.000Z",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/market-data/price?ticker=2330&date=2026-01-15",
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      close: 1005,
      date: "2026-01-15",
      source: "seed",
      match: "exact",
    });
  });

  it("GET /market-data/price returns the previous DB bar with weekend reason", async () => {
    seedDailyBars([
      {
        ticker: "2330",
        barDate: "2026-01-16",
        open: 998,
        high: 1008,
        low: 995,
        close: 1002,
        volume: 100_000,
        source: "seed",
        ingestedAt: "2026-01-16T00:00:00.000Z",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/market-data/price?ticker=2330&date=2026-01-18",
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      close: 1002,
      date: "2026-01-16",
      source: "seed",
      match: "previous",
      reason: "weekend",
    });
  });

  it("GET /market-data/price falls back to FinMind within the lookback and opportunistically seeds memory", async () => {
    vi.spyOn(MockFinMindMarketDataProvider.prototype, "fetchBars").mockResolvedValue([
      {
        ticker: "2330",
        barDate: "2026-01-15",
        open: 997,
        high: 1007,
        low: 994,
        close: 1001,
        volume: 120_000,
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/market-data/price?ticker=2330&date=2026-01-16",
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      close: 1001,
      date: "2026-01-15",
      source: "finmind",
      match: "previous",
      reason: "no_bar",
    });

    const seeded = await app.persistence.getDailyBarsForTicker("2330", "2026-01-09", "2026-01-16");
    expect(seeded).toEqual([
      expect.objectContaining({
        ticker: "2330",
        barDate: "2026-01-15",
        close: 1001,
        source: "finmind",
      }),
    ]);
  });

  it("GET /market-data/price keeps provider fallback responses in previous-match mode even on exact-date hits", async () => {
    vi.spyOn(MockFinMindMarketDataProvider.prototype, "fetchBars").mockResolvedValue([
      {
        ticker: "2330",
        barDate: "2026-01-16",
        open: 1000,
        high: 1010,
        low: 995,
        close: 1008,
        volume: 120_000,
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/market-data/price?ticker=2330&date=2026-01-16",
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      close: 1008,
      date: "2026-01-16",
      source: "finmind",
      match: "previous",
      reason: "no_bar",
    });
  });

  it("GET /market-data/price maps provider misses to 404 price_not_found", async () => {
    vi.spyOn(MockFinMindMarketDataProvider.prototype, "fetchBars").mockRejectedValue(new Error("FinMind 402"));

    const response = await app.inject({
      method: "GET",
      url: "/market-data/price?ticker=2330&date=2026-01-16",
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: "price_not_found",
      }),
    );
  });

  // QA-owned: N8 behavioral test — 503 + Retry-After when shared FinMind budget exhausted
  it("GET /market-data/price returns 503 + Retry-After when FinMind rate limit is exhausted", async () => {
    // Spy on the NEW provider prototype (post-Implementer-Slice-3 rename: fetchDailyBars → fetchBars)
    vi.spyOn(MockFinMindMarketDataProvider.prototype, "fetchBars").mockRejectedValue(
      new RateLimitedError({ msUntilAvailable: 30_000 }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/market-data/price?ticker=2330&date=2026-01-16",
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(503);
    // Retry-After must be ceil(30_000 / 1000) = 30 seconds
    expect(response.headers["retry-after"]).toBe("30");
    // Error code from routeError(503, 'provider_rate_limited', ...) → error handler writes it as `error` field
    expect(response.json()).toMatchObject({ error: "provider_rate_limited" });
  });

  it("GET /market-data/price rejects future dates with invalid_date", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/market-data/price?ticker=2330&date=2999-01-01",
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: "invalid_date",
      }),
    );
  });

  it("POST /portfolio/transactions/estimate uses ticker binding overrides and instrument type", async () => {
    const store = await app.persistence.loadStore("user-1");
    const overrideProfile: FeeProfile = {
      id: "fp-override",
      // KZO-183: profile owned by the memory-seeded "acc-1" account.
      accountId: "acc-1",
      name: "Override Profile",
      boardCommissionRate: 0.001425,
      commissionDiscountPercent: 40,
      minimumCommissionAmount: 1,
      commissionCurrency: "TWD",
      commissionRoundingMode: "FLOOR",
      taxRoundingMode: "FLOOR",
      stockSellTaxRateBps: 30,
      stockDayTradeTaxRateBps: 15,
      etfSellTaxRateBps: 1,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT",
    };
    store.feeProfiles.push(overrideProfile);
    store.feeProfileBindings.push({
      accountId: "acc-1",
      ticker: "0050",
      feeProfileId: "fp-override",
    });
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions/estimate",
      headers: authHeaders,
      payload: {
        ticker: "0050",
        marketCode: "TW",
        quantity: 1000,
        unitPrice: 42.5,
        type: "SELL",
        isDayTrade: false,
        accountId: "acc-1",
      },
    });

    expect(response.statusCode).toBe(200);
    const expected = calculateSellFees(overrideProfile, {
      tradeValueAmount: roundToDecimal(1000 * 42.5, 2),
      tradeCurrency: "TWD",
      instrumentType: "ETF",
      isDayTrade: false,
      marketCode: "TW",
    });
    expect(response.json()).toEqual({
      commissionAmount: expected.commissionAmount,
      taxAmount: expected.taxAmount,
    });
  });

  it("POST /portfolio/transactions/estimate falls back to STOCK when instrument lookup is missing", async () => {
    const store = await app.persistence.loadStore("user-1");
    const customProfile: FeeProfile = {
      id: "fp-stock-fallback",
      // KZO-183: profile owned by the memory-seeded "acc-1" account.
      accountId: "acc-1",
      name: "Stock Fallback",
      boardCommissionRate: 0.001425,
      commissionDiscountPercent: 0,
      minimumCommissionAmount: 20,
      commissionCurrency: "TWD",
      commissionRoundingMode: "FLOOR",
      taxRoundingMode: "FLOOR",
      stockSellTaxRateBps: 30,
      stockDayTradeTaxRateBps: 15,
      etfSellTaxRateBps: 0,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT",
    };
    store.feeProfiles.push(customProfile);
    const account = store.accounts.find((item) => item.id === "acc-1");
    if (!account) {
      throw new Error("expected default account acc-1");
    }
    account.feeProfileId = customProfile.id;
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions/estimate",
      headers: authHeaders,
      payload: {
        ticker: "UNLISTED",
        marketCode: "TW",
        quantity: 1000,
        unitPrice: 50,
        type: "SELL",
        isDayTrade: false,
        accountId: "acc-1",
      },
    });

    expect(response.statusCode).toBe(200);
    const expected = calculateSellFees(customProfile, {
      tradeValueAmount: roundToDecimal(1000 * 50, 2),
      tradeCurrency: "TWD",
      instrumentType: "STOCK",
      isDayTrade: false,
      marketCode: "TW",
    });
    expect(response.json()).toEqual({
      commissionAmount: expected.commissionAmount,
      taxAmount: expected.taxAmount,
    });
  });

  it("POST /portfolio/transactions/estimate returns 404 when the account is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions/estimate",
      headers: authHeaders,
      payload: {
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        type: "BUY",
        isDayTrade: false,
        accountId: "missing-account",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual(
      expect.objectContaining({
        error: "account_not_found",
      }),
    );
  });

  // KZO-169: trade currency derives from `currencyFor(marketCode)` per D3, not
  // from `profile.commissionCurrency`. After KZO-167 + KZO-169 the invariant
  // chain is account.defaultCurrency = currencyFor(marketCode) =
  // profile.commissionCurrency, so the estimate uses the marketCode-derived
  // currency consistently. The pre-KZO-169 test that asserted "uses the
  // profile commission currency for buy calculations" is preserved as-is in
  // shape but its profile now carries a TWD commissionCurrency to honor the
  // post-KZO-167 invariant.
  it("POST /portfolio/transactions/estimate uses marketCode-derived trade currency for buy calculations", async () => {
    const store = await app.persistence.loadStore("user-1");
    const twdProfile: FeeProfile = {
      id: "fp-twd-estimate",
      // KZO-183: profile owned by the memory-seeded "acc-1" account.
      accountId: "acc-1",
      name: "TWD Estimate Profile",
      boardCommissionRate: 0.001,
      commissionDiscountPercent: 0,
      minimumCommissionAmount: 2,
      commissionCurrency: "TWD",
      commissionRoundingMode: "ROUND",
      taxRoundingMode: "FLOOR",
      stockSellTaxRateBps: 30,
      stockDayTradeTaxRateBps: 15,
      etfSellTaxRateBps: 0,
      bondEtfSellTaxRateBps: 0,
      commissionChargeMode: "CHARGED_UPFRONT",
    };
    store.feeProfiles.push(twdProfile);
    const account = store.accounts.find((item) => item.id === "acc-1");
    if (!account) {
      throw new Error("expected default account acc-1");
    }
    account.feeProfileId = twdProfile.id;
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions/estimate",
      headers: authHeaders,
      payload: {
        ticker: "2330",
        marketCode: "TW",
        quantity: 10,
        unitPrice: 25.5,
        type: "BUY",
        isDayTrade: false,
        accountId: "acc-1",
      },
    });

    expect(response.statusCode).toBe(200);
    const expected = calculateBuyFees(twdProfile, roundToDecimal(10 * 25.5, 2), "TWD");
    expect(response.json()).toEqual({
      commissionAmount: expected.commissionAmount,
      taxAmount: expected.taxAmount,
    });
  });
});
