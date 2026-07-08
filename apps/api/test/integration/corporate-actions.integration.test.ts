import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { transactionPayload, corporateActionDividendPayload, corporateActionSplitPayload } from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("corporate-actions", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("rejects corporate actions for unknown account ids", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/corporate-actions",
      payload: corporateActionDividendPayload({ accountId: "acc-missing" }),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("account_not_found");

    const actions = await app.inject({ method: "GET", url: "/corporate-actions" });
    expect(actions.statusCode).toBe(200);
    expect(actions.json()).toEqual([]);
  });

  it("records dividend and split for existing account with positions", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-ca-buy" },
      payload: transactionPayload(),
    });

    const dividendResponse = await app.inject({
      method: "POST",
      url: "/corporate-actions",
      payload: corporateActionDividendPayload(),
    });
    expect(dividendResponse.statusCode).toBe(200);
    const dividend = dividendResponse.json();
    expect(dividend.actionType).toBe("DIVIDEND");
    expect(dividend.accountId).toBe("acc-1");
    expect(dividend.ticker).toBe("2330");

    const splitResponse = await app.inject({
      method: "POST",
      url: "/corporate-actions",
      payload: corporateActionSplitPayload(),
    });
    expect(splitResponse.statusCode).toBe(200);
    const split = splitResponse.json();
    expect(split.actionType).toBe("SPLIT");
    expect(split.numerator).toBe(2);
    expect(split.denominator).toBe(1);

    const listResponse = await app.inject({ method: "GET", url: "/corporate-actions" });
    expect(listResponse.statusCode).toBe(200);
    const actions = listResponse.json();
    expect(actions.length).toBe(2);

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdingsResponse.statusCode).toBe(200);
    const holdings = holdingsResponse.json();
    expect(holdings.length).toBe(1);
    expect(holdings[0].ticker).toBe("2330");
    expect(holdings[0].quantity).toBe(22);
  });

  it("blocks reverse splits that would require fractional cash-in-lieu handling", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-ca-reverse-buy" },
      payload: transactionPayload(),
    });

    const reverseSplitResponse = await app.inject({
      method: "POST",
      url: "/corporate-actions",
      payload: corporateActionSplitPayload({
        actionType: "REVERSE_SPLIT",
        numerator: 1,
        denominator: 3,
      }),
    });

    expect(reverseSplitResponse.statusCode).toBeGreaterThanOrEqual(400);
    expect(reverseSplitResponse.statusCode).toBeLessThan(500);

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdingsResponse.statusCode).toBe(200);
    const holdings = holdingsResponse.json();
    expect(holdings).toEqual([
      expect.objectContaining({
        ticker: "2330",
        quantity: 10,
      }),
    ]);
  });

  it("keeps split preview and replay consistent when per-lot fractions add to a whole share", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-ca-fraction-buy-1" },
      payload: transactionPayload({ quantity: 1, tradeDate: "2026-01-01" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-ca-fraction-buy-2" },
      payload: transactionPayload({ quantity: 1, tradeDate: "2026-01-02" }),
    });

    const reverseSplitResponse = await app.inject({
      method: "POST",
      url: "/corporate-actions",
      payload: corporateActionSplitPayload({
        actionType: "REVERSE_SPLIT",
        numerator: 1,
        denominator: 2,
        cashInLieuAmount: 100,
      }),
    });

    expect(reverseSplitResponse.statusCode).toBe(200);
    const body = reverseSplitResponse.json();
    expect(body.preview).toEqual(expect.objectContaining({
      beforeQuantity: 2,
      afterQuantity: 0,
      fractionalQuantity: 1,
      blocked: false,
    }));

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdingsResponse.statusCode).toBe(200);
    expect(holdingsResponse.json()).toEqual([]);
  });

  it("rejects historical split actions that make later sells impossible without mutating projections", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-ca-preflight-buy" },
      payload: transactionPayload({ quantity: 10, tradeDate: "2026-01-01" }),
    });
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-ca-preflight-sell" },
      payload: transactionPayload({ type: "SELL", quantity: 8, tradeDate: "2026-03-01" }),
    });

    const holdingsBefore = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    const actionsBefore = await app.inject({ method: "GET", url: "/corporate-actions" });
    expect(holdingsBefore.statusCode).toBe(200);
    expect(actionsBefore.statusCode).toBe(200);

    const reverseSplitResponse = await app.inject({
      method: "POST",
      url: "/corporate-actions",
      payload: corporateActionSplitPayload({
        actionType: "REVERSE_SPLIT",
        numerator: 1,
        denominator: 2,
        actionDate: "2026-02-01",
        cashInLieuAmount: 100,
      }),
    });

    expect(reverseSplitResponse.statusCode).toBe(500);
    expect(reverseSplitResponse.json().error).toBe("internal_error");

    const holdingsAfter = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    const actionsAfter = await app.inject({ method: "GET", url: "/corporate-actions" });
    expect(holdingsAfter.statusCode).toBe(200);
    expect(actionsAfter.statusCode).toBe(200);
    expect(holdingsAfter.json()).toEqual(holdingsBefore.json());
    expect(actionsAfter.json()).toEqual(actionsBefore.json());
  });

  it("previews historical splits from action-date holdings instead of later buys", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-ca-later-buy" },
      payload: transactionPayload({ quantity: 1, tradeDate: "2026-03-01" }),
    });

    const reverseSplitResponse = await app.inject({
      method: "POST",
      url: "/corporate-actions",
      payload: corporateActionSplitPayload({
        actionType: "REVERSE_SPLIT",
        numerator: 1,
        denominator: 3,
        actionDate: "2026-02-01",
      }),
    });

    expect(reverseSplitResponse.statusCode).toBe(200);
    expect(reverseSplitResponse.json().preview).toEqual(expect.objectContaining({
      beforeQuantity: 0,
      afterQuantity: 0,
      fractionalQuantity: 0,
      blocked: false,
    }));

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdingsResponse.statusCode).toBe(200);
    expect(holdingsResponse.json()).toEqual([
      expect.objectContaining({
        ticker: "2330",
        quantity: 1,
      }),
    ]);
  });
});
