import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import { transactionPayload } from "../helpers/fixtures.js";
import { refresh as refreshAppConfigCache } from "../../src/services/appConfig/cache.js";

let app: AppInstance;

describe("POST /portfolio/refresh-closes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
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

  it("queues every eligible pair when the request exceeds the sync ticker cap", async () => {
    const sendCalls: unknown[] = [];
    app.boss = {
      send: async (...args: unknown[]) => {
        sendCalls.push(args);
        return `job-${sendCalls.length}`;
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
    expect(body.items.every((item: { status: string }) => item.status === "queued")).toBe(true);
    expect(body.summary).toMatchObject({
      refreshed: 0,
      current: 0,
      not_eligible: 0,
      missing: 0,
      failed: 0,
      queued: 2,
    });
    expect(sendCalls).toHaveLength(2);
  });
});
