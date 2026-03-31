import { classifyInstrument } from "@tw-portfolio/domain";
import type { RawInstrumentInfo } from "./types.js";
import type { CatalogInstrument } from "../../persistence/types.js";

export const UMBRELLA_CATEGORIES = ["電子工業", "化學生技醫療", "觀光餐旅"];
export const INDEX_META_CATEGORIES = ["Index", "大盤", "所有證券"];

export function deduplicateInstruments(raw: RawInstrumentInfo[]): RawInstrumentInfo[] {
  // Filter out INDEX/META entries entirely
  const filtered = raw.filter((r) => !INDEX_META_CATEGORIES.includes(r.industryCategory));

  // Group by ticker
  const groups = new Map<string, RawInstrumentInfo[]>();
  for (const row of filtered) {
    const existing = groups.get(row.ticker);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(row.ticker, [row]);
    }
  }

  const result: RawInstrumentInfo[] = [];
  for (const rows of groups.values()) {
    if (rows.length === 1) {
      result.push(rows[0]!);
      continue;
    }

    // Sort by date DESC
    rows.sort((a, b) => b.date.localeCompare(a.date));
    const latestDate = rows[0]!.date;

    // Keep only rows with the latest date
    const latestRows = rows.filter((r) => r.date === latestDate);

    if (latestRows.length === 1) {
      result.push(latestRows[0]!);
      continue;
    }

    // Filter out umbrella categories, take first remaining
    const nonUmbrella = latestRows.filter((r) => !UMBRELLA_CATEGORIES.includes(r.industryCategory));
    result.push(nonUmbrella.length > 0 ? nonUmbrella[0]! : latestRows[0]!);
  }

  return result;
}

export function buildCatalogInstruments(deduped: RawInstrumentInfo[]): CatalogInstrument[] {
  return deduped.map((r) => ({
    ticker: r.ticker,
    name: r.name,
    typeRaw: r.typeRaw,
    industryCategoryRaw: r.industryCategory,
    finmindDate: r.date,
    instrumentType: classifyInstrument(r.industryCategory, r.ticker),
  }));
}
