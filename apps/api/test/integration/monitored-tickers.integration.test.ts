import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("monitored tickers routes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  function seedInstrument(instrument: {
    ticker: string;
    name: string;
    instrumentType: string | null;
    marketCode: string;
    barsBackfillStatus: string;
    delistedAt?: string;
  }): void {
    (app.persistence as MemoryPersistence)._seedInstrument(instrument);
  }

  describe("GET /instruments", () => {
    it("returns empty catalog when no instruments exist", async () => {
      const res = await app.inject({ method: "GET", url: "/instruments" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ instruments: [] });
    });

    it("returns all instruments", async () => {
      seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      seedInstrument({ ticker: "0050", name: "TW Top 50 ETF", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "ready" });

      const res = await app.inject({ method: "GET", url: "/instruments" });
      expect(res.statusCode).toBe(200);
      expect(res.json().instruments).toHaveLength(2);
    });

    it("filters by search query", async () => {
      seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      seedInstrument({ ticker: "2317", name: "Hon Hai", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" });

      const res = await app.inject({ method: "GET", url: "/instruments?search=tsmc" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.instruments).toHaveLength(1);
      expect(body.instruments[0].ticker).toBe("2330");
    });

    it("filters by type", async () => {
      seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      seedInstrument({ ticker: "0050", name: "TW Top 50 ETF", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "ready" });

      const res = await app.inject({ method: "GET", url: "/instruments?type=ETF" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.instruments).toHaveLength(1);
      expect(body.instruments[0].ticker).toBe("0050");
    });

    it("excludes delisted instruments from the catalog response", async () => {
      seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      seedInstrument({
        ticker: "2303",
        name: "UMC",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
        delistedAt: "2026-03-01T00:00:00Z",
      });

      const res = await app.inject({ method: "GET", url: "/instruments?search=2" });
      expect(res.statusCode).toBe(200);
      expect(res.json().instruments.map((instrument: { ticker: string }) => instrument.ticker)).toEqual(["2330"]);
    });
  });

  describe("GET /monitored-tickers", () => {
    it("returns empty set for new user", async () => {
      const res = await app.inject({ method: "GET", url: "/monitored-tickers" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ tickers: [] });
    });

    it("returns manual selections after PUT", async () => {
      seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });

      await app.inject({
        method: "PUT",
        url: "/monitored-tickers",
        payload: { tickers: [{ ticker: "2330", marketCode: "TW" }] },
      });

      const res = await app.inject({ method: "GET", url: "/monitored-tickers" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tickers).toHaveLength(1);
      expect(body.tickers[0]).toMatchObject({
        ticker: "2330",
        source: "manual",
        name: "TSMC",
      });
    });
  });

  describe("PUT /monitored-tickers", () => {
    it("replaces manual selections and returns updated set", async () => {
      seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      seedInstrument({ ticker: "2317", name: "Hon Hai", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" });

      const res = await app.inject({
        method: "PUT",
        url: "/monitored-tickers",
        payload: { tickers: [{ ticker: "2330", marketCode: "TW" }, { ticker: "2317", marketCode: "TW" }] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tickers).toHaveLength(2);
      expect(body.newTickers.sort()).toEqual(["2317", "2330"]);
    });

    it("returns only genuinely new tickers on subsequent replace", async () => {
      seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      seedInstrument({ ticker: "2317", name: "Hon Hai", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" });

      // First: add 2330
      await app.inject({
        method: "PUT",
        url: "/monitored-tickers",
        payload: { tickers: [{ ticker: "2330", marketCode: "TW" }] },
      });

      // Second: replace with 2330 + 2317 — only 2317 is new
      const res = await app.inject({
        method: "PUT",
        url: "/monitored-tickers",
        payload: { tickers: [{ ticker: "2330", marketCode: "TW" }, { ticker: "2317", marketCode: "TW" }] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().newTickers).toEqual(["2317"]);
    });

    it("validates tickers array", async () => {
      const res = await app.inject({
        method: "PUT",
        url: "/monitored-tickers",
        payload: { tickers: "not-an-array" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("normalizes tickers to uppercase", async () => {
      seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });

      const res = await app.inject({
        method: "PUT",
        url: "/monitored-tickers",
        payload: { tickers: [{ ticker: "2330", marketCode: "TW" }] },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().tickers[0].ticker).toBe("2330");
    });
  });
});
