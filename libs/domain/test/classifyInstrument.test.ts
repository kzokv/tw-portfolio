import { describe, it, expect } from "vitest";
import { classifyInstrument } from "../src/classifyInstrument.js";

// KZO-170 (D6 REVISED 2026-05-02 via Phase-1 G-NC-1 resolution Option C):
// `classifyInstrument(industryCategory, ticker, marketCode)` gains a market
// parameter. The TW branch keeps the existing `(industryCategory, ticker)`
// semantics. The US branch reads FinMind `USStockInfo.Subsector` (free-text;
// samples include "Computer Manufacturing", "EDPServices", "Aluminum", etc.)
// — there's NO clean "ETF"/"Bond ETF" token visible in the catalog, so the
// classifier uses a HAND-CURATED ALLOW-LIST keyed on (subsector, ticker)
// instead of the originally-planned substring scan.
//
// Allow-list per scope-todo D6 revised:
//   AAPL → STOCK
//   MSFT → STOCK
//   VOO  → ETF
//   BND  → BOND_ETF
//   default → STOCK fallback
//
// Tests assert ALLOW-LIST CORRECTNESS for the 4 reserved E2E tickers + the
// fallback. Comprehensive coverage of every ETF in the FinMind catalog is
// deferred (autocomplete UX is the load-bearing UX, not classifier accuracy).
//
// Field-shape source: `.worklog/team/escalation.md` § Appendix A.3.

describe("classifyInstrument — TW (default)", () => {
  it("classifies standard industry category as STOCK", () => {
    expect(classifyInstrument("半導體業", "2330", "TW")).toBe("STOCK");
    expect(classifyInstrument("金融保險業", "2884", "TW")).toBe("STOCK");
    expect(classifyInstrument("其他電子業", "2317", "TW")).toBe("STOCK");
  });

  it("classifies ETF categories as ETF", () => {
    expect(classifyInstrument("ETF", "0050", "TW")).toBe("ETF");
    expect(classifyInstrument("上櫃ETF", "006201", "TW")).toBe("ETF");
    expect(classifyInstrument("上櫃指數股票型基金(ETF)", "006208", "TW")).toBe("ETF");
  });

  it("classifies ETF category with ticker ending B as BOND_ETF", () => {
    expect(classifyInstrument("ETF", "00679B", "TW")).toBe("BOND_ETF");
    expect(classifyInstrument("上櫃ETF", "00695B", "TW")).toBe("BOND_ETF");
  });

  it("returns null for unmappable categories", () => {
    expect(classifyInstrument("ETN", "020000", "TW")).toBeNull();
    expect(classifyInstrument("指數投資證券(ETN)", "020001", "TW")).toBeNull();
    expect(classifyInstrument("Index", "IX0001", "TW")).toBeNull();
    expect(classifyInstrument("大盤", "IX0099", "TW")).toBeNull();
    expect(classifyInstrument("存託憑證", "910322", "TW")).toBeNull();
    expect(classifyInstrument("受益證券", "01001T", "TW")).toBeNull();
    expect(classifyInstrument("所有證券", "ALLSEC", "TW")).toBeNull();
  });

  it("returns null for null category (provisional)", () => {
    expect(classifyInstrument(null, "9999", "TW")).toBeNull();
  });

  it("preserves the legacy 2-arg call shape (defaults to TW)", () => {
    // KZO-170 D6: the marketCode parameter is the third arg with TW default
    // so existing call sites in catalogSync.ts continue to compile during
    // the migration.
    expect(classifyInstrument("半導體業", "2330")).toBe("STOCK");
    expect(classifyInstrument("ETF", "0050")).toBe("ETF");
  });
});

describe("classifyInstrument — US (KZO-170 D6 revised: hand-curated allow-list)", () => {
  // Reserved E2E US tickers per scope-todo D8: AAPL / VOO / MSFT / BND.
  // Allow-list-keyed-on-ticker is load-bearing: Subsector samples like
  // "Computer Manufacturing" / "Aluminum" / "Blank Checks" don't carry a
  // clean ETF marker, so ticker is the disambiguator.

  it("AAPL → STOCK (allow-list)", () => {
    // Real Subsector for AAPL: "Computer Manufacturing"
    expect(classifyInstrument("Computer Manufacturing", "AAPL", "US")).toBe("STOCK");
  });

  it("MSFT → STOCK (allow-list)", () => {
    // MSFT's Subsector is also a software/tech-flavored string; the ticker
    // is what pins this entry to STOCK.
    expect(classifyInstrument("EDPServices", "MSFT", "US")).toBe("STOCK");
  });

  it("VOO → ETF (allow-list)", () => {
    // VOO's Subsector might be "Investment Trusts/Mutual Funds" or similar;
    // the allow-list pins VOO → ETF regardless of the Subsector text.
    expect(classifyInstrument("Investment Trusts/Mutual Funds", "VOO", "US")).toBe("ETF");
    // Allow-list must NOT depend on the exact Subsector string for the four
    // reserved tickers — empty / unknown Subsector still classifies via ticker.
    expect(classifyInstrument("", "VOO", "US")).toBe("ETF");
  });

  it("BND → BOND_ETF (allow-list)", () => {
    // BND's Subsector likely doesn't say "Bond ETF" — that's exactly why the
    // allow-list exists. Pin BND → BOND_ETF via the ticker, not the text.
    expect(classifyInstrument("Investment Trusts/Mutual Funds", "BND", "US")).toBe("BOND_ETF");
    expect(classifyInstrument("", "BND", "US")).toBe("BOND_ETF");
  });

  it("falls back to STOCK on tickers absent from the allow-list", () => {
    // Default: any US ticker not in the allow-list classifies as STOCK.
    // Comprehensive coverage of every ETF deferred (autocomplete UX is the
    // load-bearing UX, not classifier accuracy).
    expect(classifyInstrument("Computer Manufacturing", "TSLA", "US")).toBe("STOCK");
    expect(classifyInstrument("Aluminum", "AA", "US")).toBe("STOCK");
    expect(classifyInstrument("EDPServices", "ORCL", "US")).toBe("STOCK");
    expect(classifyInstrument("Other Consumer Services", "MCD", "US")).toBe("STOCK");
  });

  it("returns null for null industry (provisional)", () => {
    // Null Subsector → provisional, same semantics as TW.
    expect(classifyInstrument(null, "AAPL", "US")).toBeNull();
  });

  it("does NOT apply TW's ticker-ending-B rule on US tickers", () => {
    // The "B"-suffix rule is TW-only. A US ticker that happens to end in "B"
    // must still classify via the allow-list (default STOCK fallback if absent).
    expect(classifyInstrument("Materials", "BHP", "US")).toBe("STOCK");
    expect(classifyInstrument("Software", "FOOB", "US")).toBe("STOCK");
  });
});

describe("classifyInstrument — AU (KZO-172)", () => {
  // AU classifier reads Yahoo's `quoteType` literal (forwarded as
  // `industryCategory` from the YahooFinanceAuMarketDataProvider). Spike-locked
  // mapping: `"ETF"` → ETF; everything else (including `"EQUITY"`) → STOCK.
  // **No `BOND_ETF`** in v1 — Yahoo doesn't carry a bond-ETF discriminator on
  // the quoteType field, and the spike defers bond-ETF identification to a
  // follow-up. The TW-only "B"-suffix rule does NOT apply on AU.

  it("VAS → ETF (industryCategory='ETF' is the AU ETF rule)", () => {
    expect(classifyInstrument("ETF", "VAS", "AU")).toBe("ETF");
  });

  it("BHP / CSL / WBC / AFI / GMG / IMD → STOCK on industryCategory='EQUITY'", () => {
    expect(classifyInstrument("EQUITY", "BHP", "AU")).toBe("STOCK");
    expect(classifyInstrument("EQUITY", "CSL", "AU")).toBe("STOCK");
    expect(classifyInstrument("EQUITY", "WBC", "AU")).toBe("STOCK");
    expect(classifyInstrument("EQUITY", "AFI", "AU")).toBe("STOCK");
    expect(classifyInstrument("EQUITY", "GMG", "AU")).toBe("STOCK");
    expect(classifyInstrument("EQUITY", "IMD", "AU")).toBe("STOCK");
  });

  it("AU branch fires BEFORE the TW substring path (ordering invariant)", () => {
    // In the TW branch, `industryCategory='ETF'` + ticker ending in "B" maps to
    // BOND_ETF via the legacy substring rule. If the AU branch ever falls
    // through to the TW path, an AU ticker like "00679B" with industryCategory
    // 'ETF' would incorrectly classify as BOND_ETF instead of ETF. This test
    // pins the AU-first ordering.
    //
    // Note: real ASX tickers don't generally end in B, but this synthetic case
    // is the canonical regression net for the precedence rule.
    expect(classifyInstrument("ETF", "FOOB", "AU")).toBe("ETF"); // NOT BOND_ETF
  });

  it("AU does NOT honor the TW 'ticker-ending-B → BOND_ETF' rule (no BOND_ETF for AU v1)", () => {
    // Even with industryCategory='ETF' and a B-suffixed ticker, AU must NEVER
    // return BOND_ETF — bond-ETF identification on AU is deferred (spike §4.4).
    // Synthetic input pinned here to make the contract explicit.
    expect(classifyInstrument("ETF", "ABCDB", "AU")).toBe("ETF");
  });

  it("classifies null industryCategory on AU as STOCK (defensive default; the 7-row catalog never has null, and Yahoo `quoteType` is non-null)", () => {
    // Scope-todo Phase 6 locks the AU rule as `industryCategory === "ETF"` → ETF,
    // **else STOCK** — including null. This intentionally diverges from the TW/US
    // branches (which return null/provisional on missing industryCategory). The
    // production AU paths (static 7-row catalog + `fetchInstrumentMetadata` via
    // `quote().quoteType`) never emit null, so the divergence has no practical
    // effect; STOCK is a safer default than provisional for any defensive edge.
    expect(classifyInstrument(null, "BHP", "AU")).toBe("STOCK");
  });

  it("non-ETF, non-EQUITY industryCategory still classifies as STOCK on AU (defensive default)", () => {
    // Yahoo's `quoteType` literal could in principle widen — MUTUALFUND, INDEX,
    // CRYPTOCURRENCY etc. The spike-locked rule is "ETF → ETF; else STOCK", so
    // any unrecognized quoteType lands as STOCK rather than null. Provisional
    // null is reserved for the truly-missing case.
    expect(classifyInstrument("MUTUALFUND", "BHP", "AU")).toBe("STOCK");
    expect(classifyInstrument("INDEX", "BHP", "AU")).toBe("STOCK");
  });

  it("AU does NOT regress TW + US existing behavior", () => {
    // A regression check: the AU branch addition must not alter the TW or US
    // dispatch paths. (These cases are also covered by the dedicated TW/US
    // describe blocks above; this is an inline net to flag any branch leakage.)
    expect(classifyInstrument("半導體業", "2330", "TW")).toBe("STOCK");
    expect(classifyInstrument("Computer Manufacturing", "AAPL", "US")).toBe("STOCK");
    expect(classifyInstrument("ETF", "0050", "TW")).toBe("ETF");
  });
});

describe("classifyInstrument — KR", () => {
  it("maps ETF sentinel to ETF and stock-like KRX rows to STOCK", () => {
    expect(classifyInstrument("ETF", "069500", "KR")).toBe("ETF");
    expect(classifyInstrument("Common Stock", "005930", "KR")).toBe("STOCK");
    expect(classifyInstrument("Preferred Stock", "005935", "KR")).toBe("STOCK");
    expect(classifyInstrument("REIT", "088260", "KR")).toBe("STOCK");
  });

  it("does NOT apply TW ticker-ending-B bond ETF behavior to KR", () => {
    expect(classifyInstrument("ETF", "12345B", "KR")).toBe("ETF");
  });

  it("defaults null KR metadata to STOCK because KR catalog filtering happens at provider boundary", () => {
    expect(classifyInstrument(null, "005930", "KR")).toBe("STOCK");
  });
});
