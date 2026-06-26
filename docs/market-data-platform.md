# Market Data Platform — Architecture Reference

**Status:** Evergreen (update in-place as implementation progresses)
**Project:** [Market Data Platform](https://linear.app/kzokv/project/market-data-platform-6e850cf67abe/overview)
**Origin:** Promoted from frozen ADR `docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md` on 2026-04-01. Original decisions locked via structured grill session on 2026-03-25 (KZO-122).

---

## 1. Physical Topology

**Decision: Same Postgres instance, dedicated `market_data` schema.**

- The existing Postgres instance gains a `market_data` schema alongside the `public` schema (which owns the transaction ledger).
- Cross-schema joins are supported natively (`public.lots JOIN market_data.daily_bars`).
- A separate microservice was considered and rejected for phase 1. Ingestion runs as a scheduled job inside the existing Fastify API, with module isolation at `apps/api/src/services/market-data/`.

**Why not a separate DB or microservice:**
- Phase 1 data volume is small (~1,000 symbols, daily EOD bars).
- Cross-schema joins are needed for valuation queries (KZO-20, KZO-87).
- A separate service adds deployment, monitoring, and coordination overhead with zero benefit at current scale.
- Can be extracted later if ingestion grows (intraday data, multiple providers).

---

## 2. Write Ownership

### Ledger-owned (`public` schema)

| Table | Owned data |
|---|---|
| `trade_events` | Transaction execution price (`unit_price`) — immutable per trade |
| `dividend_ledger_entries` | Per-account dividend postings (amounts received) |
| `dividend_deduction_entries` | Typed deductions (withholding, fees) |
| `lots` | Weighted-average inventory (account + symbol scoped) |
| `cash_ledger_entries` | Settlement cash and dividend cash |
| `daily_portfolio_snapshots` | Materialized portfolio NAV (see Section 4) |
| `daily_holding_snapshots` | Per-holding valuation snapshots |
| `currency_wallet_snapshots` | Per-account, per-currency cash balance snapshots |

### Market-data-owned (`market_data` schema)

| Table | Owned data |
|---|---|
| `instruments` | Instrument reference metadata keyed by `(ticker, market_code)` |
| `daily_bars` | Raw OHLCV daily bars keyed by `(ticker, market_code, bar_date)`; not adjusted |
| `dividend_events` | Dividend event reference (ex-date, pay-date, amount-per-unit, source) with `market_code` for lookup disambiguation |
| `fx_rates` | Daily FX rates for stored currency pairs (Frankfurter-sourced) |

### Key boundary

- **Transaction execution price** is ledger-owned, not reconstructed from historical bars.
- **Dividend events** (reference data from providers) live in `market_data`. Dividend **postings** (accounting: how much the user received, deductions) live in `public`. The ledger references the market data event via FK: `public.dividend_ledger_entries.dividend_event_id -> market_data.dividend_events.id`.
- **Adjusted prices are not stored.** Raw prices are stored in `market_data.daily_bars`. Adjusted prices are computed on the fly using split event data from FinMind (`TaiwanStockDividendResult`). This halves API budget and eliminates retroactive adjustment staleness.

---

## 3. Ingestion Model

### Providers

- **FinMind** supplies TW and US market data/catalog paths.
- **Yahoo Finance via `yahoo-finance2`** supplies AU and KR bars, basic dividends, metadata, and live search, and supplies JP bars, basic cash dividends, metadata, and live search via `.T` symbol normalization.
- **Twelve Data Basic/free** supplies AU, KR, and JP bulk catalogs only. JP uses `/stocks?country=Japan` plus `/etf?country=Japan` with strict `JPY` + `JPX` + `XJPX` filtering; JP prices do not use Twelve Data.
- **Frankfurter** supplies FX rates for stored reporting currencies.

### FX rates

- **Frankfurter v2 default blend** is the sole FX provider for TWD, USD, AUD, KRW, and JPY rates. Market-data providers are not used for FX, so FX refreshes do not consume equity-provider budgets.
- `market_data.fx_rates` stores one row per `(date, base_currency, quote_currency)` with `NUMERIC(20, 8)` precision, `source='frankfurter'`, and a descending pair/date index for latest-rate lookups.
- The daily `fx-refresh` pg-boss singleton runs at `0 22 * * *` UTC. Normal operation makes one HTTP call per base currency (`TWD`, `USD`, `AUD`, `KRW`, `JPY`) and stores non-self pairs among those currencies.
- The first cron run on an empty table seeds the most recent 30-day window. Subsequent cron runs fetch from `MAX(date)+1` through today's UTC date, capped to the latest 30 days after long gaps.
- Admins can enqueue a manual window with `POST /admin/fx-rates/refresh`. Freshness is visible through `GET /admin/fx-rates/freshness`, which reports latest date and `ageInDays` per pair.

### Demand-driven backfill

Historical bars are **not** backfilled for all ~3,071 TWSE symbols. Backfill is triggered only for symbols users care about:

1. **Instrument reference sync** (daily cron) populates `market_data.instruments` with metadata — this powers the symbol selection UI.
2. **Users configure monitored symbols** in the settings page, selecting from the full TWSE instrument list.
3. **Symbols with open positions** are auto-included in the monitored set, even if deselected from the watchlist.
4. When a new symbol enters the monitored set (user selection or first trade), an **async backfill job** is enqueued.
5. The user is **notified via SSE** when backfill completes. No waiting required — the user saves settings and the system handles it in the background.

KZO-169 generalizes the selector and monitored-symbol flow from ticker-only to `(ticker, market_code)`. The transaction form exposes market chips (`TW`, `US`, `AU`, `KR`, `JP`, `All`), `/instruments?market_code=...` filters autocomplete server-side, and `All` mode renders rows with a market suffix for ambiguous symbols. Trade currency is derived from `instrument.market_code`, so account filtering and the server-side `currency_mismatch` guard use the same source of truth.

### AU provider strategy (KZO-171 spike outcome, KZO-172 implementation)

**v1 provider: `yahoo-finance2` (Yahoo Finance unofficial API).** Locked 2026-05-02 via the KZO-171 spike. Live validation evidence at `docs/004-notes/kzo-171/spike-202605021115-au-provider.md`.

Key contract:
- `providerId = "yahoo-finance-au"`, `sourceId = "yahoo-finance-au"`. Registered under `MarketCode "AU"` in `buildMarketDataRegistry()` parallel to the FinMind TW/US providers.
- **Symbol normalization at the provider boundary.** Internal storage is `(ticker='BHP', market_code='AU')`; the provider serializes to `BHP.AX` for Yahoo. Bare ticker silently routes to the NYSE listing in USD — `.AX` is mandatory.
- **Independent `RateLimiter` instance** — Yahoo does NOT share the FinMind 600/hr budget. Recommend a precautionary self-imposed ceiling (Yahoo publishes none).
- **`HISTORY_START_BY_MARKET["AU"] = "1988-01-28"`** (BHP first available bar in Yahoo's feed). Pre-this-date trade dates get truncated with a `pre_provider_history_truncated` log, mirroring KZO-170 D13.
- **Bounded catalog only.** `yahoo-finance2.screener()` exposes no AU scrId; there is no reliable ASX-wide enumeration. KZO-172 ships per-symbol `quote()` enrichment for monitored symbols + per-query `search()` for type-ahead. **No full ASX autocomplete.** The first downstream ticket that needs it adds an EODHD-backed catalog provider.
- **Splits owned by KZO-186.** Yahoo's split data is sparse for ASX historical (proven via DMP 2015 3:1 missing from the feed). KZO-186 must independently select an AU split source — do not assume Yahoo.

What Yahoo cannot supply (locked Yahoo gaps, EODHD upgrade path):
- Franking credits, DRP/BSP indicators, withholding tax, special-vs-ordinary dividend classification.
- Rights issues, capital returns, share purchase plans, buyback events.
- Full ASX catalog enumeration.
- Comprehensive AU split coverage.

**EODHD upgrade path (re-verified 2026-05-02).** Source: ASX ReferencePoint E34 feed, refreshed daily after 18:30 AEST.

| Tier | Plan | What you get for AU |
|---|--:|---|
| Day-one | yahoo-finance2 | Bars, basic dividends (amount + date), per-symbol metadata |
| **EOD All-World** | **$19.99/mo** | EOD prices + basic splits & dividends, 30+ years history, 2,000+ ASX securities, exchange redistribution rights — *but no `_asx_extra` block* |
| **Fundamentals** | **$59.99/mo** | All of the above PLUS the **ASX Corporate Actions API (beta)** with `_asx_extra` (franking %, DRP, BSP, withholding tax, rights/bonus/buyback/capital-return events) |
| All-In-One | $99.99/mo | Fundamentals + intraday + news/calendar |

Switch from Yahoo → EODHD when any of: (1) commercializing beyond personal use (Yahoo ToS), (2) tax reporting requires franking credits, (3) AU split events become operationally required, (4) Yahoo HTML/`chart()` breaks unrecoverably across releases, (5) full ASX catalog enumeration becomes a product requirement. The swap is a registry-level change in `buildMarketDataRegistry()` — no call-site changes (KZO-163 invariant).

Likely env vars when EODHD lands: `EODHD_API_KEY`, `EODHD_BASE_URL` (default `https://eodhd.com/api`), `EODHD_RATE_LIMIT_PER_DAY` (default 100k), `EODHD_RATE_LIMIT_PER_MINUTE` (default 1000), `EODHD_PLAN` (signals whether `_asx_extra` is available).

### KR provider strategy

KR uses a split provider model because the no-paid Twelve Data plan covers KRX/KOSDAQ catalog discovery but not KR price/time-series data.

Key contract:
- `providerId = "yahoo-finance-kr"`, `sourceId = "yahoo-finance-kr"` for bars, dividends, metadata, and live search.
- Canonical stored/user-facing KR tickers are bare KRX codes such as `005930`. The provider resolves Yahoo suffixes internally, preferring `.KS` then `.KQ` and caching the validated suffix per bare ticker.
- `providerId = "twelve-data-kr"` for KR catalog sync. It reads `/stocks` and `/etf` for `exchange=KRX` plus `exchange=KOSDAQ`, validates `mic_code = "XKRX"` / `"XKOS"`, includes common stock, preferred stock, REIT, and ETF rows, and filters ETN/warrant-like rows out of the app catalog.
- Basic cash dividends only: Yahoo dividend events are stamped with `paymentDate = exDividendDate`, `stockDividendPerShare = 0`, and no withholding/source automation.
- No automatic corporate-action handling for KR in v1. Splits, rights, and other corporate actions remain manual or future-provider work.
- `HISTORY_START_BY_MARKET["KR"] = "2000-01-04"` and the trading calendar uses `Asia/Seoul` with a 15:30 close.
- KR catalog rows do not expose reliable sector/GICS data on the free catalog path, so the web instrument sheet omits the sector filter for KR.

### JP provider strategy

JP uses the same split-provider architecture as KR, but with Yahoo-only market-data ownership and no durable mapping repair.

Key contract:

- `providerId = "yahoo-finance-jp"`, `sourceId = "yahoo-finance-jp"` for daily bars, basic cash dividends, metadata, live search, close refresh, and intraday overlays.
- `providerId = "twelve-data-jp"` for JP catalog sync. It reads `/stocks?country=Japan` and `/etf?country=Japan`, requires `currency = "JPY"`, `exchange = "JPX"`, `mic_code = "XJPX"`, and applies a strict symbol regex by default.
- Canonical stored/user-facing JP tickers are bare JPX/TSE symbols such as `7203`, `1306`, `130A`, or `133A`. The Yahoo provider appends `.T` only at the provider boundary and persists the bare code.
- Strict catalog inclusion is the default: stock rows must be `Common Stock`, `Preferred Stock`, or `REIT`; ETF endpoint rows are always classified as `ETF`; rows containing `@`, `Depositary Receipt`, unsupported stock types, wrong currency, wrong exchange, or wrong MIC are excluded unless the admin catalog-import overrides relax only the stock-type / receipt / `@` gates.
- JP instrument discovery is catalog-first. Yahoo search is metadata/search fallback only and is not the source of truth for what the app can monitor or backfill.
- Basic cash dividends only: Yahoo dividend events are stamped with `paymentDate = exDividendDate`, `stockDividendPerShare = 0`, and no JP withholding/sell-tax automation.
- No KR-style provider mapping repair in JP v1. The admin console documents that JP uses direct `.T` normalization instead of durable provider-symbol mappings.
- `HISTORY_START_BY_MARKET["JP"] = "2000-01-04"`.

Operational knobs:

- Restart-required env toggles: `JP_PROVIDER_MOCK`, `JP_CATALOG_PROVIDER_MOCK`.
- Admin/app-config overrides: `yahooJpProviderRateLimitPerMinute`, `yahooJpProviderMinRequestIntervalMs`, `jpCatalogAllowedStockTypes`, `jpCatalogIncludeDepositaryReceipts`, `jpCatalogIncludeAtSymbols`.

Known JP v1 limitations:

- Lunch-break precision is deferred. The current regular-session model treats JP as one `09:00` to `15:30` `Asia/Tokyo` session for settlement/freshness, so intraday "open" state is intentionally coarse during the midday recess.
- No official J-Quants integration in v1. J-Quants remains the future official-provider upgrade path for richer fundamentals, dividends, and calendars.
- No built-in JP sell-tax rules. Existing configurable fee/tax rules remain the only mechanism.
- Focused JP provider coverage exists for Twelve Data catalog filtering/config and Yahoo `.T` normalization. JP search route coverage also proves persisted catalog matches are returned before Yahoo fallback.

No-paid-plan research locked on 2026-05-30:
- Twelve Data Basic/free catalog endpoints returned KRX stock and ETF universes, and `symbol_search` worked for KR queries.
- Twelve Data `/price` and `/time_series` for KRX tickers were rejected under the free plan, so Twelve Data cannot be the KR market-data provider without a paid upgrade.
- Yahoo Finance returned quote/chart/dividend/fundamental data for `005930.KS` and `035900.KQ`, with delayed/best-effort coverage and KRW currency.

### Backfill status

Per-symbol tracking: `pending -> backfilling -> ready -> failed`.

Partial success is kept — if 45/50 symbols succeed and 5 fail, the 45 are marked `ready` and the 5 are retried independently.

### Rate limit priority

Daily refresh has **priority** over backfill in the 600 req/hr budget. Fresh daily bars for existing symbols matter more than historical backfill for new ones. Implementation uses a priority queue: daily refresh jobs at priority 10, backfill at priority 0.

### Daily refresh scope

The daily refresh job fetches new bars for the **distinct union of monitored `(ticker, market_code)` pairs across all users** — not per-user. `market_data.daily_bars` is shared, not user-scoped.

### Trading calendar derivation

KZO-173 adds service-layer trading-calendar helpers without a calendar table, seed file, migration, admin route, scheduler holiday skip, or external holiday dependency. The calendar source of truth is the set of distinct `bar_date` values already present in `market_data.daily_bars` for each `market_code`.

`apps/api/src/services/market-data/tradingCalendar.ts` exposes `TradingCalendarCache` on `app.tradingCalendarCache` with three consumer helpers:

- `latestSettledTradingDay(market, now, options?)`
- `tradingDaysBetween(d1, d2, market)`
- `isTradingDay(market, date)`

The cache refreshes from `Persistence.getDistinctBarDates(market, fromDate)` with a 400-day lookback and a 1-hour TTL. It deduplicates concurrent cold refreshes per market and updates synchronously when daily bars are upserted by backfill, opportunistic price fallback, or `/__e2e/seed-daily-bars`. Multi-instance deployments can lag up to the TTL on instances that did not perform the write; this is acceptable for the current freshness thresholds.

Settlement math uses the market-local close time: TW 13:30 Asia/Taipei, US 16:00 America/New_York, AU 16:00 Australia/Sydney, KR 15:30 Asia/Seoul, and JP 15:30 Asia/Tokyo. `settleGraceHours` lets downstream freshness checks delay same-day settlement until ingestion should have landed bars; KZO-177 passes a grace window instead of declaring providers stale in the close-to-cron gap. Synthetic `FX` uses weekdays plus a 16:00 UTC publish threshold. v1 limitations: FX ignores ECB/TARGET2 holidays (KZO-192), equity markets ignore early-close sessions (KZO-193), and JP lunch-break precision is not modeled yet.

When a market has no recent derived bars, helpers fall back to weekday-only logic and emit a once-per-refresh warning (`trading_calendar_bootstrap_fallback`). This keeps bootstrap and empty-market development flows from failing hard while making missing calendar data visible in logs.

### Demo users

Demo users receive **fixture/seed data only**. No real FinMind API calls are triggered by demo sessions. `getAllMonitoredTickers()` excludes demo users entirely.

### Trading hours gap

FinMind updates at **17:30 TST**. Between market close (13:30) and the FinMind update, the UI shows: "Today's data not yet available, refreshes at 17:30". This aligns with the `isProvisional` / `asOf` pattern from KZO-87.

---

## 4. Read Paths

| Consumer | Data source | Schema(s) |
|---|---|---|
| Historical price charts | `market_data.daily_bars` | `market_data` only |
| Value-over-time charts | `public.daily_portfolio_snapshots` (materialized) | `public` only (pre-joined) |
| Dividend event calendar | `market_data.dividend_events` | `market_data` only |
| Received dividends / P&L | `public.dividend_ledger_entries` JOIN `market_data.dividend_events` | Cross-schema |
| Valuation-by-date | `public.daily_portfolio_snapshots` lookup | `public` only |
| Holding snapshot drill-down | `public.daily_holding_snapshots` | `public` only |
| Currency wallet balances | `public.currency_wallet_snapshots` | `public` only |

### Portfolio snapshot materialization (Option B)

Value-over-time and valuation-by-date queries read from **materialized `daily_portfolio_snapshots`**, not computed on the fly.

- A post-ingest job runs after daily bars land (Job 3 in the ingest pipeline).
- For each user/account, it reconstructs positions at that date, multiplies by close price, and stores the snapshot row.
- Phase 1 (single/few users): trivial compute cost.
- **Migration to lazy/hybrid (Option C) is schema-compatible** — the snapshot table is identical regardless of write strategy. When user count warrants it, switch to compute-on-first-request without schema changes.

### Multi-currency snapshot scaffolding

KZO-165 adds the schema shape for multi-currency reporting without changing the dashboard read model yet. `daily_holding_snapshots.currency` now means the holding's native currency, and the writer dual-writes legacy `cost_basis`, `market_value`, and `unrealized_pnl` from the matching native columns until KZO-176 rewrites the dashboard read path and removes the legacy fields.

`currency_wallet_snapshots` stores one row per `(account_id, currency, date)` with `user_id` denormalized for user/date reads and a composite FK back to `accounts(id, user_id)`. KZO-165's writer is only a cash-ledger running-balance stub: `wac_fx_to_usd` is `NULL`, `realized_fx_pnl_lifetime` is `0`, and `provider_source` is `NULL`. WAC FX math and realized FX P&L crystallization landed in KZO-166; see [Currency wallet WAC + realized FX P&L (KZO-166)](#currency-wallet-wac--realized-fx-pl-kzo-166) below.

### Currency wallet WAC + realized FX P&L (KZO-166)

KZO-166 lights up the WAC (weighted-average cost) engine on top of KZO-165's wallet snapshot scaffold. On every cross-currency cash inflow with a non-null `fx_rate_to_usd`, the WAC walker weights the new FX rate against the running balance × prior WAC. On every cross-currency outflow, it crystallizes realized FX P&L = `(saleRate − wac) × |amountSold|` in USD, signed (gains positive, losses negative), accumulating into `realized_fx_pnl_lifetime`. The engine is **production-inert until KZO-168** ships the `FX_TRANSFER` cash-entry type; tests exercise it via synthetic `MANUAL_ADJUSTMENT` entries with `fx_rate_to_usd` populated.

**Pure math module:** `apps/api/src/services/currencyWalletAccounting.ts` — pure functions `applyEntryToWalletState` and `computeRealizedFxPnl`, plus typed errors `WalletAccountingError` (base) → `InsufficientWalletBalanceError`, `MissingFxRateError`. No I/O imports; testable in isolation.

**Generator wiring:** `apps/api/src/services/currencyWalletSnapshotGeneration.ts` sources entries via `getCashLedgerEntriesForWalletReplay` (deterministic `(entry_date, booked_at, id)` order with REVERSAL-pair filtering), threads a `Map<string, WalletGroupState>` keyed by `(accountId, currency)`, and writes computed values to the snapshot row.

**`getFxRate(base, quote, asOfDate)` persistence helper:** Reads `market_data.fx_rates` with forward-fill (latest rate ≤ `asOfDate`). Self-pair shortcut returns `1.0` without DB access. Returns `null` when no rate exists at all. Backed by `idx_fx_rates_pair_date_desc`. Write-path callers throw `MissingFxRateError`; read-path callers degrade to native-only (D8).

**Cell stamping rules (D10/D11):**

| Wallet | `wac_fx_to_usd` | `realized_fx_pnl_lifetime` | `provider_source` |
|---|---|---|---|
| USD | `1.0` | `0` | `'frankfurter'` |
| Non-USD, WAC computed | rounded to 8dp | accumulated (signed USD) | `'frankfurter'` |
| Non-USD, no FX-stamped inflow | `NULL` | `0` | `NULL` (KZO-165 compat) |

**REVERSAL handling (D7):** Original FX inflow + REVERSAL pair are filtered out by `getCashLedgerEntriesForWalletReplay` upstream — both invisible to WAC, both still net to zero in `balance_native`.

**Migration 039:** `db/migrations/039_kzo166_cash_ledger_fx_rate.sql` adds nullable `fx_rate_to_usd NUMERIC(20, 8)` to `cash_ledger_entries` with `CHECK (fx_rate_to_usd IS NULL OR fx_rate_to_usd > 0)`. Idempotent via `ADD COLUMN IF NOT EXISTS` + `DO $$` constraint guard.

**Consumer status:** KZO-180 is the first read-time consumer. Dashboard reads resolve `preferences.reportingCurrency` via `resolveReportingCurrency(...)`, defaulting to TWD for missing or invalid stored values. `/dashboard/overview.summary` translates the five KPI totals through `dashboardReportingCurrency.ts` with one as-of-date `getFxRate` lookup per source currency. `/dashboard/performance.points[]` uses `getAggregatedSnapshotsInReportingCurrency(...)`, a per-snapshot-date translate-then-sum path backed by a `LEFT JOIN LATERAL` forward-fill lookup and an explicit self-pair guard. Missing read-side FX reports `fxStatus` at response level and `fxAvailable` per performance point. KZO-180 v1 translates denormalized `cumulative_realized_pnl` at snapshot-date FX; sale-date-locked attribution remains owned by KZO-176.

### Per-account currency and account type (KZO-167)

KZO-167 ships two per-account schema additions to the `accounts` table: `default_currency CHAR(3)` (now widened to enum `'TWD'|'USD'|'AUD'|'KRW'|'JPY'`, default `'TWD'`) and `account_type TEXT` (enum `'broker'|'bank'|'wallet'`, default `'broker'`). Migration `040_kzo167_account_currency_and_type.sql` is idempotent; existing accounts backfill to TWD/broker automatically via `DEFAULT` on `ADD COLUMN`, and follow-up market migrations widen the currency check through KRW and JPY. Two shared-type unions (`AccountDefaultCurrency`, `AccountType`) are part of `AccountDto` in `@vakwen/shared-types`.

A new service module `apps/api/src/services/cashLedgerService.ts` enforces the cash-entry currency invariant on emission paths 1–3: a mismatch between `entry.currency` and `account.defaultCurrency` throws `routeError(400, "currency_mismatch", ...)`. The full-replay path (path 4, `replayPositionHistory.ts:161`) is explicitly exempt per `replay-position-history-invariants.md`. `PATCH /accounts/:id` adds optional `defaultCurrency` and `accountType` fields; a currency change is blocked with `409 currency_change_blocked` if the account has any existing cash entries or trade events. The `/cash-ledger` page now renders `Name (TWD · Broker)` chips in account dropdowns and summary headers.

**`account_type` is metadata-only in KZO-167** — no behavioral gating on entry types by account type. Behavioral semantics land in downstream tickets (KZO-168 `FX_TRANSFER`, KZO-170/171 US/AU markets).

**Sibling tickets:** KZO-179 (multi-account creation, `POST /accounts`) and KZO-180 (user-level `preferences.reportingCurrency` JSONB key + dashboard FX-aware reads + settings UI) build on KZO-167.

---

## 5. Ingest Pipeline

### Job chain and ticket ownership

| Job | Name | Ticket | Status | Chains from |
|-----|------|--------|--------|-------------|
| 1 | Catalog Sync | KZO-83 (logic) + KZO-130 (cron scheduling) | **Done** | pg-boss cron `30 17 * * 1-5` |
| 2 | Daily Refresh | KZO-130 | **Done** (PR #92) | Soft-chains from Job 1 (runs on success or failure) |
| — | On-demand Backfill | KZO-126 (infra) + KZO-85 (absorbed) | **Done** | User action (settings UI or first trade) |
| 3 | Snapshot Materialization | KZO-87 (folded in) | **Not started** | Chains from Job 2 completion |
| 4 | Post-Ingest Backup | KZO-131 | **Not started** | Chains from Job 3 completion |

### Backfill trigger hooks

All four trigger paths are wired:

| Trigger | Route/Module | Priority |
|---------|-------------|----------|
| `user_selection` | `PUT /monitored-tickers` | 0 (backfill) |
| `first_trade` | `POST /portfolio/transactions` | 0 (backfill) |
| `retry` | `POST /backfill/retry` | 0 (backfill) |
| `daily_refresh` | `dailyRefreshEnqueue.ts` (cron chain) | 10 (daily refresh) |

Known gap: `POST /ai/transactions/confirm` does not trigger backfill (to be fixed in KZO-129).

### Data flow diagram (pre-production)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           DEV (QNAP)                                      │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐      │
│  │              Fastify API  (vakwen-dev-api)                         │      │
│  │                                                                 │      │
│  │  pg-boss cron: 30 17 * * 1-5 (weekdays, 17:30 TST)             │      │
│  │  ┌───────────────────────────────────────────────────┐          │      │
│  │  │ Job 1: Catalog Sync                               │          │      │
│  │  │ Tickets: KZO-83 (logic) + KZO-130 (cron)  Done    │          │      │
│  │  │   Queue: catalog-sync (singleton)                 │          │      │
│  │  │   FinMind TaiwanStockInfo    -> 4,077 rows        │          │      │
│  │  │   FinMind TaiwanStockDelisting -> 277 rows        │          │      │
│  │  │   dedup (3,071) -> classify -> bulk upsert        │          │      │
│  │  └────────────────────────┬──────────────────────────┘          │      │
│  │                           │ soft chain (finally block)          │      │
│  │  ┌────────────────────────▼──────────────────────────┐          │      │
│  │  │ Job 2: Daily Refresh                              │          │      │
│  │  │ Ticket: KZO-130                            Done   │          │      │
│  │  │   Queue: finmind-backfill (priority: 10)          │          │      │
│  │  │   For each monitored ticker (all users):          │          │      │
│  │  │   |-- FinMind TaiwanStockPrice -> daily bars      │          │      │
│  │  │   \-- FinMind TaiwanStockDividend -> divid. evts  │          │      │
│  │  │   7-day lookback window, ON CONFLICT upsert       │          │      │
│  │  │   SSE fan-out: daily_refresh_complete per user     │          │      │
│  │  └────────────────────────┬──────────────────────────┘          │      │
│  │                           │ (chain not yet implemented)         │      │
│  │  ┌────────────────────────▼──────────────────────────┐          │      │
│  │  │ Job 3: Snapshot Materialization                   │          │      │
│  │  │ Ticket: KZO-87 (folded in)            Not built   │          │      │
│  │  │   For each user/account:                          │          │      │
│  │  │   positions x close price -> snapshot row         │          │      │
│  │  │   Writes: public.daily_portfolio_snapshots        │          │      │
│  │  └────────────────────────┬──────────────────────────┘          │      │
│  │                           │ (chain not yet implemented)         │      │
│  │  ┌────────────────────────▼──────────────────────────┐          │      │
│  │  │ Job 4: Post-Ingest Backup                        │          │      │
│  │  │ Ticket: KZO-131                       Not built   │          │      │
│  │  │   pg_dump -n market_data -> latest.dump           │          │      │
│  │  │   pg_dump -n public -> ledger_YYYYMMDD.dump       │          │      │
│  │  │   Retention: market_data latest-only,             │          │      │
│  │  │              ledger 30-day rotation                │          │      │
│  │  └────────────────────────┬──────────────────────────┘          │      │
│  │                           │                                     │      │
│  │  -- Parallel path (user-initiated, not cron) ----------         │      │
│  │  ┌──────────────────────────────────────────────────┐           │      │
│  │  │ On-demand Backfill                               │           │      │
│  │  │ Tickets: KZO-126 (infra) + KZO-85 (absorbed)     │           │      │
│  │  │   Queue: finmind-backfill (priority: 0)   Done   │           │      │
│  │  │   Triggers:                                      │           │      │
│  │  │   |-- PUT /monitored-tickers (user_selection)    │           │      │
│  │  │   |-- POST /portfolio/transactions (first_trade) │           │      │
│  │  │   \-- POST /backfill/retry (retry)               │           │      │
│  │  │   Full history: 1994-10-01 -> today              │           │      │
│  │  │   SSE: backfill_started/complete/failed per user  │           │      │
│  │  └──────────────────────────────────────────────────┘           │      │
│  │                                                                 │      │
│  └─────────────────────────────┬───────────────────────────────────┘      │
│                                ▼                                          │
│  ┌──────────────────────────────────────────────┐                         │
│  │  vakwen-dev-postgres                            │                         │
│  │                                              │                         │
│  │  public schema (ledger)                      │                         │
│  │  |-- trade_events                            │                         │
│  │  |-- lots                                    │                         │
│  │  |-- cash_ledger_entries                     │                         │
│  │  |-- dividend_ledger_entries --FK--+         │                         │
│  │  \-- daily_portfolio_snapshots     |         │                         │
│  │                                    |         │                         │
│  │  market_data schema                |         │                         │
│  │  |-- instruments  (3,071 tickers)  |         │                         │
│  │  |-- daily_bars   (OHLCV)         |         │                         │
│  │  \-- dividend_events <-------------+         │                         │
│  │       (cross-schema FK)                      │                         │
│  └───────────────────┬──────────────────────────┘                         │
│                      │                                                    │
│     /share/backups/market_data/market_data_latest.dump                    │
│     /share/backups/ledger/ledger_YYYYMMDD_HHMM.dump (30-day rot.)        │
│                      │                                                    │
└──────────────────────┼────────────────────────────────────────────────────┘
                       │
                       │  manual scp over LAN
                       ▼
┌──────────────────────────────────────────┐
│  ┌──────────────────────┐                │
│  │  vakwen-local-postgres  │                │
│  │  market_data schema  │  <- restored   │
│  │  (read-only copy)    │    manually    │
│  └──────────────────────┘                │
│       LOCAL (Lume VM)                    │
└──────────────────────────────────────────┘

Data flows:
  FinMind API -> Dev only (sole writer, 600 req/hr budget)
  Dev dump    -> Local (manual scp)
  Local never calls FinMind
```

### Full system architecture (pre-production)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER BROWSER                                                                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │  Next.js Web App (SSR + Client)                                   │      │
│  │                                                                   │      │
│  │  Pages:                          Hooks:                           │      │
│  │  |-- /portfolio (holdings)       |-- useEventStream (SSE, on)     │      │
│  │  |-- /portfolio/[ticker]         |-- useMutations (recompute)     │      │
│  │  |-- /settings (monitored)       \-- useAuth (session cookies)    │      │
│  │  \-- /login                                                       │      │
│  │                                                                   │      │
│  │  State:                          Missing (KZO-132):               │      │
│  │  |-- Zustand stores              \-- daily_refresh SSE handling   │      │
│  │  |-- React Query cache                                            │      │
│  │  \-- EventSource (pre-connect)                                    │      │
│  └──────────┬──────────────────────────────┬─────────────────────────┘      │
│             │ HTTP (fetch)                  │ SSE (EventSource)              │
└─────────────┼──────────────────────────────┼────────────────────────────────┘
              │                              │
              ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  QNAP NAS (Docker)                                                           │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │  vakwen-dev-web (Next.js, port 3333)                                 │      │
│  │                                                                   │      │
│  │  |-- SSR server components (cookies via next/headers)             │      │
│  │  |-- proxy.ts -> forwards auth'd requests to API                  │      │
│  │  │   Header: x-authenticated-user-id: {userId}                    │      │
│  │  \-- app/api/* route handlers (JSON 401, not redirect)            │      │
│  └──────────┬────────────────────────────────────────────────────────┘      │
│             │ HTTP (internal)                                                │
│             ▼                                                                │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │  vakwen-dev-api (Fastify, port 4000)                                 │      │
│  │                                                                   │      │
│  │  +-- Routes -----------------------+  +-- Plugins ---------------+│      │
│  │  │ GET/POST /portfolio/*           │  │ @fastify/cors            ││      │
│  │  │ PUT /monitored-tickers          │  │ @fastify/cookie          ││      │
│  │  │ POST /backfill/retry            │  │ pgBoss plugin            ││      │
│  │  │ GET /stream (SSE)              │  │ resolveUserId (auth)     ││      │
│  │  │ POST /ai/transactions/*         │  │ BufferedEventBus (SSE)   ││      │
│  │  │ GET/POST /auth/google/*         │  +---------------------------+│      │
│  │  +----------------------------------+                              │      │
│  │                                                                   │      │
│  │  +-- Services ----------------------------------------------------+│      │
│  │  │                                                                ││      │
│  │  │  market-data/                                                  ││      │
│  │  │  |-- registry.ts          buildMarketDataRegistry (KZO-163)   ││      │
│  │  │  |-- marketResolution.ts  resolveMarketCode(ticker) seam      ││      │
│  │  │  |-- providers/           per-market provider classes         ││      │
│  │  │  │   |-- finmind.ts       FinMindMarketDataProvider (TW)      ││      │
│  │  │  │   \-- mockFinmind.ts   MockFinMindMarketDataProvider       ││      │
│  │  │  |-- rateLimiter.ts       sliding window, per-provider        ││      │
│  │  │  |-- catalogSync.ts       dedup + classify instruments        ││      │
│  │  │  |-- runCatalogSync.ts    orchestrator for catalog sync       ││      │
│  │  │  |-- backfillWorker.ts    polymorphic handler (4 triggers)    ││      │
│  │  │  |-- upserts.ts           shared upsertDailyBars/DividendEvts ││      │
│  │  │  |-- dailyRefreshEnqueue  enqueue per-ticker refresh jobs     ││      │
│  │  │  |-- registerBackfillWorker.ts    pg-boss worker setup        ││      │
│  │  │  \-- registerCatalogSyncWorker.ts pg-boss cron + soft chain   ││      │
│  │  │                                                                ││      │
│  │  │  accounting/                                                   ││      │
│  │  │  |-- orderLots.ts         FIFO lot allocation                  ││      │
│  │  │  |-- replayPositionHistory.ts  scoped recompute                ││      │
│  │  │  \-- feeCalculation.ts    TWSE fee engine                      ││      │
│  │  │                                                                ││      │
│  │  +----------------------------------------------------------------+│      │
│  │                                                                   │      │
│  │  +-- pg-boss Queues ----------------------------------------------+│      │
│  │  │                                                                ││      │
│  │  │  catalog-sync (singleton, cron: 30 17 * * 1-5)                ││      │
│  │  │    -> Job 1: catalog sync -> soft-chains to daily refresh      ││      │
│  │  │                                                                ││      │
│  │  │  finmind-backfill (stately, priority-ordered)                  ││      │
│  │  │    -> priority 10: daily refresh (7-day lookback)              ││      │
│  │  │    -> priority 0:  on-demand backfill (full history)           ││      │
│  │  │    Retry: 3 attempts, 60s delay, exponential backoff           ││      │
│  │  │                                                                ││      │
│  │  +----------------------------------------------------------------+│      │
│  └──────────┬────────────────────────────────────────────────────────┘      │
│             │ SQL (pg)                                                       │
│             ▼                                                                │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │  vakwen-dev-postgres (port 5432)                                     │      │
│  │                                                                   │      │
│  │  public schema (ledger)            |  market_data schema          │      │
│  │  |-- users                         |  |-- instruments (3,071)     │      │
│  │  |-- accounts                      |  |   |-- ticker (PK)        │      │
│  │  |-- trade_events                  |  |   |-- instrument_type     │      │
│  │  |-- lots                          |  |   |-- backfill_status     │      │
│  │  |-- cash_ledger_entries           |  |   \-- last_synced_at      │      │
│  │  |-- dividend_ledger_entries -FK-> |  |-- daily_bars (OHLCV)     │      │
│  │  |-- dividend_deduction_entries    |  |   \-- (ticker,bar_date)PK│      │
│  │  |-- daily_portfolio_snapshots     |  \-- dividend_events         │      │
│  │  |-- user_monitored_tickers        |      \-- (deterministic ID)  │      │
│  │  \-- schema_migrations             |                              │      │
│  │                                    |  pg-boss schema (job queue)  │      │
│  │                                    |  \-- pgboss.job, .schedule   │      │
│  └──────────────────────────────┬────────────────────────────────────┘      │
│                                 │                                            │
│  /share/backups/                │                                            │
│  |-- market_data/market_data_latest.dump          (KZO-131, not built)      │
│  \-- ledger/ledger_YYYYMMDD_HHMM.dump             (KZO-131, not built)     │
│                                 │                                            │
└─────────────────────────────────┼────────────────────────────────────────────┘
                                  │  manual scp over LAN
                                  ▼
┌──────────────────────────────────────────────────────────────┐
│  LOCAL (Lume VM, macOS host)                                  │
│                                                               │
│  ┌─────────────────────────┐  ┌────────────────────────┐     │
│  │ vakwen-local-postgres      │  │ Fastify API (dev mode) │     │
│  │ port 5732               │  │ AUTH_MODE=dev_bypass    │     │
│  │ market_data (restored)  │  │ mock FinMind client     │     │
│  │ public (local ledger)   │  │ boss = null (no cron)   │     │
│  └─────────────────────────┘  └────────────────────────┘     │
│                                                               │
│  External: FinMind API (HTTPS, 600 req/hr with token)         │
│  External: Google OAuth (login flow, session cookies)         │
└───────────────────────────────────────────────────────────────┘
```

---

## 6. Environment Policy

> **Updated 2026-03-31:** Dev is the active FinMind caller while the project is pre-production. Production environment is not yet deployed. When the project goes live, the sole-writer role transfers from dev to prod, and dev reverts to dump-restore.

### Network topology

```
QNAP (192.168.2.xxx)     <- LAN ->  Mac Host (192.168.2.yyy)  <- VM bridge ->  Lume VM (192.168.64.x)
  [dev postgres]                                                                [local dev postgres]
```

Lume VM can reach QNAP directly (confirmed: VM pings QNAP). VM software: Lume.

### Environment matrix (pre-production)

| Environment | Postgres location | Market data source | Calls FinMind? |
|---|---|---|---|
| **Dev** | `vakwen-dev-postgres` on QNAP | Daily ingest job (runs after 17:30 TST FinMind update) | **Yes** — sole writer (pre-prod) |
| **Local** | `vakwen-local-postgres` on Lume VM | Manual restore via `scp` from QNAP | No |
| **Production** | Not yet deployed | — | — |

### Environment matrix (post-launch)

| Environment | Postgres location | Market data source | Calls FinMind? |
|---|---|---|---|
| **Production** | `vakwen-prod-postgres` on QNAP | Daily ingest job (runs after 17:30 TST FinMind update) | **Yes** — sole writer |
| **Dev** | `vakwen-dev-postgres` on QNAP | Auto-restore from prod dump (QNAP shared filesystem, runs after ingest) | No |
| **Local** | `vakwen-local-postgres` on Lume VM | Manual restore via `scp` from QNAP | No |

### Snapshot distribution (pre-production)

**Dev -> Local (manual, over LAN):**
```bash
scp user@192.168.2.xxx:/share/backups/market_data/market_data_latest.dump ./
pg_restore -h localhost -p 5732 -n market_data --clean --if-exists -d $DB market_data_latest.dump
```

Only the `market_data` schema is restored to local. The ledger (`public` schema) is not distributed.

### Snapshot distribution (post-launch)

When production is deployed, the dump flow becomes:

**Prod -> Dev (automatic, same QNAP host):**
```bash
# Runs as part of the post-ingest cron, after daily bars land
docker exec vakwen-prod-postgres pg_dump -U $USER -n market_data --format=custom $DB \
  > /share/backups/market_data/market_data_latest.dump

docker exec -i vakwen-dev-postgres pg_restore -U $USER -n market_data --clean --if-exists -d $DB \
  < /share/backups/market_data/market_data_latest.dump
```

**Prod -> Local (manual, over LAN):**
```bash
scp user@192.168.2.xxx:/share/backups/market_data/market_data_latest.dump ./
pg_restore -h localhost -p 5732 -n market_data --clean --if-exists -d $DB market_data_latest.dump
```

### Bootstrapping (first-time setup, pre-production)

1. Deploy `market_data` schema migration to dev
2. Run KZO-83 catalog sync -> populate full instrument catalog
3. Run initial backfill for monitored symbols (KZO-126 infra)
4. First `pg_dump -n market_data` -> dump now has catalog + bars
5. Local restore from that dump
6. KZO-130 daily refresh -> re-dump cycle begins

Scripted as `npm run market-data:backfill` (dev) and `npm run market-data:restore` (local).

---

## 7. Backup and Retention

### Backup scheme

| Schema | Strategy | Retention | File naming |
|---|---|---|---|
| `public` (ledger) | Daily timestamped `pg_dump` | 30-day rotation | `ledger_YYYYMMDD_HHMM.dump` |
| `market_data` | Latest-only `pg_dump` (also serves as dev/local restore source) | Single latest file | `market_data_latest.dump` |

### Schedule

Both backups run after the daily bar ingest completes (post-17:30 TST). Pre-production, the source is `vakwen-dev-postgres`; post-launch, swap to `vakwen-prod-postgres`.

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M)
PG_CONTAINER=vakwen-dev-postgres  # Change to vakwen-prod-postgres post-launch

# Ledger (critical, timestamped, 30-day rotation)
docker exec $PG_CONTAINER pg_dump -U $USER -n public --format=custom $DB \
  > /share/backups/ledger/ledger_${TIMESTAMP}.dump
find /share/backups/ledger/ -name "*.dump" -mtime +30 -delete

# Market data (latest-only, also serves as restore source)
docker exec $PG_CONTAINER pg_dump -U $USER -n market_data --format=custom $DB \
  > /share/backups/market_data/market_data_latest.dump
```

### Storage

- Primary: QNAP `/share/backups/` (same host as Postgres)
- Future: replicate to cloud storage for disk-failure resilience (destination TBD)

### Retention policy

- Ledger backups: 30-day rotation (mutable schema — need point-in-time recovery after bad deletes)
- Market data: indefinitely retained in the live database (no pruning of old daily bars)
- Market data backup: latest snapshot only (reconstructible from FinMind if lost)

---

## 8. Edge Cases Resolved

| Edge case | Resolution |
|---|---|
| Backfill failure midway | Per-symbol status tracking (`pending/backfilling/ready/failed`). Partial success kept. Failed symbols retried independently. |
| Delisted symbols | Flag to user: "Symbol XXXX appears delisted, last data: YYYY-MM-DD". Historical data retained. Daily refresh stopped for that symbol. |
| Ticker changes / corporate actions | Deferred for phase 1. Add `status_reason` field on instrument reference for manual flagging. |
| Stock splits / adjusted prices | Store raw prices only. Compute adjusted on the fly using split event data from `TaiwanStockDividendResult`. |
| Rate limit contention (backfill vs refresh) | Daily refresh has priority (10 vs 0). Backfill fills remaining 600 req/hr budget. |
| Trading hours data gap | UI shows "today's data not yet available, refreshes at 17:30" between market close and FinMind update. |
| Demo users | Fixture/seed data only. No real FinMind API calls. Excluded from `getAllMonitoredTickers()`. |
| User deselects a monitored symbol | If open positions exist, keep refreshing. Monitored set = explicit selections UNION symbols with open positions. |
| Burst selection (user selects 150 symbols at once) | Queued processing. User notified via SSE on completion. No blocking wait. |
| Multi-user symbol overlap | `market_data.daily_bars` is shared. Daily refresh fetches the distinct union of monitored symbols across all users. |

---

## 9. Deferred Decisions

| Topic | Status | Notes |
|---|---|---|
| Ticker changes / corporate actions | Deferred to post-phase-1 | Add `status_reason` field for manual flagging |
| Auto-refresh for local dev | Manual `scp` for now | Scriptable via `npm run market-data:restore` |
| Cloud backup destination | TBD | Replicate QNAP backups to cloud for disk-failure resilience |
| Lazy/hybrid snapshot materialization | Schema-compatible migration path | Switch from Option B to C when user count warrants |
| Separate microservice extraction | Not needed for phase 1 | Extract ingestion to a separate service if scale demands it |
| Trailing correction audit | KZO-86 (needs refinement) | Current upsert blindly overwrites; no change detection |
| Redis-backed rate limiter | KZO-91 (needs refinement) | In-memory limiter resets on restart |
