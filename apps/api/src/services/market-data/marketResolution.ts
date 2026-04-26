import type { MarketCode } from "@tw-portfolio/domain";

/**
 * Resolve a ticker symbol to its market code.
 *
 * KZO-163: returns `'TW'` for every ticker. Single seam for the per-market provider registry —
 * call sites use `resolveMarketCode(ticker)` instead of hardcoding `'TW'`, so future expansion
 * (US, AU, HK) can plug in without grepping.
 *
 * KZO-170 (US expansion) will replace this stub with: lookup `instruments.market_code` for known
 * tickers; fall back to a heuristic based on ticker shape (digits-only → TW, alphabetic → US,
 * etc.) for unknown tickers. Until then, all tickers are TW.
 */
export function resolveMarketCode(_ticker: string): MarketCode {
  return "TW";
}
