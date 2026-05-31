/**
 * KZO-190 — `supportsMetadataEnrichment` smoke tests: one assertion per implementation.
 *
 * Cheap insurance against silent boolean drift. The flag tells `backfillWorker.ts` whether
 * to count a slot for `fetchInstrumentMetadata` in the `reserveCapacity(N)` pre-flight call:
 *   - `true`  → AU's Yahoo `quote()` consumes a real rate-limit slot — reserve it.
 *   - `false` → FinMind TW/US `fetchInstrumentMetadata` is a no-op (`return null`) — skip it.
 *
 * Six assertions: 3 real providers + 3 mock counterparts. Mocks must mirror real providers
 * (D4 from scope-todo), so if a real provider changes to `true`, its mock must too.
 *
 * yahoo-finance2 is stubbed minimally — the constructor just accepts opts; no network calls.
 */

import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../../src/services/market-data/rateLimiter.js";
import { FinMindMarketDataProvider } from "../../src/services/market-data/providers/finmind.js";
import { FinMindUsStockMarketDataProvider } from "../../src/services/market-data/providers/finmindUsStock.js";
import { YahooFinanceAuMarketDataProvider } from "../../src/services/market-data/providers/yahooFinanceAu.js";
import { MockFinMindMarketDataProvider } from "../../src/services/market-data/providers/mockFinmind.js";
import { MockFinMindUsStockMarketDataProvider } from "../../src/services/market-data/providers/mockFinmindUsStock.js";
import { MockYahooFinanceAuMarketDataProvider } from "../../src/services/market-data/providers/mockYahooFinanceAu.js";

// Minimal yahoo-finance2 stub — `YahooFinanceAuMarketDataProvider`'s constructor calls
// `new YahooFinance({ suppressNotices: [...] })`. We only need the constructor to not
// throw; no SDK methods are exercised in these smoke tests.
vi.mock("yahoo-finance2", () => ({
  default: class MockYahooFinance {
    constructor(_opts?: unknown) {}
  },
}));

describe("supportsMetadataEnrichment flag per provider (KZO-190 smoke)", () => {
  // ── Real providers ────────────────────────────────────────────────────────

  it("FinMindMarketDataProvider: supportsMetadataEnrichment=false (TW, no-op fetchInstrumentMetadata)", () => {
    const provider = new FinMindMarketDataProvider({
      token: "test-token",
      baseUrl: "http://example.invalid",
      rateLimiter: new RateLimiter(),
    });
    expect(provider.supportsMetadataEnrichment).toBe(false);
  });

  it("FinMindUsStockMarketDataProvider: supportsMetadataEnrichment=false (US, no-op fetchInstrumentMetadata)", () => {
    const provider = new FinMindUsStockMarketDataProvider({
      token: "test-token",
      baseUrl: "http://example.invalid",
      rateLimiter: new RateLimiter(),
    });
    expect(provider.supportsMetadataEnrichment).toBe(false);
  });

  it("YahooFinanceAuMarketDataProvider: supportsMetadataEnrichment=true (AU, real Yahoo quote() call)", () => {
    const provider = new YahooFinanceAuMarketDataProvider({
      rateLimiter: new RateLimiter(),
    });
    expect(provider.supportsMetadataEnrichment).toBe(true);
  });

  // ── Mock providers (must mirror real counterparts per D4) ─────────────────

  it("MockFinMindMarketDataProvider: supportsMetadataEnrichment=false (mirrors FinMindMarketDataProvider)", () => {
    const provider = new MockFinMindMarketDataProvider();
    expect(provider.supportsMetadataEnrichment).toBe(false);
  });

  it("MockFinMindUsStockMarketDataProvider: supportsMetadataEnrichment=false (mirrors FinMindUsStockMarketDataProvider)", () => {
    const provider = new MockFinMindUsStockMarketDataProvider();
    expect(provider.supportsMetadataEnrichment).toBe(false);
  });

  it("MockYahooFinanceAuMarketDataProvider: supportsMetadataEnrichment=true (mirrors YahooFinanceAuMarketDataProvider)", () => {
    const provider = new MockYahooFinanceAuMarketDataProvider();
    expect(provider.supportsMetadataEnrichment).toBe(true);
  });
});
