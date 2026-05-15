import type { QuoteSnapshot } from "@vakwen/domain";
import type { PublicShareViewDto } from "@vakwen/shared-types";
import type { Store } from "../types/store.js";

interface HoldingWithQuote {
  ticker: string;
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
  for (const holding of store.accounting.projections.holdings) {
    if (holding.quantity <= 0) continue;
    const quote = quotes[holding.ticker];
    if (!quote) continue;
    withQuotes.push({
      ticker: holding.ticker,
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
    summary: {
      totalValueByCurrency,
      returnByCurrency,
    },
    quoteAsOf,
  };
}
