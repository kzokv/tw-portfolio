import type { QuoteSnapshot } from "@vakwen/domain";
import { marketCodeFor } from "@vakwen/shared-types";
import type { PublicShareViewDto } from "@vakwen/shared-types";
import { quoteSnapshotKey } from "./market-data/quoteSnapshotService.js";
import type { Store } from "../types/store.js";

interface HoldingWithQuote {
  accountId: string;
  ticker: string;
  instrumentName: string | null;
  marketCode: ReturnType<typeof marketCodeFor>;
  quantity: number;
  currency: string;
  costBasisAmount: number;
  marketValueAmount: number | null;
  quoteStatus: "current" | "provisional" | "missing";
  asOf: string | null;
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
  const shareRows: HoldingWithQuote[] = [];
  const instrumentNames = buildInstrumentNameLookup(store);
  const accountMarket = new Map(store.accounts.map((account) => [
    account.id,
    marketCodeFor(account.defaultCurrency),
  ]));
  for (const holding of store.accounting.projections.holdings) {
    if (holding.quantity <= 0) continue;
    const market = accountMarket.get(holding.accountId);
    if (!market) continue;
    const quote = quotes[quoteSnapshotKey(holding.ticker, market)] ?? quotes[holding.ticker];
    shareRows.push({
      accountId: holding.accountId,
      ticker: holding.ticker,
      instrumentName: instrumentNames.get(`${market}:${holding.ticker}`) ?? instrumentNames.get(holding.ticker) ?? null,
      marketCode: market,
      quantity: holding.quantity,
      currency: holding.currency,
      costBasisAmount: holding.costBasisAmount,
      marketValueAmount: quote ? roundTo2(holding.quantity * quote.close) : null,
      quoteStatus: quote ? (quote.isProvisional ? "provisional" : "current") : "missing",
      asOf: quote?.asOf ?? null,
    });
  }

  // Aggregate per-currency totals (market value + cost basis) across included rows.
  const totalsByCurrency = new Map<string, { hasMissingQuote: boolean; marketValue: number; costBasis: number }>();
  for (const row of shareRows) {
    const agg = totalsByCurrency.get(row.currency) ?? { hasMissingQuote: false, marketValue: 0, costBasis: 0 };
    if (row.marketValueAmount === null) {
      agg.hasMissingQuote = true;
      totalsByCurrency.set(row.currency, agg);
      continue;
    }
    agg.marketValue += row.marketValueAmount;
    agg.costBasis += row.costBasisAmount;
    totalsByCurrency.set(row.currency, agg);
  }

  const holdings = shareRows
    .slice()
    .sort(comparePublicShareRows)
    .map((row) => {
      const total = totalsByCurrency.get(row.currency)?.marketValue ?? 0;
      const hasIncompleteDenominator = totalsByCurrency.get(row.currency)?.hasMissingQuote ?? false;
      const allocationPercent = !hasIncompleteDenominator && row.marketValueAmount !== null && total > 0
        ? roundTo2((row.marketValueAmount / total) * 100)
        : null;
      return {
        ticker: row.ticker,
        instrumentName: row.instrumentName,
        quantity: row.quantity,
        marketValueAmount: row.marketValueAmount,
        marketValueCurrency: row.currency,
        allocationPercent,
        quoteStatus: row.quoteStatus,
      };
    });

  const holdingGroups = [...groupPublicShareHoldings(shareRows).values()]
    .sort(comparePublicShareGroups)
    .map((row) => {
      const currencyTotal = totalsByCurrency.get(row.marketValueCurrency);
      const total = currencyTotal?.marketValue ?? 0;
      const hasIncompleteDenominator = currencyTotal?.hasMissingQuote ?? false;
      return {
        ...row,
        allocationPercent: !hasIncompleteDenominator && row.marketValueAmount !== null && total > 0
          ? roundTo2((row.marketValueAmount / total) * 100)
          : null,
      };
    });

  const totalValueByCurrency = [...totalsByCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, agg]) => agg.marketValue > 0)
    .map(([currency, agg]) => ({ currency, amount: roundTo2(agg.marketValue) }));

  const returnByCurrency = [...totalsByCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, agg]) => !agg.hasMissingQuote && agg.costBasis > 0)
    .map(([currency, agg]) => ({
      currency,
      returnPercent: roundTo2(((agg.marketValue - agg.costBasis) / agg.costBasis) * 100),
    }));

  let quoteAsOf: string | null = null;
  for (const row of shareRows) {
    if (row.asOf !== null && (quoteAsOf === null || row.asOf > quoteAsOf)) {
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
    dataHealth: {
      holdingCount: shareRows.length,
      missingQuoteCount: shareRows.filter((row) => row.quoteStatus === "missing").length,
      provisionalQuoteCount: shareRows.filter((row) => row.quoteStatus === "provisional").length,
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
      existing.marketValueAmount = existing.marketValueAmount === null || row.marketValueAmount === null
        ? null
        : roundTo2(existing.marketValueAmount + row.marketValueAmount);
      if (row.quoteStatus === "missing") existing.quoteStatus = "missing";
      else if (row.quoteStatus === "provisional" && existing.quoteStatus === "current") existing.quoteStatus = "provisional";
      continue;
    }

    const group = {
      ticker: row.ticker,
      instrumentName: row.instrumentName,
      marketCode: row.marketCode,
      quantity: row.quantity,
      accountCount: 1,
      marketValueAmount: row.marketValueAmount,
      marketValueCurrency: row.currency,
      allocationPercent: 0,
      quoteStatus: row.quoteStatus,
    } as PublicShareViewDto["holdingGroups"][number];

    groups.set(key, group);
  }
  return groups;
}

function buildInstrumentNameLookup(
  store: Pick<Store, "marketData">,
): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  for (const instrument of store.marketData.instruments) {
    const name = instrument.name?.trim();
    if (!name) continue;
    lookup.set(`${instrument.marketCode}:${instrument.ticker}`, name);
    if (!lookup.has(instrument.ticker)) {
      lookup.set(instrument.ticker, name);
    }
  }
  return lookup;
}

function comparePublicShareRows(a: HoldingWithQuote, b: HoldingWithQuote): number {
  return compareMarketValueDescending(a.marketValueAmount, b.marketValueAmount)
    || a.ticker.localeCompare(b.ticker)
    || a.marketCode.localeCompare(b.marketCode);
}

function comparePublicShareGroups(
  a: PublicShareViewDto["holdingGroups"][number],
  b: PublicShareViewDto["holdingGroups"][number],
): number {
  return compareMarketValueDescending(a.marketValueAmount, b.marketValueAmount)
    || a.ticker.localeCompare(b.ticker)
    || a.marketCode.localeCompare(b.marketCode);
}

function compareMarketValueDescending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}
