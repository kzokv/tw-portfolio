/**
 * KZO-196 — Deterministic mock for `AsxGicsProvider`. Returns 10 fixed rows
 * spanning ≥3 GICS sectors plus 1 ASX-only ticker (`AUONLY1`) that is NOT in
 * the seeded TD AU catalog — exercises the worker's `unmatched_asx_ticker`
 * log path.
 *
 * Used by tests and dev runs (`AU_CATALOG_PROVIDER_MOCK=true` plus a future
 * `ASX_GICS_PROVIDER_MOCK` toggle if the registry needs one). The constant
 * shape is exported so integration tests can assert against the exact rows.
 */
import type { AsxGicsProvider, RawAsxGicsRow } from "./asxGicsCatalog.js";

export const MOCK_ASX_GICS_ROWS: readonly RawAsxGicsRow[] = [
  // Materials sector
  { ticker: "BHP", companyName: "BHP Group Ltd", gicsIndustryGroup: "Materials" },
  { ticker: "RIO", companyName: "Rio Tinto Ltd", gicsIndustryGroup: "Materials" },
  // Financials sector
  { ticker: "CBA", companyName: "Commonwealth Bank of Australia", gicsIndustryGroup: "Banks" },
  { ticker: "WBC", companyName: "Westpac Banking Corporation", gicsIndustryGroup: "Banks" },
  // Health Care sector
  { ticker: "CSL", companyName: "CSL Limited", gicsIndustryGroup: "Pharmaceuticals, Biotechnology & Life Sciences" },
  // Industrials
  { ticker: "QAN", companyName: "Qantas Airways Ltd", gicsIndustryGroup: "Transportation" },
  // Real Estate
  { ticker: "GMG", companyName: "Goodman Group", gicsIndustryGroup: "Real Estate Management & Development" },
  // Consumer Discretionary
  { ticker: "JBH", companyName: "JB Hi-Fi Limited", gicsIndustryGroup: "Consumer Discretionary Distribution & Retail" },
  // Information Technology
  { ticker: "WTC", companyName: "WiseTech Global Ltd", gicsIndustryGroup: "Software & Services" },
  // ASX-only ticker NOT in seeded TD catalog (exercises unmatched-row path)
  { ticker: "AUONLY1", companyName: "Mock AU-only Holdings", gicsIndustryGroup: "Financial Services" },
];

export class MockAsxGicsCatalogProvider implements AsxGicsProvider {
  readonly providerId = "asx-gics-csv";

  async fetchGicsCatalog(): Promise<RawAsxGicsRow[]> {
    return MOCK_ASX_GICS_ROWS.map((r) => ({ ...r }));
  }
}
