import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";

let app: AppInstance;

describe("smooth page read paths", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("serves settings through an instrumented lightweight read contract", async () => {
    const response = await app.inject({ method: "GET", url: "/settings" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).toContain("user_settings;dur=");
    expect(response.json()).toEqual(expect.objectContaining({
      userId: "user-1",
      locale: "en",
      costBasisMethod: "WEIGHTED_AVERAGE",
    }));
  });

  it("serves portfolio primary data without the dashboard overview envelope", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });

    const response = await app.inject({ method: "GET", url: "/portfolio/page-data" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).toContain("build_portfolio_page_data;dur=");
    const body = response.json();
    expect(body.settings).toBeUndefined();
    expect(body.summary).toBeUndefined();
    expect(body.actions).toBeUndefined();
    expect(body.holdings).toEqual([
      expect.objectContaining({
        accountId: "acc-1",
        ticker: "2330",
        currentUnitPrice: null,
      }),
    ]);
    expect(body.holdingGroups).toEqual([
      expect.objectContaining({
        ticker: "2330",
        children: [
          expect.objectContaining({
            accountId: "acc-1",
            ticker: "2330",
          }),
        ],
      }),
    ]);
  });

  it("serves portfolio primary data from an explicit primary route without quote enrichment", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });

    const response = await app.inject({ method: "GET", url: "/portfolio/primary" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).toContain("build_primary_portfolio;dur=");
    expect(response.headers["server-timing"]).not.toContain("load_quotes;dur=");
    expect(response.headers["server-timing"]).not.toContain("freshness;dur=");
    const body = response.json();
    expect(body.summary).toBeUndefined();
    expect(body.actions).toBeUndefined();
    expect(body.dividends).toEqual({ upcoming: [], recent: [] });
    expect(body.holdings).toEqual([
      expect.objectContaining({
        ticker: "2330",
        currentUnitPrice: null,
        freshness: "current",
      }),
    ]);
  });

  it("serves dashboard primary data from an explicit primary route without quote or FX enrichment", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/primary" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).toContain("build_primary_overview;dur=");
    expect(response.headers["server-timing"]).not.toContain("load_quotes;dur=");
    expect(response.headers["server-timing"]).not.toContain("translate_summary;dur=");
    expect(response.headers["server-timing"]).not.toContain("freshness;dur=");
    const body = response.json();
    expect(body.summary).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      fxStatus: "missing",
      marketValueAmount: null,
    }));
    expect(body.holdings[0]).toEqual(expect.objectContaining({
      ticker: "2330",
      currentUnitPrice: null,
    }));
  });

  it("splits AI connector summary from access logs", async () => {
    const summary = await app.inject({ method: "GET", url: "/ai/connectors/summary" });
    const logs = await app.inject({ method: "GET", url: "/ai/connectors/logs?limit=5" });

    expect(summary.statusCode).toBe(200);
    expect(summary.headers["server-timing"]).toContain("load_connector_summary;dur=");
    expect(summary.json()).toEqual(expect.objectContaining({
      connections: expect.any(Array),
      policy: expect.any(Object),
    }));
    expect(summary.json().accessLogs).toBeUndefined();
    expect(logs.statusCode).toBe(200);
    expect(logs.headers["server-timing"]).toContain("load_connector_logs;dur=");
    expect(logs.json()).toEqual({ accessLogs: expect.any(Array) });
  });

  it("preserves cached quote and freshness fields in portfolio primary data", async () => {
    (app.persistence as MemoryPersistence)._seedDailyBars([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-03-27",
        open: 590,
        high: 602,
        low: 588,
        close: 600,
        volume: 25_000_000,
        source: "test",
        ingestedAt: "2026-03-27T18:00:00Z",
      },
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-03-26",
        open: 580,
        high: 592,
        low: 578,
        close: 590,
        volume: 20_000_000,
        source: "test",
        ingestedAt: "2026-03-26T18:00:00Z",
      },
    ]);
    const store = await app.persistence.loadStore("user-1");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 5000,
      currency: "TWD",
    });

    const response = await app.inject({ method: "GET", url: "/portfolio/page-data" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).toContain("load_quotes;dur=");
    const body = response.json();
    expect(body.holdings).toEqual([
      expect.objectContaining({
        accountId: "acc-1",
        ticker: "2330",
        currentUnitPrice: 600,
        marketValueAmount: 6000,
        previousClose: 590,
        change: 10,
        quoteStatus: "provisional",
        freshness: expect.any(String),
      }),
    ]);
    expect(body.holdingGroups).toEqual([
      expect.objectContaining({
        ticker: "2330",
        currentUnitPrice: 600,
        marketValueAmount: 6000,
        previousClose: 590,
        change: 10,
        quoteStatus: "provisional",
        children: [
          expect.objectContaining({
            currentUnitPrice: 600,
            marketValueAmount: 6000,
            quoteStatus: "provisional",
          }),
        ],
      }),
    ]);
  });
});
