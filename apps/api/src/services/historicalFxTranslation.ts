import { roundToDecimal } from "@vakwen/domain";
import type { AccountDefaultCurrency } from "@vakwen/shared-types";

export interface HistoricalFxAmountEntry {
  amount: number;
  currency: AccountDefaultCurrency;
  date: string;
}

export interface HistoricalFxMissingRatePair {
  from: AccountDefaultCurrency;
  to: AccountDefaultCurrency;
}

export interface HistoricalFxAmountResult {
  amount: number;
  missingRatePairs: HistoricalFxMissingRatePair[];
}

export interface HistoricalFxRateLookup {
  getFxRate(
    base: AccountDefaultCurrency,
    quote: AccountDefaultCurrency,
    asOfDate: string,
  ): Promise<number | null>;
}

export async function translateHistoricalFxAmounts(
  entries: ReadonlyArray<HistoricalFxAmountEntry>,
  reportingCurrency: AccountDefaultCurrency,
  rates: HistoricalFxRateLookup,
): Promise<HistoricalFxAmountResult> {
  let total = 0;
  const missingRatePairs = new Map<string, HistoricalFxMissingRatePair>();
  const fxCache = new Map<string, Promise<number | null>>();

  const lookupFx = async (currency: AccountDefaultCurrency, date: string): Promise<number | null> => {
    if (currency === reportingCurrency) return 1;
    const key = `${currency}\0${reportingCurrency}\0${date}`;
    const existing = fxCache.get(key);
    if (existing) return existing;
    const pending = rates.getFxRate(currency, reportingCurrency, date);
    fxCache.set(key, pending);
    return pending;
  };

  for (const entry of entries) {
    const fx = await lookupFx(entry.currency, entry.date);
    if (fx === null) {
      missingRatePairs.set(
        `${entry.currency}\0${reportingCurrency}`,
        { from: entry.currency, to: reportingCurrency },
      );
      continue;
    }
    total += entry.amount * fx;
  }

  return {
    amount: roundToDecimal(total, 2),
    missingRatePairs: [...missingRatePairs.values()],
  };
}
