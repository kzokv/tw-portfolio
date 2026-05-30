import type { InstrumentType, MarketCode } from "./types.js";

const TW_ETF_CATEGORIES = ["ETF", "上櫃ETF", "上櫃指數股票型基金(ETF)"];
const TW_UNMAPPABLE_CATEGORIES = ["ETN", "指數投資證券(ETN)", "Index", "大盤", "存託憑證", "受益證券", "所有證券"];

/**
 * KZO-170 — US classifier seed. Hand-curated allow-list keyed on `stock_id` (ticker). The
 * substring strategy used for TW (`industryCategory.includes("ETF")`) does NOT carry over
 * to FinMind v4's `USStockInfo` — Phase-1 verification (2026-05-02) confirmed the field
 * is `Subsector` (free text like `"Computer Manufacturing"`, `"Aluminum"`, `"Blank Checks"`)
 * and DOES NOT contain a `"ETF"` or `"Bond ETF"` token in observed samples. Substring
 * matching against `Subsector` would produce zero ETF classifications.
 *
 * Seed list covers the 4 reserved E2E tickers + a small starter set. Any ticker not in
 * the allow-list defaults to `STOCK`. Comprehensive coverage is deferred — KZO-187 (US
 * dividend ingestion) is the natural place to expand the list as real instruments enter
 * the catalog.
 *
 * Per-architect lockdown 2026-05-02:
 * - AAPL → STOCK
 * - MSFT → STOCK
 * - VOO → ETF
 * - BND → BOND_ETF
 *
 * Subsector evidence (verified via Phase-1 verification curl):
 * - `AAPL` → `Subsector: "Computer Manufacturing"`
 * - Bond ETFs typically appear under Subsectors like `"Investment Trusts/Mutual Funds"`,
 *   but the only authoritative `BOND_ETF` signal in the seed is the curated ticker list.
 */
const US_INSTRUMENT_TYPE_BY_TICKER: Record<string, InstrumentType> = {
  AAPL: "STOCK",
  MSFT: "STOCK",
  VOO: "ETF",
  BND: "BOND_ETF",
};

/**
 * Classify a raw instrument-catalog row to one of `STOCK`, `ETF`, `BOND_ETF`, or `null`
 * (unmappable / index meta).
 *
 * @param industryCategory  The provider's classification field. For TW (FinMind
 *   `TaiwanStockInfo`), this is `industry_category`. For US (FinMind `USStockInfo`),
 *   this is `Subsector` — but the US branch ignores this field and routes through the
 *   ticker allow-list above.
 * @param ticker            Stock identifier; load-bearing for both branches (TW uses
 *   `endsWith("B")` for BOND_ETF; US uses the allow-list).
 * @param marketCode        Per-market dispatch. Defaults to `"TW"` so existing TW callers
 *   that don't yet plumb `marketCode` keep working — the default will be removed in a
 *   follow-up once every caller passes the market explicitly.
 */
export function classifyInstrument(
  industryCategory: string | null,
  ticker: string,
  marketCode: MarketCode = "TW",
): InstrumentType | null {
  if (marketCode === "US") {
    if (industryCategory === null) return null;
    // KZO-170: hand-curated US allow-list (see seed list above). Default fallback STOCK.
    return US_INSTRUMENT_TYPE_BY_TICKER[ticker] ?? "STOCK";
  }

  // KZO-172 — AU branch BEFORE the TW substring path. Yahoo's `quote()` returns
  // `quoteType: "EQUITY" | "ETF" | ...` which the AU provider passes through verbatim
  // to `industryCategory`. The classifier maps `"ETF"` → ETF and everything else → STOCK.
  // No `BOND_ETF` for AU in v1 (spike-locked — sample contains none, and Yahoo's
  // `quoteType` does not distinguish bond ETFs). Spike §6 + scope-todo Phase 6.
  if (marketCode === "AU") {
    if (industryCategory === null) return "STOCK";
    return industryCategory === "ETF" ? "ETF" : "STOCK";
  }

  // KR branch mirrors the scoped free-provider catalog contract:
  // Twelve Data KR emits `"ETF"` for ETF rows and stock-like literals
  // (`"Common Stock"`, `"Preferred Stock"`, `"REIT"`) for included KRX stock rows.
  // ETNs / warrants are filtered at the provider boundary, so any non-ETF KR row
  // that reaches classification is stock-like.
  if (marketCode === "KR") {
    if (industryCategory === null) return "STOCK";
    return industryCategory === "ETF" ? "ETF" : "STOCK";
  }

  // TW: legacy substring path.
  if (industryCategory === null) return null;

  if (TW_ETF_CATEGORIES.includes(industryCategory)) {
    return ticker.endsWith("B") ? "BOND_ETF" : "ETF";
  }

  if (TW_UNMAPPABLE_CATEGORIES.includes(industryCategory)) {
    return null;
  }

  return "STOCK";
}
