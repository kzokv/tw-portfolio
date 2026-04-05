import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { createDividendEvent, type CreateDividendEventInput } from "../../src/services/dividends.js";
import { dividendEventPayload, dividendPostingPayload, transactionPayload } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("dashboard overview", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
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
    createDividendEvent(store2, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2026-03-01",
        paymentDate: "2026-03-20",
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
            nextDividendDate: "2026-03-20",
          }),
        ],
        dividends: {
          upcoming: [
            expect.objectContaining({
              accountId: "acc-1",
              ticker: "2330",
              paymentDate: "2026-03-20",
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

  it("returns ordered performance points for the requested range", async () => {
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
    expect(response.json()).toEqual(
      expect.objectContaining({
        range: "YTD",
        points: expect.arrayContaining([
          expect.objectContaining({
            date: "2026-01-15",
            totalCostAmount: 1000,
            marketValueAmount: 1000,
            unrealizedPnlAmount: 0,
          }),
          expect.objectContaining({
            date: "2026-02-10",
            totalCostAmount: 1600,
            marketValueAmount: 1505,
            unrealizedPnlAmount: -95,
          }),
        ]),
      }),
    );
  });

  it("leaves performance market-value fields empty when any active symbol lacks quotes", async () => {
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
        points: expect.arrayContaining([
          expect.objectContaining({
            date: "2026-01-15",
            totalCostAmount: 400,
            marketValueAmount: null,
            unrealizedPnlAmount: null,
          }),
        ]),
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
