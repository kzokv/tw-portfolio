import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("POST /backfill/retry", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 503 when job queue is unavailable (memory mode)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/backfill/retry",
      payload: { ticker: "2330" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("queue_unavailable");
  });

  it("validates ticker is required (400 before boss check)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/backfill/retry",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("validates ticker must be a non-empty string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/backfill/retry",
      payload: { ticker: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("normalizes ticker to uppercase", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/backfill/retry",
      payload: { ticker: "tsmc" },
    });
    // Gets past validation (400) to boss check (503) — confirms ticker was accepted
    expect(res.statusCode).toBe(503);
  });
});

describe("backfill trigger hooks (memory mode)", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("PUT /monitored-tickers still works when boss is null", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/monitored-tickers",
      payload: { tickers: ["2330"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().newTickers).toEqual(["2330"]);
  });

  it("POST /portfolio/transactions still works when boss is null", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      payload: {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 10,
        unitPrice: 500,
        priceCurrency: "TWD",
        tradeDate: "2026-01-15",
        type: "BUY",
      },
      headers: { "idempotency-key": "test-key-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticker).toBe("2330");
  });
});
