/**
 * KZO-170 (D7) — Per-market backfill history start lookup.
 *
 * `HISTORY_START` (a single TW-only constant) is replaced by a per-market map
 * `HISTORY_START_BY_MARKET: Record<MarketCode, string>` plus a `historyStartFor`
 * helper. The helper is the load-bearing input to `effectiveStartDate` selection
 * in `backfillWorker.ts` and must return the canonical date for every supported
 * market code.
 *
 * Per scope-todo D7:
 *   - TW: "1994-10-01" (FinMind TaiwanStockPrice earliest)
 *   - US: "2019-06-01" (FinMind USStockPrice earliest)
 *   - AU: "1994-10-01" (placeholder, KZO-171 will pin)
 *
 * Mirror precedent: `apps/api/test/unit/finmind-provider-reserveCapacity.test.ts`
 * (pure unit test against a helper, no infra deps).
 */

import { describe, it, expect } from "vitest";
import { historyStartFor, HISTORY_START_BY_MARKET } from "../../src/services/market-data/types.js";

describe("historyStartFor", () => {
  it("returns 1994-10-01 for TW (FinMind TaiwanStockPrice earliest)", () => {
    expect(historyStartFor("TW")).toBe("1994-10-01");
  });

  it("returns 2019-06-01 for US (FinMind USStockPrice earliest)", () => {
    expect(historyStartFor("US")).toBe("2019-06-01");
  });

  it("returns 1994-10-01 for AU (placeholder until KZO-171 pins the AU history start)", () => {
    expect(historyStartFor("AU")).toBe("1994-10-01");
  });
});

describe("HISTORY_START_BY_MARKET", () => {
  it("exposes a per-market map keyed by MarketCode", () => {
    expect(HISTORY_START_BY_MARKET.TW).toBe("1994-10-01");
    expect(HISTORY_START_BY_MARKET.US).toBe("2019-06-01");
    expect(HISTORY_START_BY_MARKET.AU).toBe("1994-10-01");
  });

  it("covers exactly the three supported MarketCode values (no extras)", () => {
    expect(Object.keys(HISTORY_START_BY_MARKET).sort()).toEqual(["AU", "TW", "US"]);
  });
});
