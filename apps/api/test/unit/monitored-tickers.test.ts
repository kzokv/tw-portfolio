import { describe, expect, it, beforeEach } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";

describe("monitored tickers", () => {
  let persistence: MemoryPersistence;
  const userId = "user-1";

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    await persistence.init();
    // Ensure user has a store with default data
    await persistence.loadStore(userId);
  });

  describe("getMonitoredSet", () => {
    it("returns empty array when no manual selections or positions exist", async () => {
      const result = await persistence.getMonitoredSet(userId);
      expect(result).toEqual([]);
    });

    it("returns manual selections with source 'manual'", async () => {
      // Seed an instrument so manual selection is valid
      persistence._seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      await persistence.replaceManualSelections(userId, ["2330"]);

      const result = await persistence.getMonitoredSet(userId);
      expect(result).toEqual([
        {
          ticker: "2330",
          source: "manual",
          name: "TSMC",
          instrumentType: "STOCK",
          barsBackfillStatus: "pending",
        },
      ]);
    });

    it("returns position-derived tickers with source 'position'", async () => {
      // Seed an instrument and a lot with open quantity
      persistence._seedInstrument({ ticker: "2317", name: "Hon Hai", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" });
      const store = await persistence.loadStore(userId);
      const accountId = store.accounts[0].id;
      store.accounting.projections.lots.push({
        id: "lot-1",
        accountId,
        ticker: "2317",
        openQuantity: 100,
        totalCostAmount: 50000,
        costCurrency: "TWD",
        openedAt: "2026-01-15",
      });

      const result = await persistence.getMonitoredSet(userId);
      expect(result).toEqual([
        {
          ticker: "2317",
          source: "position",
          name: "Hon Hai",
          instrumentType: "STOCK",
          barsBackfillStatus: "ready",
        },
      ]);
    });

    it("deduplicates: manual + position returns source 'manual'", async () => {
      persistence._seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      await persistence.replaceManualSelections(userId, ["2330"]);

      const store = await persistence.loadStore(userId);
      const accountId = store.accounts[0].id;
      store.accounting.projections.lots.push({
        id: "lot-2",
        accountId,
        ticker: "2330",
        openQuantity: 50,
        totalCostAmount: 30000,
        costCurrency: "TWD",
        openedAt: "2026-02-01",
      });

      const result = await persistence.getMonitoredSet(userId);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        ticker: "2330",
        source: "manual",
      });
    });

    it("returns null metadata for position-derived ticker without instrument data", async () => {
      const store = await persistence.loadStore(userId);
      const accountId = store.accounts[0].id;
      store.accounting.projections.lots.push({
        id: "lot-3",
        accountId,
        ticker: "9999",
        openQuantity: 10,
        totalCostAmount: 5000,
        costCurrency: "TWD",
        openedAt: "2026-01-01",
      });

      const result = await persistence.getMonitoredSet(userId);
      expect(result).toEqual([
        {
          ticker: "9999",
          source: "position",
          name: null,
          instrumentType: null,
          barsBackfillStatus: null,
        },
      ]);
    });
  });

  describe("getManualSelections", () => {
    it("returns empty array when no selections exist", async () => {
      const result = await persistence.getManualSelections(userId);
      expect(result).toEqual([]);
    });

    it("returns manual selections with addedAt timestamp", async () => {
      persistence._seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      await persistence.replaceManualSelections(userId, ["2330"]);

      const result = await persistence.getManualSelections(userId);
      expect(result).toHaveLength(1);
      expect(result[0].ticker).toBe("2330");
      expect(result[0].addedAt).toBeDefined();
    });
  });

  describe("replaceManualSelections", () => {
    it("replaces all manual selections atomically", async () => {
      persistence._seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      persistence._seedInstrument({ ticker: "2317", name: "Hon Hai", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" });
      persistence._seedInstrument({ ticker: "0050", name: "Yuanta/P-shares TW Top50", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "pending" });

      await persistence.replaceManualSelections(userId, ["2330", "2317"]);
      let selections = await persistence.getManualSelections(userId);
      expect(selections.map((s) => s.ticker).sort()).toEqual(["2317", "2330"]);

      // Replace with different set
      await persistence.replaceManualSelections(userId, ["0050"]);
      selections = await persistence.getManualSelections(userId);
      expect(selections.map((s) => s.ticker)).toEqual(["0050"]);
    });

    it("returns newTickers that are genuinely new to the full monitored set", async () => {
      persistence._seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      persistence._seedInstrument({ ticker: "2317", name: "Hon Hai", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" });

      // 2317 is already in the monitored set via position
      const store = await persistence.loadStore(userId);
      const accountId = store.accounts[0].id;
      store.accounting.projections.lots.push({
        id: "lot-4",
        accountId,
        ticker: "2317",
        openQuantity: 100,
        totalCostAmount: 50000,
        costCurrency: "TWD",
        openedAt: "2026-01-15",
      });

      // Adding both 2330 and 2317 — only 2330 is genuinely new
      const result = await persistence.replaceManualSelections(userId, ["2330", "2317"]);
      expect(result.newTickers).toEqual(["2330"]);
    });

    it("returns empty newTickers when adding tickers already in monitored set", async () => {
      persistence._seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      await persistence.replaceManualSelections(userId, ["2330"]);

      // Replace with same set — no new tickers
      const result = await persistence.replaceManualSelections(userId, ["2330"]);
      expect(result.newTickers).toEqual([]);
    });
  });

  describe("listInstrumentsCatalog", () => {
    beforeEach(() => {
      persistence._seedInstrument({ ticker: "2330", name: "TSMC", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" });
      persistence._seedInstrument({ ticker: "2317", name: "Hon Hai Precision", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" });
      persistence._seedInstrument({ ticker: "0050", name: "Yuanta/P-shares Taiwan Top 50 ETF", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "pending" });
    });

    it("returns all instruments when no filters applied", async () => {
      const result = await persistence.listInstrumentsCatalog();
      expect(result).toHaveLength(3);
    });

    it("filters by ticker search (case-insensitive)", async () => {
      const result = await persistence.listInstrumentsCatalog("233");
      expect(result).toHaveLength(1);
      expect(result[0].ticker).toBe("2330");
    });

    it("filters by name search (case-insensitive)", async () => {
      const result = await persistence.listInstrumentsCatalog("hon hai");
      expect(result).toHaveLength(1);
      expect(result[0].ticker).toBe("2317");
    });

    it("filters by instrument type", async () => {
      const result = await persistence.listInstrumentsCatalog(undefined, "ETF");
      expect(result).toHaveLength(1);
      expect(result[0].ticker).toBe("0050");
    });

    it("applies both search and type filter", async () => {
      const result = await persistence.listInstrumentsCatalog("yuanta", "ETF");
      expect(result).toHaveLength(1);
      expect(result[0].ticker).toBe("0050");
    });

    it("excludes delisted instruments even when they match search filters", async () => {
      persistence._seedInstrument({
        ticker: "2303",
        name: "UMC",
        instrumentType: "STOCK",
        marketCode: "TW",
        barsBackfillStatus: "ready",
        delistedAt: "2026-03-01T00:00:00Z",
      });

      expect(await persistence.listInstrumentsCatalog()).toHaveLength(3);

      const searchResult = await persistence.listInstrumentsCatalog("umc");
      expect(searchResult).toEqual([]);
    });

    it("returns empty for non-matching search", async () => {
      const result = await persistence.listInstrumentsCatalog("nonexistent");
      expect(result).toEqual([]);
    });

    it("uses user-scoped seeded catalogs without leaking across users", async () => {
      persistence._replaceInstruments([
        { ticker: "0050", name: "Scoped ETF", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "pending" },
      ], userId);

      const otherUserId = "user-2";
      persistence._replaceInstruments([
        { ticker: "2330", name: "Scoped Stock", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
      ], otherUserId);

      expect((await persistence.listInstrumentsCatalog(undefined, undefined, userId)).map((item) => item.ticker)).toEqual(["0050"]);
      expect((await persistence.listInstrumentsCatalog(undefined, undefined, otherUserId)).map((item) => item.ticker)).toEqual(["2330"]);
      expect((await persistence.listInstrumentsCatalog()).map((item) => item.ticker)).toEqual(["2330", "2317", "0050"]);
    });
  });
});
