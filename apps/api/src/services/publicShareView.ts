import type { QuoteSnapshot } from "@vakwen/domain";
import { marketCodeFor } from "@vakwen/shared-types";
import type { PublicShareViewDto } from "@vakwen/shared-types";
import { quoteSnapshotKey } from "./market-data/quoteSnapshotService.js";
import type { Store } from "../types/store.js";

interface HoldingWithQuote {
  accountId: string;
  ticker: string;
  marketCode: ReturnType<typeof marketCodeFor>;
  quantity: number;
  currency: string;
  costBasisAmount: number;
  marketValueAmount: number;
  asOf: string;
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildPublicShareView(
  store: Store,
  quotes: Record<string, QuoteSnapshot | null>,
  ownerDisplayName: string,
  expiresAt: string,
): PublicShareViewDto {
  const withQuotes: HoldingWithQuote[] = [];
  const accountMarket = new Map(store.accounts.map((account) => [
    account.id,
    marketCodeFor(account.defaultCurrency),
  ]));
  for (const holding of store.accounting.projections.holdings) {
    if (holding.quantity <= 0) continue;
    const market = accountMarket.get(holding.accountId);
    if (!market) continue;
    const quote = quotes[quoteSnapshotKey(holding.ticker, market)] ?? quotes[holding.ticker];
    if (!quote) continue;
    withQuotes.push({
      accountId: holding.accountId,
      ticker: holding.ticker,
      marketCode: market,
      quantity: holding.quantity,
      currency: holding.currency,
      costBasisAmount: holding.costBasisAmount,
      marketValueAmount: roundTo2(holding.quantity * quote.close),
      asOf: quote.asOf,
    });
  }

  // Aggregate per-currency totals (market value + cost basis) across included rows.
  const totalsByCurrency = new Map<string, { marketValue: number; costBasis: number }>();
  for (const row of withQuotes) {
    const agg = totalsByCurrency.get(row.currency) ?? { marketValue: 0, costBasis: 0 };
    agg.marketValue += row.marketValueAmount;
    agg.costBasis += row.costBasisAmount;
    totalsByCurrency.set(row.currency, agg);
  }

  const holdings = withQuotes
    .slice()
    .sort((a, b) => b.marketValueAmount - a.marketValueAmount)
    .map((row) => {
      const total = totalsByCurrency.get(row.currency)?.marketValue ?? 0;
      const allocationPercent = total > 0 ? roundTo2((row.marketValueAmount / total) * 100) : 0;
      return {
        ticker: row.ticker,
        quantity: row.quantity,
        marketValueAmount: row.marketValueAmount,
        marketValueCurrency: row.currency,
        allocationPercent,
      };
    });

  const holdingGroups = [...groupPublicShareHoldings(withQuotes).values()]
    .sort((a, b) => b.marketValueAmount - a.marketValueAmount)
    .map((row) => {
      const total = totalsByCurrency.get(row.marketValueCurrency)?.marketValue ?? 0;
      return {
        ...row,
        allocationPercent: total > 0 ? roundTo2((row.marketValueAmount / total) * 100) : 0,
      };
    });

  const totalValueByCurrency = [...totalsByCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, agg]) => ({ currency, amount: roundTo2(agg.marketValue) }));

  const returnByCurrency = [...totalsByCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, agg]) => agg.costBasis > 0)
    .map(([currency, agg]) => ({
      currency,
      returnPercent: roundTo2(((agg.marketValue - agg.costBasis) / agg.costBasis) * 100),
    }));

  let quoteAsOf: string | null = null;
  for (const row of withQuotes) {
    if (quoteAsOf === null || row.asOf > quoteAsOf) {
      quoteAsOf = row.asOf;
    }
  }

  return {
    ownerDisplayName,
    expiresAt,
    holdings,
    holdingGroups,
    summary: {
      totalValueByCurrency,
      returnByCurrency,
    },
    quoteAsOf,
  };
}

function groupPublicShareHoldings(rows: HoldingWithQuote[]): Map<string, PublicShareViewDto["holdingGroups"][number]> {
  const groups = new Map<string, PublicShareViewDto["holdingGroups"][number]>();
  for (const row of rows) {
    const key = `${row.ticker}:${row.marketCode}`;
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += row.quantity;
      existing.accountCount += 1;
      existing.marketValueAmount = roundTo2(existing.marketValueAmount + row.marketValueAmount);
      continue;
    }

    groups.set(key, {
      ticker: row.ticker,
      marketCode: row.marketCode,
      quantity: row.quantity,
      accountCount: 1,
      marketValueAmount: row.marketValueAmount,
      marketValueCurrency: row.currency,
      allocationPercent: 0,
    });
  }
  return groups;
}
