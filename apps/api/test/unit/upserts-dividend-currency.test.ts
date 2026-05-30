/**
 * KZO-170 (D1) — `upsertDividendEvents` derives `cash_dividend_currency` per-row
 * from the event's `marketCode`, replacing the hardcoded
 * `array_fill('TWD'::text, ARRAY[$9::int])` that silently stamped TWD on every
 * row regardless of market.
 *
 * **Critical regression net for D1**: a US dividend ingested under the legacy
 * code stamped `cash_dividend_currency='TWD'`, which then failed the dividend
 * market-guard at `apps/api/src/services/dividends.ts:184` (`event.cashDividendCurrency
 * !== account.defaultCurrency`). KZO-170's contract is per-row currency derived
 * via `currencyFor(marketCode)` from `@vakwen/shared-types`.
 *
 * Pure unit test pattern (mock the `pg.Pool`) — no Postgres dependency, so this
 * lives under `apps/api/test/unit/`. The SQL itself is exercised end-to-end in
 * `apps/api/test/integration/usStockBackfill.integration.test.ts`.
 */

import { describe, it, expect, vi } from "vitest";
import { upsertDividendEvents } from "../../src/services/market-data/upserts.js";

const SUPPORTED_DIVIDEND_CURRENCIES = new Set(["TWD", "USD", "AUD", "KRW"]);

function createPoolMock() {
  return {
    query: vi.fn().mockResolvedValue({ rowCount: 0 }),
  };
}

function pickQueryParams(pool: ReturnType<typeof createPoolMock>): unknown[] {
  expect(pool.query).toHaveBeenCalledTimes(1);
  const call = pool.query.mock.calls[0]!;
  return call[1] as unknown[];
}

describe("upsertDividendEvents — per-row cash_dividend_currency derivation (KZO-170 D1)", () => {
  it("stamps TWD on TW dividend events (preserves D1 baseline behavior)", async () => {
    const pool = createPoolMock();
    await upsertDividendEvents(pool as never, [
      {
        ticker: "2330",
        marketCode: "TW",
        exDividendDate: "2026-06-15",
        paymentDate: "2026-07-15",
        cashDividendPerShare: 4,
        stockDividendPerShare: 0,
        sourceId: "finmind",
      },
    ]);

    const params = pickQueryParams(pool);
    // Per upserts.ts shape — currencies live in a `$N::text[]` parameter, mirroring
    // the per-row sources array. Find the array containing the currency code.
    const currencyArrayIndex = params.findIndex(
      (p) => Array.isArray(p) && p.length === 1 && SUPPORTED_DIVIDEND_CURRENCIES.has(String(p[0])),
    );
    expect(currencyArrayIndex).toBeGreaterThanOrEqual(0);
    expect(params[currencyArrayIndex]).toEqual(["TWD"]);
  });

  it("stamps USD on US dividend events (regression net for the cashDividendCurrency hardcode)", async () => {
    const pool = createPoolMock();
    await upsertDividendEvents(pool as never, [
      {
        ticker: "AAPL",
        marketCode: "US",
        exDividendDate: "2024-08-12",
        paymentDate: "2024-08-15",
        cashDividendPerShare: 0.25,
        stockDividendPerShare: 0,
        sourceId: "finmind-us",
      },
    ]);

    const params = pickQueryParams(pool);
    const currencyArrayIndex = params.findIndex(
      (p) => Array.isArray(p) && p.length === 1 && SUPPORTED_DIVIDEND_CURRENCIES.has(String(p[0])),
    );
    expect(currencyArrayIndex).toBeGreaterThanOrEqual(0);
    expect(params[currencyArrayIndex]).toEqual(["USD"]);
  });

  it("stamps KRW on KR dividend events", async () => {
    const pool = createPoolMock();
    await upsertDividendEvents(pool as never, [
      {
        ticker: "005930",
        marketCode: "KR",
        exDividendDate: "2025-12-27",
        paymentDate: "2025-12-27",
        cashDividendPerShare: 361,
        stockDividendPerShare: 0,
        sourceId: "yahoo-finance-kr",
      },
    ]);

    const params = pickQueryParams(pool);
    const currencyArrayIndex = params.findIndex(
      (p) => Array.isArray(p) && p.length === 1 && SUPPORTED_DIVIDEND_CURRENCIES.has(String(p[0])),
    );
    expect(currencyArrayIndex).toBeGreaterThanOrEqual(0);
    expect(params[currencyArrayIndex]).toEqual(["KRW"]);
  });

  it("derives currency per-row when the batch mixes TW + US events", async () => {
    const pool = createPoolMock();
    await upsertDividendEvents(pool as never, [
      {
        ticker: "2330",
        marketCode: "TW",
        exDividendDate: "2026-06-15",
        paymentDate: "2026-07-15",
        cashDividendPerShare: 4,
        stockDividendPerShare: 0,
        sourceId: "finmind",
      },
      {
        ticker: "AAPL",
        marketCode: "US",
        exDividendDate: "2024-08-12",
        paymentDate: "2024-08-15",
        cashDividendPerShare: 0.25,
        stockDividendPerShare: 0,
        sourceId: "finmind-us",
      },
    ]);

    const params = pickQueryParams(pool);
    // The currencies array must align positionally with tickers — TW row's
    // currency is TWD, US row's currency is USD. Find the array that has both
    // values; assert it contains exactly { TWD, USD } (set-equality, since
    // the dedupe step may reorder rows).
    const currencyArrayIndex = params.findIndex(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((v) => SUPPORTED_DIVIDEND_CURRENCIES.has(String(v))),
    );
    expect(currencyArrayIndex).toBeGreaterThanOrEqual(0);
    const currencies = (params[currencyArrayIndex] as string[]).slice().sort();
    expect(currencies).toEqual(["TWD", "USD"]);
  });

  it("ALWAYS derives from marketCode — does NOT honor any legacy cashDividendCurrency override", async () => {
    // Regression net: KZO-170's contract is "marketCode is the source of truth
    // for currency." If a future producer accidentally adds a cashDividendCurrency
    // field on the event input, the upsert MUST still derive from marketCode
    // (otherwise we re-introduce the D1 inconsistency where two parts of the
    // codebase disagree on the currency).
    const pool = createPoolMock();
    await upsertDividendEvents(pool as never, [
      {
        ticker: "AAPL",
        marketCode: "US",
        exDividendDate: "2024-11-08",
        paymentDate: "2024-11-15",
        cashDividendPerShare: 0.25,
        stockDividendPerShare: 0,
        sourceId: "finmind-us",
        // Hypothetical stray field — present in some intermediate provider shapes.
        // The upsert must not honor this; currency comes from marketCode.
        cashDividendCurrency: "TWD",
      } as never,
    ]);

    const params = pickQueryParams(pool);
    const currencyArrayIndex = params.findIndex(
      (p) => Array.isArray(p) && p.length === 1 && SUPPORTED_DIVIDEND_CURRENCIES.has(String(p[0])),
    );
    expect(currencyArrayIndex).toBeGreaterThanOrEqual(0);
    expect(params[currencyArrayIndex]).toEqual(["USD"]);
  });
});
