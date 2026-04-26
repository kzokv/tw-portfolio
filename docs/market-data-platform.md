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

### Market-data-owned (`market_data` schema)

| Table | Owned data |
|---|---|
| `instruments` | TWSE instrument reference metadata (all ~3,071 unique tickers) |
| `daily_bars` | Raw OHLCV daily bars (not adjusted) |
| `dividend_events` | Dividend event reference (ex-date, pay-date, amount-per-unit, source) |

### Key boundary

- **Transaction execution price** is ledger-owned, not reconstructed from historical bars.
- **Dividend events** (reference data from providers) live in `market_data`. Dividend **postings** (accounting: how much the user received, deductions) live in `public`. The ledger references the market data event via FK: `public.dividend_ledger_entries.dividend_event_id -> market_data.dividend_events.id`.
- **Adjusted prices are not stored.** Raw prices are stored in `market_data.daily_bars`. Adjusted prices are computed on the fly using split event data from FinMind (`TaiwanStockDividendResult`). This halves API budget and eliminates retroactive adjustment staleness.

---

## 3. Ingestion Model

### Provider

- **FinMind** is the sole provider for phase 1.
- Datasets: `TaiwanStockPrice` (daily OHLCV, since 1994), `TaiwanStockDividend` (since 2005), `TaiwanStockInfo` (instrument metadata), `TaiwanStockDelisting` (delisted tickers).
- Rate limit: 600 requests/hour with authentication token.
- One request returns a symbol's full date range (no pagination needed).

### Demand-driven backfill

Historical bars are **not** backfilled for all ~3,071 TWSE symbols. Backfill is triggered only for symbols users care about:

1. **Instrument reference sync** (daily cron) populates `market_data.instruments` with metadata — this powers the symbol selection UI.
2. **Users configure monitored symbols** in the settings page, selecting from the full TWSE instrument list.
3. **Symbols with open positions** are auto-included in the monitored set, even if deselected from the watchlist.
4. When a new symbol enters the monitored set (user selection or first trade), an **async backfill job** is enqueued.
5. The user is **notified via SSE** when backfill completes. No waiting required — the user saves settings and the system handles it in the background.

### Backfill status

Per-symbol tracking: `pending -> backfilling -> ready -> failed`.

Partial success is kept — if 45/50 symbols succeed and 5 fail, the 45 are marked `ready` and the 5 are retried independently.

### Rate limit priority

Daily refresh has **priority** over backfill in the 600 req/hr budget. Fresh daily bars for existing symbols matter more than historical backfill for new ones. Implementation uses a priority queue: daily refresh jobs at priority 10, backfill at priority 0.

### Daily refresh scope

The daily refresh job fetches new bars for the **distinct union of monitored symbols across all users** — not per-user. `market_data.daily_bars` is shared, not user-scoped.

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

### Portfolio snapshot materialization (Option B)

Value-over-time and valuation-by-date queries read from **materialized `daily_portfolio_snapshots`**, not computed on the fly.

- A post-ingest job runs after daily bars land (Job 3 in the ingest pipeline).
- For each user/account, it reconstructs positions at that date, multiplies by close price, and stores the snapshot row.
- Phase 1 (single/few users): trivial compute cost.
- **Migration to lazy/hybrid (Option C) is schema-compatible** — the snapshot table is identical regardless of write strategy. When user count warrants it, switch to compute-on-first-request without schema changes.

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
│  │              Fastify API  (twp-dev-api)                         │      │
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
│  │  twp-dev-postgres                            │                         │
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
│  │  twp-local-postgres  │                │
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
│  │  twp-dev-web (Next.js, port 3333)                                 │      │
│  │                                                                   │      │
│  │  |-- SSR server components (cookies via next/headers)             │      │
│  │  |-- proxy.ts -> forwards auth'd requests to API                  │      │
│  │  │   Header: x-authenticated-user-id: {userId}                    │      │
│  │  \-- app/api/* route handlers (JSON 401, not redirect)            │      │
│  └──────────┬────────────────────────────────────────────────────────┘      │
│             │ HTTP (internal)                                                │
│             ▼                                                                │
│  ┌────────────────────────────────────────────────────────────────────┐      │
│  │  twp-dev-api (Fastify, port 4000)                                 │      │
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
│  │  twp-dev-postgres (port 5432)                                     │      │
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
│  │ twp-local-postgres      │  │ Fastify API (dev mode) │     │
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
| **Dev** | `twp-dev-postgres` on QNAP | Daily ingest job (runs after 17:30 TST FinMind update) | **Yes** — sole writer (pre-prod) |
| **Local** | `twp-local-postgres` on Lume VM | Manual restore via `scp` from QNAP | No |
| **Production** | Not yet deployed | — | — |

### Environment matrix (post-launch)

| Environment | Postgres location | Market data source | Calls FinMind? |
|---|---|---|---|
| **Production** | `twp-prod-postgres` on QNAP | Daily ingest job (runs after 17:30 TST FinMind update) | **Yes** — sole writer |
| **Dev** | `twp-dev-postgres` on QNAP | Auto-restore from prod dump (QNAP shared filesystem, runs after ingest) | No |
| **Local** | `twp-local-postgres` on Lume VM | Manual restore via `scp` from QNAP | No |

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
docker exec twp-prod-postgres pg_dump -U $USER -n market_data --format=custom $DB \
  > /share/backups/market_data/market_data_latest.dump

docker exec -i twp-dev-postgres pg_restore -U $USER -n market_data --clean --if-exists -d $DB \
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

Both backups run after the daily bar ingest completes (post-17:30 TST). Pre-production, the source is `twp-dev-postgres`; post-launch, swap to `twp-prod-postgres`.

```bash
TIMESTAMP=$(date +%Y%m%d_%H%M)
PG_CONTAINER=twp-dev-postgres  # Change to twp-prod-postgres post-launch

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
