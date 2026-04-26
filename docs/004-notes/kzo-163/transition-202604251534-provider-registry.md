---
slug: kzo-163
type: transition
created: 2026-04-25T15:34
tickets: [KZO-163]
frozen: true
---

# KZO-163 — Provider Registry + Market Data Abstraction: Transition Note

**Status:** Frozen — do not edit after merge.
**Scope:** Pure refactor. No DB schema changes, no functional change for TW ingestion paths. One explicit behavioral delta (N8).

---

## 1. Two New Interfaces

`apps/api/src/services/market-data/types.ts` now exports two provider interfaces in place of the deleted `FinMindProvider`.

### `MarketDataProvider`

Fetches time-series market data (bars and dividends) for a single market's ticker.

```ts
interface MarketDataProvider {
  fetchBars(
    ticker: string,
    startDate?: string,
    endDate?: string,
  ): Promise<RawDailyBar[]>;

  fetchDividends(
    ticker: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DividendRecord[]>;
}
```

### `InstrumentCatalogProvider`

Fetches instrument reference data (catalog and delisting history) for a single market.

```ts
interface InstrumentCatalogProvider {
  fetchInstrumentCatalog(): Promise<RawInstrumentInfo[]>;
  fetchDelistingHistory(): Promise<RawDelistingRecord[]>;
}
```

`FinMindMarketDataProvider` implements **both** interfaces. Both registries register the same FinMind instance under `'TW'`.

**Deleted:** `FinMindProvider` interface (KZO-126 origin). All callers have been updated; `grep -r "FinMindProvider"` should return zero matches.

---

## 2. Registry Shape and How to Register a New Provider

`buildMarketDataRegistry(env)` in `apps/api/src/services/market-data/registry.ts` returns:

```ts
type MarketDataRegistry = {
  marketData: Map<MarketCode, MarketDataProvider>;
  catalog:    Map<MarketCode, InstrumentCatalogProvider>;
};
```

`MarketCode` is `string` (defined in `libs/domain/src/types.ts`). Phase 1 only uses `'TW'`.

**To register a new provider for KZO-164/KZO-170/KZO-171:**

1. Create a provider class in `apps/api/src/services/market-data/providers/<market>.ts` implementing `MarketDataProvider` and/or `InstrumentCatalogProvider`.
2. In `buildMarketDataRegistry(env)`, construct the provider with its own `RateLimiter` and register it:

```ts
// Example: KZO-170 US market provider
const usLimiter = new RateLimiter(env.POLYGON_RATE_LIMIT_PER_HOUR);
const usProvider = env.POLYGON_API_KEY
  ? new PolygonMarketDataProvider({ apiKey: env.POLYGON_API_KEY, rateLimiter: usLimiter })
  : new MockPolygonMarketDataProvider();

registry.marketData.set('US', usProvider);
registry.catalog.set('US', usProvider);  // if implements InstrumentCatalogProvider
```

3. Add `POLYGON_API_KEY`, `POLYGON_RATE_LIMIT_PER_HOUR` to `libs/config/src/env-schema.ts`.
4. Add the new `MarketCode` constant to `libs/domain/src/types.ts` as needed.

No call-site changes needed — consumers use `marketDataRegistry.get(resolveMarketCode(ticker))`.

---

## 3. Per-Provider Rate Limiter

**Before KZO-163:** A single `RateLimiter` instance was constructed in `pgBoss.ts` and passed as a dependency through worker deps (`BackfillWorkerDeps.rateLimiter`). Workers called `rateLimiter.canConsume()` before every provider call.

**After KZO-163:** Each provider owns its own `RateLimiter`. The limiter is injected at provider construction time in `buildMarketDataRegistry(env)`.

Workers no longer receive or call `rateLimiter` directly. Instead:

```ts
// Worker pattern (backfillWorker.ts, registerCatalogSyncWorker.ts)
try {
  const bars = await provider.fetchBars(ticker, startDate, endDate);
} catch (err) {
  if (err instanceof RateLimitedError) {
    await boss.send(QUEUE, job.data, {
      startAfter: Math.ceil(err.msUntilAvailable / 1000),
      singletonKey: ticker,
    });
    return;  // job completes successfully; re-enqueued
  }
  throw err;
}
```

`RateLimitedError` is exported from `types.ts`:

```ts
class RateLimitedError extends Error {
  readonly msUntilAvailable: number;
  constructor(opts: { msUntilAvailable: number }) { ... }
}
```

**`BackfillWorkerDeps` no longer carries `rateLimiter: RateLimiter`.**
**`CatalogSyncWorkerDeps` no longer carries `rateLimiter: RateLimiter`.**

---

## 4. Optional `sourceId` Field on `RawDailyBar` and `DividendRecord`

```ts
interface RawDailyBar {
  // ...existing fields...
  sourceId?: string;  // KZO-163: 'finmind' for TW; future markets set their own
}

interface DividendRecord {
  // ...existing fields...
  sourceId?: string;
}
```

**What it's for:** Allows multiple providers to coexist in `market_data.daily_bars` and `market_data.dividend_events` without DB key collisions. The `source` column in both tables identifies the data origin.

**What sets it:** `FinMindMarketDataProvider` sets `sourceId: 'finmind'` on every returned `RawDailyBar` and `DividendRecord`.

**The fallback:** `upserts.ts` reads `bar.sourceId ?? 'finmind'` and `ev.sourceId ?? 'finmind'`. This means:
- Test fixtures that don't set `sourceId` continue to produce `'finmind'`-keyed rows (no fixture changes needed).
- The existing `finmind:00878:2025-01-20:CASH` derived dividend key is preserved.

**No DB migration required.** The `source TEXT NOT NULL` column already exists; values remain `'finmind'` for all TW data.

---

## 5. Single Composition Root in `registry.ts`

**Two prior construction sites collapsed:**

| Old location | What it did |
|---|---|
| `apps/api/src/plugins/pgBoss.ts:38–46` | `new RateLimiter()` + `Env.FINMIND_API_TOKEN ? new FinMindClient() : new MockFinMindClient()` |
| `apps/api/src/routes/registerRoutes.ts:2567` | Inline `Env.FINMIND_API_TOKEN ? new FinMindClient() : new MockFinMindClient()` for the price route |

Both sites now call nothing. The FinMind provider is constructed once in `buildMarketDataRegistry(env)` and accessed via `app.marketDataRegistry`.

**Why:** Before KZO-163, the price route bypassed the shared rate limiter entirely because it constructed its own inline FinMind client. The shared hourly budget controlled worker traffic but not the price route. This was the only escape hatch — closing it is the purpose of N8.

---

## 6. `pgBoss.ts` and `registerRoutes.ts` No Longer Construct Providers

**`pgBoss.ts` after KZO-163:**
- Removed imports: `RateLimiter`, `FinMindClient`, `MockFinMindClient`
- Removed: `const rateLimiter = new RateLimiter();` and the ternary FinMind construction block
- Worker deps now include: `marketDataRegistry: app.marketDataRegistry.marketData`, `catalogRegistry: app.marketDataRegistry.catalog`, `resolveMarketCode`

**`registerRoutes.ts` after KZO-163:**
- Removed imports on lines 57–58: `FinMindClient`, `MockFinMindClient`
- Price route (former line ~2567): replaces inline construction with `app.marketDataRegistry.marketData.get(resolveMarketCode(query.ticker))`
- `reply` parameter added to the price route handler signature (required for `Retry-After` header on 503)

---

## 7. `marketResolution.ts` Seam

**New file:** `apps/api/src/services/market-data/marketResolution.ts`

```ts
/**
 * Resolve the market code for a given ticker.
 *
 * KZO-163: Returns 'TW' for all tickers (TWSE-only phase).
 * KZO-170 will replace this with an `instruments.market_code` lookup
 * plus a pattern-based heuristic for unknown tickers.
 */
export function resolveMarketCode(_ticker: string): MarketCode {
  return 'TW';
}
```

**Purpose:** Prevents call sites from hardcoding `'TW'`. When KZO-170 lands, updating this single function upgrades routing for all consumers — workers, the price route, and any future routes — with no call-site changes.

**KZO-170 upgrade path:**
1. Query `market_data.instruments.market_code` for known tickers.
2. Fall back to a pattern-based heuristic (4-digit numeric → `'TW'`, etc.) for unknown tickers.
3. Replace the single-line body of `resolveMarketCode`.

---

## 8. Env Additions

Two new env vars added to `libs/config/src/env-schema.ts`:

| Variable | Type | Default | Purpose |
|---|---|---|---|
| `FINMIND_BASE_URL` | `z.string().url()` | `https://api.finmindtrade.com/api/v4/data` | FinMind API base URL; overridable for testing/staging |
| `FINMIND_RATE_LIMIT_PER_HOUR` | `z.coerce.number().int().positive()` | `600` | FinMind hourly request budget; override to reduce in constrained environments |

Both are added to `.env.example` under the existing `FINMIND_API_TOKEN` block.

No restart or migration required for existing environments — the defaults preserve current behavior.

---

## 9. Behavioral Delta (N8) — `/market-data/price` Now Rate-Limited

**This is intentional, not a regression.**

### Before KZO-163

`/market-data/price` constructed its own FinMind client inline. The shared 600 req/hr budget applied to workers only. The price route was an uncontrolled escape hatch — heavy use could silently deplete the budget for workers.

### After KZO-163

The price route uses `app.marketDataRegistry.marketData.get(resolveMarketCode(query.ticker))` — the same shared `FinMindMarketDataProvider` instance that workers use. If the shared rate limit is exhausted, the route catches `RateLimitedError` and returns:

```
HTTP 503 Service Unavailable
Retry-After: <seconds>
{ "code": "provider_rate_limited", "message": "market data provider rate limit exceeded" }
```

### Two distinct rate-limit responses on this route

| Code | Status | Meaning |
|---|---|---|
| `rate_limit_exceeded` | **429** | Per-IP limit (existing, unchanged) — your IP is hitting the route too frequently |
| `provider_rate_limited` | **503** | Shared FinMind budget exhausted — all callers temporarily blocked; retry after `Retry-After` seconds |

The per-IP guard (`assertMarketDataPriceRateLimit`) runs first. If it passes and the cached bar lookup fails (no stored bar), the provider is called. If the provider's rate limiter denies, the 503 fires.

In production, most traffic hits cached bars (cache hit → 200, no provider call → no 503). The 503 path is narrow but now correctly throttled.

---

## 10. Renamed Classes and Methods

| Old name | New name | New location |
|---|---|---|
| `FinMindProvider` (interface) | `MarketDataProvider` + `InstrumentCatalogProvider` | `types.ts` |
| `FinMindClient` (class) | `FinMindMarketDataProvider` | `providers/finmind.ts` |
| `MockFinMindClient` (class) | `MockFinMindMarketDataProvider` | `providers/mockFinmind.ts` |
| `fetchDailyBars(ticker, startDate?, endDate?)` | `fetchBars(ticker, startDate?, endDate?)` | Both provider classes |
| `fetchDividendEvents(ticker, startDate?, endDate?)` | `fetchDividends(ticker, startDate?, endDate?)` | Both provider classes |
| `finmindClient.ts` (file) | `providers/finmind.ts` | `apps/api/src/services/market-data/` |
| `finmindClient.mock.ts` (file) | `providers/mockFinmind.ts` | `apps/api/src/services/market-data/` |

`MockFinMindMarketDataProvider.calls` field is preserved unchanged for test compatibility.

Catalog methods (`fetchInstrumentCatalog`, `fetchDelistingHistory`) keep their names — no rename needed.

**Verification grep (should return 0 matches in `src/` and `test/`):**
```bash
grep -rn "FinMindProvider\|FinMindClient\|MockFinMindClient\|fetchDailyBars\|fetchDividendEvents" \
  apps/api/src apps/api/test --include="*.ts"
```

---

## 11. Downstream Beneficiaries

| Ticket | Market | What they inherit from KZO-163 |
|---|---|---|
| **KZO-164** | FX rates | Registry slot — add `FxRateProvider` interface + `'FX'` key; no call-site changes |
| **KZO-170** | US (Polygon.io) | Registry slot — add `PolygonMarketDataProvider`; upgrade `resolveMarketCode` for US tickers |
| **KZO-171** | AU (ASX) | Registry slot — add AU provider; `resolveMarketCode` handles AU tickers after KZO-170 seam |

Each downstream ticket follows the same pattern: implement the relevant interface, construct the provider with its own `RateLimiter`, register under the new `MarketCode` in `buildMarketDataRegistry`. No existing call sites need modification.
