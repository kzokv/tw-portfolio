import type { FxRate, FxRateProvider } from "../types.js";

/**
 * Deterministic fixture rates per (base, quote). Derived inverses keep the test fixtures
 * internally consistent (e.g. USD→TWD = 31.5 ⇒ TWD→USD = 1/31.5). Self-pairs are
 * intentionally excluded — schema CHECK rejects them and the worker filters them anyway.
 * (`mock returns includeSelfPair` is exercised in worker tests via a `vi.fn().mockImplementation`,
 * not by this mock provider.)
 */
const BASE_RATES: Record<string, Record<string, number>> = {
  USD: { TWD: 31.5, AUD: 1.4 },
  TWD: { USD: 1 / 31.5, AUD: 1.4 / 31.5 },
  AUD: { USD: 1 / 1.4, TWD: 31.5 / 1.4 },
};

function enumerateDates(fromDate: string, toDate: string): string[] {
  const start = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }
  const dates: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Mock implementation of `FxRateProvider` used when `FX_PROVIDER_MOCK=true` (dev/test).
 * Mirrors `MockFinMindMarketDataProvider`'s `calls` field convention so worker tests can
 * assert the call shape (per-method args at the entry's top level).
 */
export class MockFrankfurterFxRateProvider implements FxRateProvider {
  readonly calls: Array<{
    method: string;
    base?: string;
    fromDate?: string;
    toDate?: string;
    quotes?: readonly string[] | null;
    n?: number;
  }> = [];

  /** No-op (matches the real `FrankfurterFxRateProvider` — Frankfurter has no quota). */
  reserveCapacity(n: number): void {
    this.calls.push({ method: "reserveCapacity", n });
  }

  async fetchRatesForBase(
    base: string,
    fromDate: string,
    toDate: string,
    quotes?: readonly string[],
  ): Promise<FxRate[]> {
    this.calls.push({
      method: "fetchRatesForBase",
      base,
      fromDate,
      toDate,
      ...(quotes ? { quotes } : {}),
    });

    const baseTable = BASE_RATES[base];
    if (!baseTable) return [];

    const filterSet = quotes && quotes.length > 0 ? new Set(quotes) : null;
    const out: FxRate[] = [];
    for (const date of enumerateDates(fromDate, toDate)) {
      for (const [quote, rate] of Object.entries(baseTable)) {
        if (filterSet && !filterSet.has(quote)) continue;
        out.push({
          date,
          baseCurrency: base,
          quoteCurrency: quote,
          rate,
          source: "frankfurter",
        });
      }
    }
    return out;
  }
}
