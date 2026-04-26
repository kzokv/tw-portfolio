---
slug: kzo-164
type: transition
created: 2026-04-26T18:30
tickets: [KZO-164]
frozen: true
---

# KZO-164 - Frankfurter FX Rate Ingestion: Transition Note

**Status:** Frozen - do not edit after merge.
**Scope:** Adds Frankfurter-backed FX rate ingestion for TWD, USD, and AUD. No UI and no historical trade-event walk in this ticket.

---

## 1. Major Scope Deltas From The Original Ticket

The original ticket described FinMind as the primary FX provider with Frankfurter as fallback. That is superseded.

- Frankfurter v2 default blend is the only FX provider for this ticket.
- FinMind FX is not implemented and does not consume the shared FinMind hourly budget.
- There is no FX `RateLimiter`. `reserveCapacity(n)` is a no-op.
- KZO-164 seeds only the latest 30 days on the first cron run. KZO-174 owns trade-event historical backfill, recompute, and UI disclaimer work.

Frankfurter v2 supports `base=TWD`, time-series rates, and the three stored currencies needed for this phase.

---

## 2. `FxRateProvider` Interface

`apps/api/src/services/market-data/types.ts` exports the FX contracts next to the existing market-data provider interfaces:

```ts
interface FxRate {
  date: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  source: string;
}

interface FxRateProvider {
  fetchRatesForBase(
    base: string,
    fromDate: string,
    toDate: string,
    quotes?: readonly string[],
  ): Promise<FxRate[]>;
  reserveCapacity(n: number): void;
}
```

The provider contract is per-base, not per-pair. Callers request one base currency and optionally filter returned quote currencies client-side.

---

## 3. Registry Shape

`MarketDataRegistry` now has a singleton `fxRate` field:

```ts
interface MarketDataRegistry {
  marketData: Map<MarketCode, MarketDataProvider>;
  catalog: Map<MarketCode, InstrumentCatalogProvider>;
  fxRate: FxRateProvider;
}
```

This is intentionally not `Map<MarketCode, FxRateProvider>` or a per-pair map. There is one FX provider for the whole app in KZO-164.

`FX_PROVIDER_MOCK=true` selects `MockFrankfurterFxRateProvider`; otherwise `FrankfurterFxRateProvider` is constructed with `FRANKFURTER_BASE_URL`.

---

## 4. Schema And Indexes

Migration `db/migrations/037_kzo164_fx_rates.sql` creates `market_data.fx_rates`:

- `date DATE NOT NULL`
- `base_currency CHAR(3) NOT NULL`
- `quote_currency CHAR(3) NOT NULL`
- `rate NUMERIC(20, 8) NOT NULL`
- `source TEXT NOT NULL`
- `ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
- Primary key: `(date, base_currency, quote_currency)`

Integrity checks:

- `rate > 0`
- `base_currency ~ '^[A-Z]{3}$'`
- `quote_currency ~ '^[A-Z]{3}$'`
- `base_currency <> quote_currency`

Lookup index:

```sql
CREATE INDEX IF NOT EXISTS idx_fx_rates_pair_date_desc
  ON market_data.fx_rates (base_currency, quote_currency, date DESC);
```

The index supports KZO-165 snapshot generation, where each pair needs the latest known rate by date.

---

## 5. Worker Design

Queue: `fx-refresh`
Cron: `0 22 * * *` (22:00 UTC daily)
Queue policy: singleton

`deriveFetchWindow` handles trigger-specific date logic:

- Manual trigger: use the request `startDate` and `endDate` exactly.
- Cron with empty table: fetch the most recent 30-day window.
- Cron with existing data: fetch from `MAX(date)+1` through today.
- Cron after a long gap: cap the window to the most recent 30 days.

`fxRefreshWorker` fans out one provider call per base in `['TWD', 'USD', 'AUD']`, filters to stored quote currencies, drops self-pairs before persistence, then bulk-upserts all rows.

The worker logs `fx_refresh_completed` on success and `fx_refresh_failed` before rethrowing failures so pg-boss retries with the default market-data queue policy.

---

## 6. Admin And Test Routes

Admin-only routes:

- `POST /admin/fx-rates/refresh`
  - Body: `{ startDate?: string, endDate?: string, bases?: ('TWD'|'USD'|'AUD')[] }`
  - Defaults to today's UTC date and all three stored bases.
  - Enqueues `fx-refresh` with singleton key `fx-refresh`.
  - Emits audit action `admin_fx_rates_refresh`.
  - Returns 503 `queue_unavailable` when pg-boss is not available.

- `GET /admin/fx-rates/freshness`
  - Returns `{ pairs, queriedAt }`.
  - Each pair includes `baseCurrency`, `quoteCurrency`, `latestDate`, and `ageInDays`.
  - Read-only; no audit row.

Test-only route:

- `POST /__e2e/seed-fx-rates`
  - Guarded by `assertE2ESeedEnabled()`.
  - Seeds rows through `persistence.upsertFxRates`.

---

## 7. Frankfurter V2 Default Blend Mechanics

The implementation uses Frankfurter v2's default blend route, not a pinned provider query. That lets Frankfurter resolve the best central-bank source and fall back when a bank misses a publish.

Provider calls look like:

```text
GET {FRANKFURTER_BASE_URL}/rates?base=USD&from=2026-04-01&to=2026-04-26
```

The response date is persisted exactly as returned by Frankfurter. This matters because weekend and holiday behavior may forward-fill from a prior publish date; the worker must not replace `response.date` with today's date.

---

## 8. Env Additions

`libs/config/src/env-schema.ts` adds:

| Variable | Default | Purpose |
|---|---|---|
| `FRANKFURTER_BASE_URL` | `https://api.frankfurter.dev/v2` | Frankfurter v2 API base URL |
| `FX_PROVIDER_MOCK` | `false` | Use deterministic mock FX provider in dev/test |

`apps/api/vitest.config.ts` sets `FX_PROVIDER_MOCK=true` so tests never call the real Frankfurter API.

---

## 9. `source` Field Naming

FX rows use `source`, matching the DB column name exactly. There is no `sourceId` alias and no fallback such as `?? 'frankfurter'`.

The provider always stamps `source: 'frankfurter'`; persistence writes that value directly. This intentionally differs from KZO-163's optional `sourceId` shape for daily bars and dividend events because FX has no legacy data or fallback provider in KZO-164.

---

## 10. Explicitly Deferred

- Historical walk from earliest cross-currency trade date: KZO-174.
- UI/admin dashboard for freshness: future ticket.
- Snapshot currency conversion reads: KZO-165 consumes `market_data.fx_rates` directly.
- Additional currencies for US/AU cross-currency tickers: KZO-170/KZO-171.
- ADR: reasoning is captured in this transition note and the KZO-164 scope todo.
