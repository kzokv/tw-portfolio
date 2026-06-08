import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(response.headers["server-timing"]).toContain("list_primary_holdings;dur=");
    expect(response.headers["server-timing"]).toContain("map_instruments;dur=");
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
        quoteStatus: "missing",
      }),
    ]);
    expect(body.instruments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
      }),
    ]));
    expect(body.accounts).toEqual([
      expect.objectContaining({
        id: "acc-1",
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
      fxStatus: "complete",
      totalCostAmount: 1000,
      marketValueAmount: null,
    }));
    expect(body.dividends).toEqual({ upcoming: [], recent: [] });
    expect(body.holdings[0]).toEqual(expect.objectContaining({
      ticker: "2330",
      currentUnitPrice: null,
    }));
  });

  it("does not label mixed-currency dashboard primary totals as reporting currency", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "AAPL",
      quantity: 1,
      costBasisAmount: 100,
      currency: "USD",
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/primary" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).not.toContain("translate_summary;dur=");
    expect(response.json().summary).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      fxStatus: "missing",
      totalCostAmount: 0,
      marketValueAmount: null,
    }));
  });

  it("serves transactions primary data with recent rows and account options", async () => {
    const store = await app.persistence.loadStore("user-1");
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.facts.tradeEvents.push({
      id: "trade-1",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-06-02",
      commissionAmount: 20,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      bookedAt: "2026-06-02T09:00:00.000Z",
    });

    const response = await app.inject({ method: "GET", url: "/transactions/primary" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).toContain("list_recent_transactions;dur=");
    expect(response.headers["server-timing"]).toContain("map_account_options;dur=");
    const body = response.json();
    expect(body.recentTransactions).toEqual([
      expect.objectContaining({
        id: "trade-1",
        accountId: "acc-1",
        ticker: "2330",
      }),
    ]);
    expect(body.accountOptions).toEqual([
      expect.objectContaining({
        id: "acc-1",
        feeProfileName: feeProfile.name,
      }),
    ]);
    expect(body.portfolioConfig).toEqual(expect.objectContaining({
      accounts: expect.arrayContaining([expect.objectContaining({ id: "acc-1" })]),
      feeProfiles: expect.arrayContaining([expect.objectContaining({ id: feeProfile.id })]),
      feeProfileBindings: expect.any(Array),
    }));
  });

  it("splits AI connector summary from access logs", async () => {
    const originalListAccessLogs = app.persistence.listAiConnectorAccessLogsForUser.bind(app.persistence);
    const listAccessLogs = vi
      .spyOn(app.persistence, "listAiConnectorAccessLogsForUser")
      .mockImplementation((userId, options) => originalListAccessLogs(userId, options));

    const summary = await app.inject({ method: "GET", url: "/ai/connectors/summary" });
    const logs = await app.inject({ method: "GET", url: "/ai/connectors/logs?limit=5" });

    expect(summary.statusCode).toBe(200);
    expect(summary.headers["server-timing"]).toContain("load_connector_summary;dur=");
    expect(summary.json()).toEqual(expect.objectContaining({
      connections: expect.any(Array),
      policy: expect.any(Object),
      toolCatalog: expect.arrayContaining([
        expect.objectContaining({
          name: "get_daily_review_report",
          scope: "portfolio:mcp_read",
          accessKind: "read",
          group: "read",
        }),
        expect.objectContaining({
          name: "get_portfolio_report",
          scope: "portfolio:mcp_read",
          accessKind: "read",
          group: "read",
        }),
      ]),
    }));
    expect(summary.json().accessLogs).toBeUndefined();
    expect(logs.statusCode).toBe(200);
    expect(logs.headers["server-timing"]).toContain("load_connector_logs;dur=");
    expect(logs.json()).toEqual({ accessLogs: expect.any(Array) });
    expect(listAccessLogs).toHaveBeenCalledWith("user-1", { limit: 5 });
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
