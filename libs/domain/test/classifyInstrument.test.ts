import { describe, it, expect } from "vitest";
import { classifyInstrument } from "../src/classifyInstrument.js";

describe("classifyInstrument", () => {
  it("classifies standard industry category as STOCK", () => {
    expect(classifyInstrument("半導體業", "2330")).toBe("STOCK");
    expect(classifyInstrument("金融保險業", "2884")).toBe("STOCK");
    expect(classifyInstrument("其他電子業", "2317")).toBe("STOCK");
  });

  it("classifies ETF categories as ETF", () => {
    expect(classifyInstrument("ETF", "0050")).toBe("ETF");
    expect(classifyInstrument("上櫃ETF", "006201")).toBe("ETF");
    expect(classifyInstrument("上櫃指數股票型基金(ETF)", "006208")).toBe("ETF");
  });

  it("classifies ETF category with ticker ending B as BOND_ETF", () => {
    expect(classifyInstrument("ETF", "00679B")).toBe("BOND_ETF");
    expect(classifyInstrument("上櫃ETF", "00695B")).toBe("BOND_ETF");
  });

  it("returns null for unmappable categories", () => {
    expect(classifyInstrument("ETN", "020000")).toBeNull();
    expect(classifyInstrument("指數投資證券(ETN)", "020001")).toBeNull();
    expect(classifyInstrument("Index", "IX0001")).toBeNull();
    expect(classifyInstrument("大盤", "IX0099")).toBeNull();
    expect(classifyInstrument("存託憑證", "910322")).toBeNull();
    expect(classifyInstrument("受益證券", "01001T")).toBeNull();
    expect(classifyInstrument("所有證券", "ALLSEC")).toBeNull();
  });

  it("returns null for null category (provisional)", () => {
    expect(classifyInstrument(null, "9999")).toBeNull();
  });
});
