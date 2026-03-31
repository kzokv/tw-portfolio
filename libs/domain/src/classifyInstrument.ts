import type { InstrumentType } from "./types.js";

const ETF_CATEGORIES = ["ETF", "上櫃ETF", "上櫃指數股票型基金(ETF)"];
const UNMAPPABLE_CATEGORIES = ["ETN", "指數投資證券(ETN)", "Index", "大盤", "存託憑證", "受益證券", "所有證券"];

export function classifyInstrument(industryCategory: string | null, ticker: string): InstrumentType | null {
  if (industryCategory === null) return null;

  if (ETF_CATEGORIES.includes(industryCategory)) {
    return ticker.endsWith("B") ? "BOND_ETF" : "ETF";
  }

  if (UNMAPPABLE_CATEGORIES.includes(industryCategory)) {
    return null;
  }

  return "STOCK";
}
