import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { transactionPayload } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("transaction history route", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("normalizes realized filters to sells and returns realized aggregates", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-realized-buy-1" },
      payload: transactionPayload({
        tradeDate: "2026-01-01",
        quantity: 10,
        unitPrice: 100,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-realized-sell-1" },
      payload: transactionPayload({
        tradeDate: "2026-01-10",
        type: "SELL",
        quantity: 5,
        unitPrice: 100,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-realized-buy-2" },
      payload: transactionPayload({
        tradeDate: "2026-01-11",
        quantity: 10,
        unitPrice: 100,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-realized-sell-2" },
      payload: transactionPayload({
        tradeDate: "2026-01-20",
        type: "SELL",
        quantity: 5,
        unitPrice: 110,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/transactions/history?type=BUY&pnl=realized&marketCode=TW&from=2026-01-01&to=2026-01-31&limit=50&offset=0",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          type: "SELL",
          tradeDate: "2026-01-20",
          realizedPnlAmount: 50,
          marketCode: "TW",
        }),
        expect.objectContaining({
          type: "SELL",
          tradeDate: "2026-01-10",
          realizedPnlAmount: 0,
          marketCode: "TW",
        }),
      ],
      total: 2,
      limit: 50,
      offset: 0,
      aggregates: {
        realizedPnlByCurrency: [
          { currency: "TWD", amount: 50 },
        ],
      },
    });
  });

  it("sorts by realized P&L with nulls last and keeps total independent from pagination", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-sort-buy-1" },
      payload: transactionPayload({
        ticker: "2330",
        tradeDate: "2026-01-01",
        quantity: 10,
        unitPrice: 100,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-sort-sell-1" },
      payload: transactionPayload({
        ticker: "2330",
        tradeDate: "2026-01-02",
        type: "SELL",
        quantity: 5,
        unitPrice: 110,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-sort-buy-2" },
      payload: transactionPayload({
        ticker: "2317",
        tradeDate: "2026-01-03",
        quantity: 10,
        unitPrice: 100,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-sort-sell-2" },
      payload: transactionPayload({
        ticker: "2330",
        tradeDate: "2026-01-04",
        type: "SELL",
        quantity: 5,
        unitPrice: 120,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/transactions/history?sortBy=realizedPnl&sortOrder=asc&limit=2&offset=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        expect.objectContaining({
          ticker: "2330",
          type: "SELL",
          tradeDate: "2026-01-04",
          realizedPnlAmount: 100,
        }),
        expect.objectContaining({
          ticker: "2317",
          type: "BUY",
          tradeDate: "2026-01-03",
          realizedPnlAmount: null,
        }),
      ],
      total: 4,
      limit: 2,
      offset: 1,
      aggregates: {
        realizedPnlByCurrency: [
          { currency: "TWD", amount: 150 },
        ],
      },
    });
  });

  it("returns canonical BUY booked cost and leaves SELL booked cost unavailable", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-booked-cost-buy" },
      payload: transactionPayload({
        tradeDate: "2026-02-01",
        ticker: "2330",
        quantity: 10,
        unitPrice: 100,
        commissionAmount: 2,
        taxAmount: 3,
      }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "history-booked-cost-sell" },
      payload: transactionPayload({
        tradeDate: "2026-02-10",
        ticker: "2330",
        type: "SELL",
        quantity: 5,
        unitPrice: 110,
        commissionAmount: 4,
        taxAmount: 5,
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/transactions/history?marketCode=TW&limit=10&offset=0",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({
        type: "SELL",
        tradeDate: "2026-02-10",
        bookedCostAmount: null,
      }),
      expect.objectContaining({
        type: "BUY",
        tradeDate: "2026-02-01",
        bookedCostAmount: 1005,
      }),
    ]);
  });
});
