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
    expect(holdings[0].quantity).toBe(20);
  });
});
