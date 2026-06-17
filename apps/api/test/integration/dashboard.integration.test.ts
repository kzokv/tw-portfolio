import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: { ...original.Env, AUTH_MODE: "dev_bypass" as const },
  };
});

import { buildApp } from "../../src/app.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { createDividendEvent, type CreateDividendEventInput } from "../../src/services/dividends.js";
import { generateHoldingSnapshots } from "../../src/services/snapshotGeneration.js";
import { dividendEventPayload, dividendPostingPayload, transactionPayload } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("dashboard overview", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (app) await app.close();
  });

  it("returns empty-state overview data with additive settings payloads", async () => {
    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        settings: expect.objectContaining({ userId: "user-1" }),
        summary: expect.objectContaining({
          accountCount: 1,
          holdingCount: 0,
          totalCostAmount: 0,
          marketValueAmount: null,
          unrealizedPnlAmount: null,
          upcomingDividendCount: 0,
          upcomingDividendAmount: null,
          openIssueCount: 0,
        }),
        fxRates: [],
        holdings: [],
        dividends: {
          upcoming: [],
          recent: [],
        },
        actions: {
          integrityIssue: null,
          recomputeAvailable: true,
        },
        instruments: expect.arrayContaining([
          expect.objectContaining({
            ticker: "2330",
            instrumentType: "STOCK",
            marketCode: "TW",
            isProvisional: false,
          }),
          expect.objectContaining({
            ticker: "0050",
            instrumentType: "ETF",
            marketCode: "TW",
            isProvisional: false,
          }),
          expect.objectContaining({
            ticker: "00919",
            instrumentType: "ETF",
            marketCode: "TW",
            isProvisional: false,
          }),
          expect.objectContaining({
            ticker: "0056",
            instrumentType: "ETF",
            marketCode: "TW",
            isProvisional: false,
          }),
        ]),
        accounts: expect.any(Array),
        feeProfiles: expect.any(Array),
        feeProfileBindings: expect.any(Array),
      }),
    );
    expect(response.json()).not.toHaveProperty("valuationHealth");
    expect(response.headers["server-timing"]).not.toContain("valuation_health");
  });

  it.each([
    "/dashboard/overview",
    "/dashboard/enrichment",
  ])("does not use a fixed recent window for valuation health on %s", async (url) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    const store = await app.persistence.loadStore("user-1");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    const snapshotSpy = vi.spyOn(app.persistence, "getAggregatedSnapshotsInReportingCurrency");

    const response = await app.inject({ method: "GET", url });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.valuationHealth).toEqual(
      expect.objectContaining({
        expectedLatestValuationDate: "2026-06-14",
        latestSnapshotDate: null,
        latestUsableSnapshotDate: null,
        status: "unavailable",
      }),
    );
    expect(snapshotSpy).toHaveBeenCalledWith("user-1", "2026-06-14", "2026-06-14", "TWD");
    expect(snapshotSpy).not.toHaveBeenCalledWith("user-1", "2026-05-14", "2026-06-14", "TWD");
  });

  it.each([
    "/dashboard/overview",
    "/dashboard/enrichment",
  ])("uses older usable snapshots for valuation health on %s", async (url) => {
    const routeName = url.endsWith("overview") ? "overview" : "enrichment";
    (app.persistence as MemoryPersistence)._seedDailyBars([
      { ticker: "2330", barDate: "2026-04-01", open: 99, high: 101, low: 98, close: 100, volume: 50000, source: "test", ingestedAt: "2026-04-01T18:00:00Z" },
      { ticker: "2330", barDate: "2026-06-14", open: 299, high: 301, low: 298, close: 300, volume: 50000, source: "test", ingestedAt: "2026-06-14T18:00:00Z" },
    ]);
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": `k-valuation-health-older-snapshot-${routeName}` },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-04-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await generateHoldingSnapshots("user-1", app.persistence);
    await app.persistence.deleteHoldingSnapshotsForTicker("user-1", "acc-1", "2330", "2026-05-14", "TW");

    const response = await app.inject({ method: "GET", url });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.valuationHealth).toEqual(
      expect.objectContaining({
        currentValueAmount: 3000,
        snapshotValueAmount: 1000,
        deltaAmount: 2000,
        latestSnapshotDate: "2026-04-01",
        latestUsableSnapshotDate: "2026-04-01",
        status: "material",
      }),
    );
    expect(body.valuationHealth.affectedHoldings).toEqual([
      expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
        latestBarDate: "2026-06-14",
        latestSnapshotDate: "2026-04-01",
        status: "stale_snapshot",
        recommendedAction: "run_snapshot_repair",
      }),
    ]);
  });

  it("adds overview FX conversion rows for mixed-currency holdings", async () => {
    const store = await app.persistence.loadStore("user-1");
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const accountFeeProfile = {
      ...feeProfile,
      id: "fp-usd-1",
      accountId: "acc-usd-1",
      name: "US Broker Fee",
    };
    store.feeProfiles.push(accountFeeProfile);
    store.accounts.push({
      id: "acc-usd-1",
      userId: "user-1",
      name: "US Broker",
      feeProfileId: accountFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.accounting.projections.holdings.push({
      accountId: "acc-usd-1",
      ticker: "AAPL",
      quantity: 5,
      costBasisAmount: 500,
      currency: "USD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "dashboard-usd-trade-1",
      userId: "user-1",
      accountId: "acc-usd-1",
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 5,
      unitPrice: 100,
      priceCurrency: "USD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: accountFeeProfile,
      tradeTimestamp: "2026-06-01T14:30:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T14:30:00.000Z",
    });
    await app.persistence.saveStore(store);
    await app.persistence.upsertFxRates([
      {
        date: "2026-06-03",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 32,
        source: "test",
      },
    ]);

    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      fxRates: [
        expect.objectContaining({
          fromCurrency: "USD",
          toCurrency: "TWD",
          rate: 32,
          asOf: expect.any(String),
        }),
      ],
    }));
    expect(response.json().fxRates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ fromCurrency: "TWD", toCurrency: "TWD" }),
    ]));
  });

  it("derives dashboard market states from held trade markets when account currency drifts", async () => {
    const store = await app.persistence.loadStore("user-1");
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const accountFeeProfile = {
      ...feeProfile,
      id: "fp-cross-currency-1",
      accountId: "acc-cross-currency-1",
      name: "Cross Currency Fee",
    };
    store.feeProfiles.push(accountFeeProfile);
    store.accounts.push({
      id: "acc-cross-currency-1",
      userId: "user-1",
      name: "Cross Currency Broker",
      feeProfileId: accountFeeProfile.id,
      defaultCurrency: "AUD",
      accountType: "broker",
    });
    store.accounting.projections.holdings.push({
      accountId: "acc-cross-currency-1",
      ticker: "AAPL",
      quantity: 3,
      costBasisAmount: 300,
      currency: "USD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "dashboard-cross-currency-trade-1",
      userId: "user-1",
      accountId: "acc-cross-currency-1",
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 3,
      unitPrice: 100,
      priceCurrency: "USD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: accountFeeProfile,
      tradeTimestamp: "2026-06-01T14:30:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T14:30:00.000Z",
    });
    await app.persistence.saveStore(store);

    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });

    expect(response.statusCode).toBe(200);
    expect(response.json().holdings).toEqual([
      expect.objectContaining({
        ticker: "AAPL",
        marketCode: "US",
      }),
    ]);
    expect(response.json().marketStates).toEqual([
      expect.objectContaining({
        marketCode: "US",
      }),
    ]);
    expect(response.json().marketStates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ marketCode: "AU" }),
    ]));
  });

  it("returns holdings and dividend overview details when accounting facts exist", async () => {
    (app.persistence as MemoryPersistence)._seedDailyBars([
      { ticker: "2330", barDate: "2026-03-28", open: 99, high: 101, low: 98, close: 100, volume: 50000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
      { ticker: "2330", barDate: "2026-03-27", open: 98, high: 100, low: 97, close: 99, volume: 40000, source: "test", ingestedAt: "2026-03-27T18:00:00Z" },
    ]);
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-dashboard-buy" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-15",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const store = await app.persistence.loadStore("user-1");
    const cashEvent = createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2026-02-01",
        paymentDate: "2026-02-20",
        cashDividendPerShare: 12,
      }),
    } as CreateDividendEventInput);
    await app.persistence.saveStore(store);

    await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dashboard-dividend-posting" },
      payload: dividendPostingPayload({
        dividendEventId: cashEvent.id,
        receivedCashAmount: 108,
        deductions: [
          {
            deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
            amount: 12,
            currencyCode: "TWD",
            withheldAtSource: true,
            source: "dividend_posting",
          },
        ],
      }),
    });

    const store2 = await app.persistence.loadStore("user-1");
    // Seed an upcoming dividend event. We normalize the payment date to
    // "tomorrow" relative to now so the buildUpcomingDividends() date filter
    // keeps including it as the clock advances over time.
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const upcomingPaymentDate = tomorrow.toISOString().slice(0, 10);
    const upcomingExDate = new Date();
    upcomingExDate.setUTCDate(upcomingExDate.getUTCDate() - 5);
    createDividendEvent(store2, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: upcomingExDate.toISOString().slice(0, 10),
        paymentDate: upcomingPaymentDate,
        cashDividendPerShare: 8,
        sourceReference: "manual-upcoming-event",
      }),
    } as CreateDividendEventInput);
    await app.persistence.saveStore(store2);

    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          holdingCount: 1,
          totalCostAmount: 1000,
          marketValueAmount: 1000,
          unrealizedPnlAmount: 0,
          upcomingDividendCount: 1,
          upcomingDividendAmount: 80,
        }),
        holdings: [
          expect.objectContaining({
            accountId: "acc-1",
            ticker: "2330",
            quantity: 10,
            costBasisAmount: 1000,
            averageCostPerShare: 100,
            currentUnitPrice: 100,
            marketValueAmount: 1000,
            unrealizedPnlAmount: 0,
            nextDividendDate: upcomingPaymentDate,
          }),
        ],
        dividends: {
          upcoming: [
            expect.objectContaining({
              accountId: "acc-1",
              ticker: "2330",
              paymentDate: upcomingPaymentDate,
              expectedAmount: 80,
              currency: "TWD",
            }),
          ],
          recent: [
            expect.objectContaining({
              accountId: "acc-1",
              ticker: "2330",
              netAmount: 108,
              grossAmount: 120,
              deductionAmount: 12,
              currency: "TWD",
            }),
          ],
        },
      }),
    );
  });

  it("rebuilds upcoming dividend expectations from current trades when late buys land after posting", async () => {
    // Buy 1 share initially.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-upcoming-retro-initial" },
      payload: transactionPayload({
        quantity: 1,
        unitPrice: 100,
        tradeDate: "2026-01-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    // Seed an upcoming dividend event within the horizon.
    const store = await app.persistence.loadStore("user-1");
    const upcomingPayment = new Date();
    upcomingPayment.setUTCDate(upcomingPayment.getUTCDate() + 20);
    const upcomingExDiv = new Date();
    upcomingExDiv.setUTCDate(upcomingExDiv.getUTCDate() + 10);
    const eventId = randomUUID();
    createDividendEvent(store, {
      id: eventId,
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: upcomingExDiv.toISOString().slice(0, 10),
        paymentDate: upcomingPayment.toISOString().slice(0, 10),
        cashDividendPerShare: 10,
        sourceReference: "retro-upcoming",
      }),
    } as CreateDividendEventInput);
    await app.persistence.saveStore(store);

    // Sanity — widget initially sees 1 × 10 = 10.
    const before = await app.inject({ method: "GET", url: "/dashboard/overview" });
    const beforeEntry = before.json().dividends.upcoming.find(
      (entry: { ticker: string; expectedAmount: number | null }) => entry.ticker === "2330",
    );
    expect(beforeEntry.expectedAmount).toBe(10);

    // Add a late BUY of 9 more shares before the (still-future) ex-div date.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-upcoming-retro-late" },
      payload: transactionPayload({
        quantity: 9,
        unitPrice: 100,
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    // Widget must recompute from the updated trade set: 10 × 10 = 100.
    const after = await app.inject({ method: "GET", url: "/dashboard/overview" });
    const afterEntry = after.json().dividends.upcoming.find(
      (entry: { ticker: string; expectedAmount: number | null }) => entry.ticker === "2330",
    );
    expect(afterEntry.expectedAmount).toBe(100);
  });

  it("filters out past-dated and beyond-horizon dividend events from the upcoming widget", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-upcoming-filter-buy" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2020-01-15",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const store = await app.persistence.loadStore("user-1");

    // Past event (2013) — must be excluded even though user holds the stock.
    createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2013-06-15",
        paymentDate: "2013-07-03",
        cashDividendPerShare: 3,
        sourceReference: "past-dividend",
      }),
    } as CreateDividendEventInput);

    // Declared but unscheduled event (no payment date) — should be included.
    createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2099-01-01",
        paymentDate: null,
        cashDividendPerShare: 5,
        sourceReference: "declared-only",
      }),
    } as CreateDividendEventInput);

    // Event inside the 60-day horizon — should be included.
    const nearFuture = new Date();
    nearFuture.setUTCDate(nearFuture.getUTCDate() + 30);
    const nearFutureDate = nearFuture.toISOString().slice(0, 10);
    createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: nearFutureDate,
        paymentDate: nearFutureDate,
        cashDividendPerShare: 7,
        sourceReference: "within-horizon",
      }),
    } as CreateDividendEventInput);

    // Event beyond the 60-day horizon — should be excluded.
    const farFuture = new Date();
    farFuture.setUTCDate(farFuture.getUTCDate() + 180);
    const farFutureDate = farFuture.toISOString().slice(0, 10);
    createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: farFutureDate,
        paymentDate: farFutureDate,
        cashDividendPerShare: 9,
        sourceReference: "beyond-horizon",
      }),
    } as CreateDividendEventInput);

    await app.persistence.saveStore(store);

    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    const upcomingPaymentDates = body.dividends.upcoming.map(
      (entry: { paymentDate: string | null }) => entry.paymentDate,
    );
    expect(upcomingPaymentDates).toEqual(
      expect.arrayContaining([null, nearFutureDate]),
    );
    expect(upcomingPaymentDates).not.toContain("2013-07-03");
    expect(upcomingPaymentDates).not.toContain(farFutureDate);
  });

  it("keeps quote-derived dashboard fields empty for provisional instruments until sync data exists", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-dashboard-provisional" },
      payload: transactionPayload({
        ticker: "qa-sync-later",
        quantity: 5,
        unitPrice: 80,
        tradeDate: "2026-01-15",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          marketValueAmount: null,
          unrealizedPnlAmount: null,
        }),
        instruments: expect.arrayContaining([
          expect.objectContaining({ ticker: "2330", instrumentType: "STOCK" }),
          expect.objectContaining({ ticker: "0050", instrumentType: "ETF" }),
          expect.objectContaining({ ticker: "00919", instrumentType: "ETF" }),
          expect.objectContaining({ ticker: "0056", instrumentType: "ETF" }),
        ]),
        holdings: [
          expect.objectContaining({
            ticker: "QA-SYNC-LATER",
            currentUnitPrice: null,
            marketValueAmount: null,
            unrealizedPnlAmount: null,
          }),
        ],
      }),
    );
  });

  it("returns an empty performance series until holding snapshots exist", async () => {
    (app.persistence as MemoryPersistence)._seedDailyBars([
      { ticker: "2330", barDate: "2026-03-28", open: 99, high: 101, low: 98, close: 100, volume: 50000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
      { ticker: "0050", barDate: "2026-03-28", open: 100, high: 102, low: 99, close: 101, volume: 30000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
    ]);
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-performance-buy-1" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-15",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-performance-buy-2" },
      payload: transactionPayload({
        ticker: "0050",
        quantity: 5,
        unitPrice: 120,
        tradeDate: "2026-02-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/performance?range=YTD" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).toContain("load_performance_inputs;dur=");
    expect(response.headers["server-timing"]).toContain("coverage_inputs;dur=");
    expect(response.headers["server-timing"]).not.toContain("load_store;dur=");
    expect(response.json()).toEqual(
      expect.objectContaining({
        range: "YTD",
        points: [],
        lastReliableDate: null,
        marketDataStaleSince: null,
      }),
    );
  });

  it("uses latest available market data date as performance as-of instead of wall-clock today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-14T12:00:00.000Z"));
    (app.persistence as MemoryPersistence)._seedDailyBars([
      { ticker: "2330", barDate: "2026-06-10", open: 99, high: 101, low: 98, close: 100, volume: 50000, source: "test", ingestedAt: "2026-06-10T18:00:00Z" },
      { ticker: "2330", barDate: "2026-06-12", open: 103, high: 106, low: 102, close: 105, volume: 50000, source: "test", ingestedAt: "2026-06-12T18:00:00Z" },
    ]);
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-performance-latest-bar-as-of" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-06-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await generateHoldingSnapshots("user-1", app.persistence);

    const response = await app.inject({ method: "GET", url: "/dashboard/performance?range=YTD" });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.requestedAsOf).toBe("2026-06-12");
    expect(body.marketDataStaleSince).toBeNull();
    expect(body.diagnostics).toEqual(
      expect.objectContaining({
        expectedLatestValuationDate: "2026-06-12",
        latestReliableValuationDate: "2026-06-12",
        staleSinceDate: null,
      }),
    );
    expect(body.points.at(-1)).toEqual(expect.objectContaining({ date: "2026-06-12" }));
    expect(body).not.toHaveProperty("valuationHealth");
  });

  it("does not synthesize provisional performance points when snapshots are absent", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-performance-provisional" },
      payload: transactionPayload({
        ticker: "qa-sync-later",
        quantity: 5,
        unitPrice: 80,
        tradeDate: "2026-01-15",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/performance?range=YTD" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        range: "YTD",
        points: [],
        lastReliableDate: null,
        marketDataStaleSince: null,
      }),
    );
  });

  it("dashboard overview: with 2 daily bars → populates change fields and summary daily change", async () => {
    (app.persistence as MemoryPersistence)._seedDailyBars([
      { ticker: "2330", barDate: "2026-03-28", open: 99, high: 101, low: 98, close: 100, volume: 50000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
      { ticker: "2330", barDate: "2026-03-27", open: 98, high: 100, low: 97, close: 99, volume: 40000, source: "test", ingestedAt: "2026-03-27T18:00:00Z" },
    ]);
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-kzo20-t1-buy" },
      payload: transactionPayload({ quantity: 10, unitPrice: 100, tradeDate: "2026-01-15", commissionAmount: 0, taxAmount: 0 }),
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.holdings[0]).toEqual(
      expect.objectContaining({
        ticker: "2330",
        currentUnitPrice: 100,
        change: 1,
        // changePercent is a raw float — use closeTo to avoid float representation issues
        changePercent: expect.closeTo((1 / 99) * 100, 5),
        previousClose: 99,
        // quoteStatus depends on wall-clock day-of-week via computeIsProvisional — accept either
        quoteStatus: expect.stringMatching(/^(current|provisional)$/),
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        // dailyChangeAmount = roundToDecimal(10 × 1, 2) = 10
        dailyChangeAmount: 10,
        // dailyChangePercent = roundToDecimal((10 / 990) × 100, 4) = 1.0101
        dailyChangePercent: 1.0101,
      }),
    );
  });

  it("dashboard overview: with single daily bar → currentUnitPrice set but change fields null", async () => {
    (app.persistence as MemoryPersistence)._seedDailyBars([
      { ticker: "2330", barDate: "2026-03-28", open: 99, high: 101, low: 98, close: 100, volume: 50000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
    ]);
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-kzo20-t2-buy" },
      payload: transactionPayload({ quantity: 10, unitPrice: 100, tradeDate: "2026-01-15", commissionAmount: 0, taxAmount: 0 }),
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.holdings[0]).toEqual(
      expect.objectContaining({
        ticker: "2330",
        currentUnitPrice: 100,
        change: null,
        changePercent: null,
        previousClose: null,
        quoteStatus: expect.stringMatching(/^(current|provisional)$/),
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        dailyChangeAmount: null,
        dailyChangePercent: null,
      }),
    );
  });

  it("dashboard overview: with no daily bars → all valuation fields null and quoteStatus missing", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-kzo20-t3-buy" },
      payload: transactionPayload({
        ticker: "qa-no-bars",
        quantity: 5,
        unitPrice: 80,
        tradeDate: "2026-01-15",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.holdings[0]).toEqual(
      expect.objectContaining({
        ticker: "QA-NO-BARS",
        currentUnitPrice: null,
        change: null,
        changePercent: null,
        previousClose: null,
        quoteStatus: "missing",
      }),
    );
    expect(body.summary).toEqual(
      expect.objectContaining({
        marketValueAmount: null,
        dailyChangeAmount: null,
        dailyChangePercent: null,
      }),
    );
  });

  it("dashboard overview: with mixed quote coverage → summary daily change null propagates", async () => {
    (app.persistence as MemoryPersistence)._seedDailyBars([
      { ticker: "2330", barDate: "2026-03-28", open: 99, high: 101, low: 98, close: 100, volume: 50000, source: "test", ingestedAt: "2026-03-28T18:00:00Z" },
      { ticker: "2330", barDate: "2026-03-27", open: 98, high: 100, low: 97, close: 99, volume: 40000, source: "test", ingestedAt: "2026-03-27T18:00:00Z" },
    ]);
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-kzo20-t4-buy-2330" },
      payload: transactionPayload({ quantity: 10, unitPrice: 100, tradeDate: "2026-01-15", commissionAmount: 0, taxAmount: 0 }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-kzo20-t4-buy-qa" },
      payload: transactionPayload({
        ticker: "qa-no-bars",
        quantity: 5,
        unitPrice: 80,
        tradeDate: "2026-01-15",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const response = await app.inject({ method: "GET", url: "/dashboard/overview" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Holdings sorted by costBasisAmount desc: 2330 (1000) then QA-NO-BARS (400)
    expect(body.holdings[0]).toEqual(
      expect.objectContaining({
        ticker: "2330",
        change: 1,
        quoteStatus: expect.stringMatching(/^(current|provisional)$/),
      }),
    );
    expect(body.holdings[1]).toEqual(
      expect.objectContaining({
        ticker: "QA-NO-BARS",
        change: null,
        quoteStatus: "missing",
      }),
    );
    // null propagates to summary when any holding has quoteStatus "missing"
    expect(body.summary).toEqual(
      expect.objectContaining({
        dailyChangeAmount: null,
        dailyChangePercent: null,
      }),
    );
  });
});
