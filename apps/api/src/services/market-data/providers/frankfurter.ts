import type { FxRate, FxRateProvider } from "../types.js";
import { RateLimitedError } from "../types.js";
import type { RateLimiter } from "../rateLimiter.js";

/**
 * KZO-164 contract for Frankfurter v2's `/v2/rates` endpoint: a flat array of per-day
 * per-pair rate rows. Frankfurter forward-fills weekends and publication-missing days,
 * so the returned date set may include dates outside the requested range when the
 * default-blend resolver picks a forward-filled value. The provider passes those dates
 * through unchanged (Phase 1.5 invariant #6).
 */
interface FrankfurterRateRow {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

export interface FrankfurterFxRateProviderConfig {
  baseUrl: string;
  rateLimiter?: RateLimiter;
}

/**
 * Frankfurter v2 FX-rate provider. Frankfurter's default-blend route is the sole FX
 * provider for KZO-164 (covers TWD via CBC, AUD via RBA, USD via ECB+others; no quotas).
 *
 * Stamps every returned `FxRate` with `source: 'frankfurter'`. Frankfurter has no
 * published quota, but the app applies an admin-configurable defensive operation
 * budget so manual refreshes and cron backfills share the same pacing contract.
 */
export class FrankfurterFxRateProvider implements FxRateProvider {
  /** KZO-170 D14: stable provider identity for log enrichment. */
  readonly providerId = "frankfurter";
  private readonly baseUrl: string;
  private readonly rateLimiter: RateLimiter | null;

  constructor(config: FrankfurterFxRateProviderConfig) {
    this.baseUrl = config.baseUrl;
    this.rateLimiter = config.rateLimiter ?? null;
  }

  reserveCapacity(n: number): void {
    if (!this.rateLimiter) return;
    if (!this.rateLimiter.canConsume(n)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(n) });
    }
  }

  private consumeOne(): void {
    if (!this.rateLimiter) return;
    if (!this.rateLimiter.canConsume(1)) {
      throw new RateLimitedError({ msUntilAvailable: this.rateLimiter.msUntilAvailable(1) });
    }
    this.rateLimiter.consume(1);
  }

  async fetchRatesForBase(
    base: string,
    fromDate: string,
    toDate: string,
    quotes?: readonly string[],
  ): Promise<FxRate[]> {
    this.consumeOne();
    const params = new URLSearchParams({
      base,
      from: fromDate,
      to: toDate,
    });
    const url = `${this.baseUrl}/rates?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Frankfurter API error: ${res.status} ${res.statusText ?? ""}`.trim());
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(`Frankfurter API returned non-JSON response: ${cause}`);
    }

    if (!Array.isArray(body)) {
      throw new Error(
        `Frankfurter API returned unexpected payload (expected array, got ${typeof body})`,
      );
    }

    const quoteFilter = quotes && quotes.length > 0 ? new Set(quotes) : null;
    const out: FxRate[] = [];
    for (const row of body as Array<Partial<FrankfurterRateRow>>) {
      if (
        !row
        || typeof row.date !== "string"
        || typeof row.base !== "string"
        || typeof row.quote !== "string"
        || typeof row.rate !== "number"
        || !Number.isFinite(row.rate)
      ) {
        continue;
      }
      if (quoteFilter && !quoteFilter.has(row.quote)) continue;
      out.push({
        date: row.date,
        baseCurrency: row.base,
        quoteCurrency: row.quote,
        rate: row.rate,
        source: "frankfurter",
      });
    }
    return out;
  }
}
