import { describe, it, expect } from "vitest";
import { deduplicateInstruments, buildCatalogInstruments, UMBRELLA_CATEGORIES, INDEX_META_CATEGORIES } from "../../src/services/market-data/catalogSync.js";
import type { RawInstrumentInfo } from "../../src/services/market-data/types.js";

describe("deduplicateInstruments", () => {
  it("Pattern A: picks non-umbrella over umbrella category (same date)", () => {
    const raw: RawInstrumentInfo[] = [
      { ticker: "2330", name: "台積電", typeRaw: "twse", industryCategory: "半導體業", date: "2026-03-31" },
      { ticker: "2330", name: "台積電", typeRaw: "twse", industryCategory: "電子工業", date: "2026-03-31" },
    ];
    const result = deduplicateInstruments(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.industryCategory).toBe("半導體業");
  });

  it("Pattern B: picks latest date when dates differ", () => {
    const raw: RawInstrumentInfo[] = [
      { ticker: "2317", name: "鴻海", typeRaw: "twse", industryCategory: "其他電子業", date: "2026-03-31" },
      { ticker: "2317", name: "鴻海", typeRaw: "twse", industryCategory: "電子零組件業", date: "2026-03-30" },
    ];
    const result = deduplicateInstruments(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.date).toBe("2026-03-31");
    expect(result[0]!.industryCategory).toBe("其他電子業");
  });

  it("Pattern C: filters umbrella when multiple same-date entries exist", () => {
    const raw: RawInstrumentInfo[] = [
      { ticker: "1234", name: "TestCo", typeRaw: "twse", industryCategory: "化學生技醫療", date: "2026-03-31" },
      { ticker: "1234", name: "TestCo", typeRaw: "twse", industryCategory: "生技醫療業", date: "2026-03-31" },
    ];
    const result = deduplicateInstruments(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.industryCategory).toBe("生技醫療業");
  });

  it("filters out INDEX/META entries entirely", () => {
    const raw: RawInstrumentInfo[] = [
      { ticker: "IX0001", name: "加權指數", typeRaw: "twse", industryCategory: "大盤", date: "2026-03-31" },
      { ticker: "IX0099", name: "所有證券", typeRaw: "twse", industryCategory: "所有證券", date: "2026-03-31" },
      { ticker: "IDX001", name: "Index", typeRaw: "twse", industryCategory: "Index", date: "2026-03-31" },
      { ticker: "2330", name: "台積電", typeRaw: "twse", industryCategory: "半導體業", date: "2026-03-31" },
    ];
    const result = deduplicateInstruments(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.ticker).toBe("2330");
  });

  it("filters out tickers with special characters (e.g. ^DJI, ^GSPC)", () => {
    const raw: RawInstrumentInfo[] = [
      { ticker: "^DJI", name: "Dow Jones Industrial Average", typeRaw: "US", industryCategory: "n/a", date: "2026-05-01" },
      { ticker: "^GSPC", name: "S&P 500", typeRaw: "US", industryCategory: "n/a", date: "2026-05-01" },
      { ticker: "AAPL", name: "Apple Inc.", typeRaw: "US", industryCategory: "Computer Manufacturing", date: "2026-05-01" },
    ];
    const result = deduplicateInstruments(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.ticker).toBe("AAPL");
  });

  it("handles single-entry tickers without dedup", () => {
    const raw: RawInstrumentInfo[] = [
      { ticker: "0050", name: "元大台灣50", typeRaw: "twse", industryCategory: "ETF", date: "2026-03-31" },
    ];
    const result = deduplicateInstruments(raw);
    expect(result).toHaveLength(1);
    expect(result[0]!.ticker).toBe("0050");
  });

  it("exports umbrella and index constants", () => {
    expect(UMBRELLA_CATEGORIES).toContain("電子工業");
    expect(UMBRELLA_CATEGORIES).toContain("化學生技醫療");
    expect(UMBRELLA_CATEGORIES).toContain("觀光餐旅");
    expect(INDEX_META_CATEGORIES).toContain("Index");
    expect(INDEX_META_CATEGORIES).toContain("大盤");
    expect(INDEX_META_CATEGORIES).toContain("所有證券");
  });
});

describe("buildCatalogInstruments", () => {
  it("classifies instruments via classifyInstrument", () => {
    const deduped: RawInstrumentInfo[] = [
      { ticker: "2330", name: "台積電", typeRaw: "twse", industryCategory: "半導體業", date: "2026-03-31" },
      { ticker: "0050", name: "元大台灣50", typeRaw: "twse", industryCategory: "ETF", date: "2026-03-31" },
      { ticker: "00679B", name: "元大美債20年", typeRaw: "twse", industryCategory: "ETF", date: "2026-03-31" },
    ];
    const result = buildCatalogInstruments(deduped);
    expect(result).toHaveLength(3);
    expect(result[0]!.instrumentType).toBe("STOCK");
    expect(result[1]!.instrumentType).toBe("ETF");
    expect(result[2]!.instrumentType).toBe("BOND_ETF");
  });

  it("sets instrumentType to null for unmappable categories", () => {
    const deduped: RawInstrumentInfo[] = [
      { ticker: "020000", name: "富邦臺灣加權ETN", typeRaw: "twse", industryCategory: "指數投資證券(ETN)", date: "2026-03-31" },
    ];
    const result = buildCatalogInstruments(deduped);
    expect(result).toHaveLength(1);
    expect(result[0]!.instrumentType).toBeNull();
  });

  it("maps all raw fields to CatalogInstrument shape", () => {
    const deduped: RawInstrumentInfo[] = [
      { ticker: "2330", name: "台積電", typeRaw: "twse", industryCategory: "半導體業", date: "2026-03-31" },
    ];
    const result = buildCatalogInstruments(deduped);
    expect(result[0]).toEqual({
      ticker: "2330",
      name: "台積電",
      typeRaw: "twse",
      industryCategoryRaw: "半導體業",
      finmindDate: "2026-03-31",
      instrumentType: "STOCK",
      marketCode: "TW",
      catalogExchangeRaw: null,
      catalogMicCode: null,
    });
  });
});
