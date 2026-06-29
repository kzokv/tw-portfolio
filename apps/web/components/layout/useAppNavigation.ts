"use client";

import { useMemo } from "react";
import type { InstrumentOptionDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import type { QuickSearchItem } from "./QuickSearchPanel";

/**
 * Returns the primary nav entries + the quick-search items projection
 * derived from `dict` + `instruments`. Extracted from `AppShell.tsx` per
 * Phase 3c spec target (AppShell ≤300 LOC).
 */
export function useAppNavigation(dict: AppDictionary, instruments: InstrumentOptionDto[]) {
  const navigationItems = useMemo(
    () => [
      { id: "dashboard", href: "/dashboard", label: dict.navigation.dashboardLabel, description: dict.navigation.dashboardDescription },
      { id: "analysis", href: "/analysis", label: dict.navigation.analysisLabel, description: dict.navigation.analysisDescription },
      { id: "reports", href: "/reports", label: dict.navigation.reportsLabel, description: dict.navigation.reportsDescription },
      { id: "portfolio", href: "/portfolio", label: dict.navigation.portfolioLabel, description: dict.navigation.portfolioDescription },
      { id: "transactions", href: "/transactions", label: dict.navigation.transactionsLabel, description: dict.navigation.transactionsDescription },
      { id: "dividends", href: "/dividends", label: dict.navigation.dividendsLabel, description: dict.navigation.dividendsDescription },
      { id: "cash-ledger", href: "/cash-ledger", label: dict.navigation.cashLedgerLabel, description: dict.navigation.cashLedgerDescription },
    ],
    [dict],
  );

  const quickSearchItems = useMemo<QuickSearchItem[]>(
    () => [
      ...navigationItems.map((item) => ({
        id: item.id,
        kind: "route" as const,
        label: item.label,
        description: item.description,
        href: item.href,
        keywords: [item.id, item.label, item.description],
      })),
      ...instruments.map((symbol) => ({
        id: `${symbol.marketCode ?? "na"}-${symbol.ticker.toLowerCase()}`,
        kind: "symbol" as const,
        label: symbol.ticker,
        description: buildInstrumentSearchDescription(symbol),
        href: `/tickers/${encodeURIComponent(symbol.ticker)}`,
        keywords: [symbol.instrumentType, symbol.marketCode ?? "", symbol.ticker],
      })),
    ],
    [instruments, navigationItems],
  );

  return { navigationItems, quickSearchItems };
}

function buildInstrumentSearchDescription(symbol: InstrumentOptionDto): string {
  const instrument = symbol.instrumentType === "BOND_ETF"
    ? "Bond ETF"
    : symbol.instrumentType === "ETF"
      ? "ETF"
      : "Stock";
  return symbol.marketCode ? `${instrument} / ${symbol.marketCode}` : instrument;
}
