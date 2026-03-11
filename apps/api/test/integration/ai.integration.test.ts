import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("ai transactions", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("does not partially apply confirm when one proposal fails", async () => {
    const confirm = await app.inject({
      method: "POST",
      url: "/ai/transactions/confirm",
      payload: {
        accountId: "acc-1",
        proposals: [
          {
            type: "BUY",
            symbol: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-01",
            isDayTrade: false,
          },
          {
            type: "BUY",
            symbol: "UNKNOWN",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-01",
            isDayTrade: false,
          },
        ],
      },
    });
    expect(confirm.statusCode).toBe(400);

    const transactions = await app.inject({ method: "GET", url: "/portfolio/transactions" });
    expect(transactions.statusCode).toBe(200);
    expect(transactions.json()).toEqual([]);
  });
});
