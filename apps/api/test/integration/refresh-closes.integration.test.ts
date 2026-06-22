import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import { transactionPayload } from "../helpers/fixtures.js";
import { refresh as refreshAppConfigCache } from "../../src/services/appConfig/cache.js";
import {
  confirmAdminMarketCalendarImport,
  previewAdminMarketCalendarImport,
} from "../../src/services/market-data/marketCalendarService.js";
import { RateLimitedError } from "../../src/services/market-data/types.js";

let app: AppInstance;

async function seedOfficialMarketCalendar(marketCode: "TW", calendarYear: number): Promise<void> {
  const preview = await previewAdminMarketCalendarImport(app.persistence, marketCode, {
    calendarYear,
    retrievedAt: "2026-06-18T00:00:00.000Z",
    coverage: { scope: "full_year", evidence: "Integration test confirmed full-year calendar coverage." },
    exceptions: [],
  });
  await confirmAdminMarketCalendarImport(app.persistence, marketCode, preview.previewToken);
}

describe("POST /portfolio/refresh-closes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (app) await app.close();
  });

  it("derives held ticker-market pairs server-side and returns per-ticker statuses without a request body", async () => {
    (app.persistence as MemoryPersistence)._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    const trade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "refresh-closes-seed" },
      payload: transactionPayload({
        ticker: "2330",
        marketCode: "TW",
        tradeDate: "2026-06-17",
        quantity: 2,
        unitPrice: 1000,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(trade.statusCode).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/refresh-closes",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json();
    expect(body.items).toEqual([
      expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
        status: expect.stringMatching(/^(refreshed|current|not_eligible|missing|failed|queued)$/),
      }),
    ]);
    expect(body.summary).toEqual(expect.objectContaining({
      refreshed: expect.any(Number),
      current: expect.any(Number),
      not_eligible: expect.any(Number),
      missing: expect.any(Number),
      failed: expect.any(Number),
      queued: expect.any(Number),
    }));
  });

  it("returns retryable provider-rate-limit details when same-day close-only upgrade hits a primary provider limit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-18T08:00:00.000Z"));
    await seedOfficialMarketCalendar("TW", 2026);
    (app.persistence as MemoryPersistence)._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    app.marketDataRegistry.marketData.set("TW", {
      fetchBars: async () => {
        throw new RateLimitedError({ msUntilAvailable: 30_000 });
      },
    } as never);
    (app.persistence as MemoryPersistence)._seedDailyBars([{
      ticker: "2330",
      marketCode: "TW",
      barDate: "2026-06-17",
      open: 1010,
      high: 1010,
      low: 1010,
      close: 1010,
      volume: 0,
      quality: "close_only",
      source: "yahoo-chart-close",
      ingestedAt: "2026-06-17T06:00:00.000Z",
    }]);
    const trade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "refresh-closes-rate-limit" },
      payload: transactionPayload({
        ticker: "2330",
        marketCode: "TW",
        tradeDate: "2026-06-17",
        quantity: 2,
        unitPrice: 1000,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(trade.statusCode, trade.body).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/refresh-closes",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.json()).toMatchObject({ error: "provider_rate_limited" });
  });

  it("uses the quoteable instrument market for refresh pairs instead of account currency", async () => {
    (app.persistence as MemoryPersistence)._seedInstrument({
      ticker: "AAPL",
      name: "Apple",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "ready",
    });
    const store = await app.persistence.loadStore("user-1");
    const defaultFeeProfile = store.feeProfiles[0];
    if (!defaultFeeProfile) throw new Error("expected default fee profile");
    store.feeProfiles.push({
      ...defaultFeeProfile,
      id: "fp-aud-account-us-holding",
      accountId: "acc-aud-account-us-holding",
      name: "AUD account for US holding",
      commissionCurrency: "USD",
    });
    store.accounts.push({
      id: "acc-aud-account-us-holding",
      userId: "user-1",
      name: "AUD account for US holding",
      defaultCurrency: "USD",
      accountType: "broker",
      feeProfileId: "fp-aud-account-us-holding",
    });
    await app.persistence.saveStore(store);
    const trade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "refresh-closes-cross-currency-account" },
      payload: transactionPayload({
        accountId: "acc-aud-account-us-holding",
        ticker: "AAPL",
        marketCode: "US",
        tradeDate: "2026-06-17",
        quantity: 1,
        unitPrice: 200,
        priceCurrency: "USD",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(trade.statusCode, trade.body).toBe(200);
    const mutatedStore = await app.persistence.loadStore("user-1");
    const account = mutatedStore.accounts.find((item) => item.id === "acc-aud-account-us-holding");
    if (!account) throw new Error("expected account");
    account.defaultCurrency = "AUD";
    await app.persistence.saveStore(mutatedStore);
    await app.persistence.upsertInstruments("user-1", [{
      ticker: "AAPL",
      marketCode: "US",
      type: "STOCK",
      isProvisional: false,
    }]);
    const persistedStore = await app.persistence.loadStore("user-1");
    expect(persistedStore.instruments).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticker: "AAPL", marketCode: "US", isProvisional: false }),
    ]));
    expect(persistedStore.accounting.projections.holdings).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: "acc-aud-account-us-holding", ticker: "AAPL", quantity: 1 }),
    ]));

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/refresh-closes",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({
        ticker: "AAPL",
        marketCode: "US",
      }),
    ]);
  });

  it("refreshes only the held market when the ticker exists in multiple quoteable markets", async () => {
    for (const marketCode of ["AU", "US"] as const) {
      (app.persistence as MemoryPersistence)._seedInstrument({
        ticker: "BHP",
        name: `BHP ${marketCode}`,
        instrumentType: "STOCK",
        marketCode,
        barsBackfillStatus: "ready",
      });
    }
    const store = await app.persistence.loadStore("user-1");
    const defaultFeeProfile = store.feeProfiles[0];
    if (!defaultFeeProfile) throw new Error("expected default fee profile");
    store.feeProfiles.push({
      ...defaultFeeProfile,
      id: "fp-au-bhp-holding",
      accountId: "acc-au-bhp-holding",
      name: "AU BHP holding",
      commissionCurrency: "AUD",
    });
    store.accounts.push({
      id: "acc-au-bhp-holding",
      userId: "user-1",
      name: "AU BHP holding",
      defaultCurrency: "AUD",
      accountType: "broker",
      feeProfileId: "fp-au-bhp-holding",
    });
    store.marketData.instruments.push(
      {
        ticker: "BHP",
        marketCode: "AU",
        instrumentType: "STOCK",
        isProvisional: false,
      },
      {
        ticker: "BHP",
        marketCode: "US",
        instrumentType: "STOCK",
        isProvisional: false,
      },
    );
    await app.persistence.saveStore(store);
    const trade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "refresh-closes-bhp-au-only" },
      payload: transactionPayload({
        accountId: "acc-au-bhp-holding",
        ticker: "BHP",
        marketCode: "AU",
        tradeDate: "2026-06-17",
        quantity: 1,
        unitPrice: 44,
        priceCurrency: "AUD",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(trade.statusCode, trade.body).toBe(200);
    const persistedStore = await app.persistence.loadStore("user-1");
    expect(persistedStore.instruments).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticker: "BHP", marketCode: "AU", isProvisional: false }),
      expect.objectContaining({ ticker: "BHP", marketCode: "US", isProvisional: false }),
    ]));
    expect(persistedStore.accounting.projections.holdings).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: "acc-au-bhp-holding", ticker: "BHP", quantity: 1 }),
    ]));

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/refresh-closes",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({
        ticker: "BHP",
        marketCode: "AU",
      }),
    ]);
  });

  it("refreshes the capped first batch synchronously and queues only the overflow", async () => {
    const sendCalls: unknown[] = [];
    app.boss = {
      send: async (...args: unknown[]) => {
        sendCalls.push(args);
        return null;
      },
    } as never;
    await app.persistence.setAppConfigPatch({ tickerPriceSyncTickerCap: 1 });
    await refreshAppConfigCache();

    for (const marketCode of ["TW", "US"] as const) {
      (app.persistence as MemoryPersistence)._seedInstrument({
        ticker: marketCode === "TW" ? "2330" : "AAPL",
        name: marketCode === "TW" ? "TSMC" : "Apple",
        instrumentType: "STOCK",
        marketCode,
        barsBackfillStatus: "ready",
      });
    }
    const twTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "refresh-closes-overflow-tw" },
      payload: transactionPayload({
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        tradeDate: "2026-06-17",
        quantity: 2,
        unitPrice: 1000,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(twTrade.statusCode).toBe(200);
    const store = await app.persistence.loadStore("user-1");
    const defaultFeeProfile = store.feeProfiles[0];
    if (!defaultFeeProfile) throw new Error("expected default fee profile");
    store.feeProfiles.push({
      ...defaultFeeProfile,
      id: "fp-us-refresh-close-overflow",
      accountId: "acc-us-refresh-close-overflow",
      name: "US refresh close overflow",
      commissionCurrency: "USD",
    });
    store.accounts.push({
      id: "acc-us-refresh-close-overflow",
      userId: "user-1",
      name: "US refresh close overflow",
      defaultCurrency: "USD",
      accountType: "broker",
      feeProfileId: "fp-us-refresh-close-overflow",
    });
    store.marketData.instruments.push({
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      isProvisional: false,
    });
    await app.persistence.saveStore(store);
    const usTrade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "refresh-closes-overflow-us" },
      payload: transactionPayload({
        accountId: "acc-us-refresh-close-overflow",
        ticker: "AAPL",
        marketCode: "US",
        tradeDate: "2026-06-17",
        quantity: 1,
        unitPrice: 200,
        priceCurrency: "USD",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(usTrade.statusCode, usTrade.body).toBe(200);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/refresh-closes",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.filter((item: { status: string }) => item.status === "queued")).toHaveLength(1);
    expect(body.items.filter((item: { status: string }) => item.status !== "queued")).toHaveLength(1);
    expect(body.summary.queued).toBe(1);
    expect(body.summary.failed).toBe(0);
    expect(sendCalls).toHaveLength(1);
  });
});
