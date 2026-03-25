---
step: 3 of 5
commit_name: "2: Create market_data schema and migrate tables"
depends_on: 02-frontend-glossary-rename.md
ticket: KZO-82
---

# Step 03 — Create `market_data` schema and migrate tables

**Depends on:** Step 02 (column names must already be `ticker` and `source` before schema migration)

## 3.1 — SQL migration `018_market_data_schema.sql`

> **Entire migration wrapped in a single transaction.** If any step fails, everything rolls back including DROP TABLE. Postgres DDL is transactional.

### 3.1.1 — Schema and grants

- [ ] `CREATE SCHEMA IF NOT EXISTS market_data`
- [ ] `GRANT USAGE ON SCHEMA market_data TO current_user` (defensive for future role separation)

### 3.1.2 — Create `market_data.instruments`

- [ ] Table DDL:
  ```sql
  CREATE TABLE market_data.instruments (
    ticker TEXT PRIMARY KEY,
    instrument_type TEXT NOT NULL CHECK (instrument_type IN ('STOCK', 'ETF', 'BOND_ETF')),
    market_code TEXT NOT NULL DEFAULT 'TW' CHECK (market_code ~ '^[A-Z]{2,10}$'),
    name TEXT,
    is_provisional BOOLEAN NOT NULL DEFAULT FALSE,
    listed_date DATE,
    delisted_at TIMESTAMP,
    status_reason TEXT,
    bars_backfill_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (bars_backfill_status IN ('pending', 'backfilling', 'ready', 'failed')),
    last_synced_at TIMESTAMP,
    verification_status TEXT NOT NULL DEFAULT 'unverified'
      CHECK (verification_status IN ('unverified', 'verified', 'mismatch')),
    verification_note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  ```
- [ ] Indexes:
  ```sql
  CREATE INDEX idx_instruments_market_code_ticker
    ON market_data.instruments(market_code, ticker);
  CREATE INDEX idx_instruments_backfill_pending
    ON market_data.instruments(bars_backfill_status)
    WHERE bars_backfill_status != 'ready';
  ```

### 3.1.3 — Migrate and drop `public.symbols`

- [ ] Migrate data:
  ```sql
  INSERT INTO market_data.instruments (
    ticker, instrument_type, market_code, is_provisional, last_synced_at,
    bars_backfill_status, verification_status, created_at, updated_at
  )
  SELECT ticker, instrument_type, market_code, is_provisional, last_synced_at,
    'pending', 'unverified', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM public.symbols
  ON CONFLICT (ticker) DO NOTHING;
  ```
- [ ] Drop old table:
  ```sql
  DROP INDEX IF EXISTS idx_symbols_market_code_ticker;
  DROP TABLE IF EXISTS public.symbols;
  ```

### 3.1.4 — Create `market_data.daily_bars`

- [ ] Table DDL:
  ```sql
  CREATE TABLE market_data.daily_bars (
    ticker TEXT NOT NULL,
    bar_date DATE NOT NULL,
    open NUMERIC(20, 4) NOT NULL,
    high NUMERIC(20, 4) NOT NULL,
    low NUMERIC(20, 4) NOT NULL,
    close NUMERIC(20, 4) NOT NULL,
    volume BIGINT NOT NULL,
    source TEXT NOT NULL DEFAULT 'finmind',
    ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ticker, bar_date)
  );
  ```
- [ ] Index:
  ```sql
  CREATE INDEX idx_daily_bars_ticker_date
    ON market_data.daily_bars(ticker, bar_date DESC);
  ```

### 3.1.5 — Create `market_data.dividend_events`

- [ ] Table DDL:
  ```sql
  CREATE TABLE market_data.dividend_events (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('CASH', 'STOCK', 'CASH_AND_STOCK')),
    ex_dividend_date DATE NOT NULL,
    payment_date DATE NOT NULL,
    cash_dividend_per_share NUMERIC(20, 6) NOT NULL DEFAULT 0
      CHECK (cash_dividend_per_share >= 0),
    stock_dividend_per_share NUMERIC(20, 6) NOT NULL DEFAULT 0
      CHECK (stock_dividend_per_share >= 0),
    cash_dividend_currency TEXT NOT NULL CHECK (cash_dividend_currency ~ '^[A-Z]{3}$'),
    source TEXT NOT NULL DEFAULT 'finmind',
    source_reference TEXT,
    ingested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (payment_date >= ex_dividend_date),
    CHECK (
      (event_type = 'CASH' AND cash_dividend_per_share > 0 AND stock_dividend_per_share = 0)
      OR (event_type = 'STOCK' AND cash_dividend_per_share = 0 AND stock_dividend_per_share > 0)
      OR (event_type = 'CASH_AND_STOCK' AND cash_dividend_per_share > 0 AND stock_dividend_per_share > 0)
    )
  );
  ```
- [ ] Index:
  ```sql
  CREATE INDEX idx_md_dividend_events_ticker_ex_date
    ON market_data.dividend_events(ticker, ex_dividend_date);
  ```

### 3.1.6 — Migrate `public.dividend_events` (CRITICAL ordering)

> **CRITICAL:** The new FK MUST exist before the old table is dropped. All steps within a single transaction.

- [ ] **Step A:** Insert data into `market_data.dividend_events` from `public.dividend_events`
- [ ] **Step B:** Add NEW FK:
  ```sql
  ALTER TABLE dividend_ledger_entries
    ADD CONSTRAINT fk_dle_md_dividend_event
    FOREIGN KEY (dividend_event_id) REFERENCES market_data.dividend_events(id);
  ```
- [ ] **Step C:** Drop OLD FK:
  ```sql
  ALTER TABLE dividend_ledger_entries
    DROP CONSTRAINT IF EXISTS dividend_ledger_entries_dividend_event_id_fkey;
  ```
- [ ] **Step D:** Drop old table and indexes:
  ```sql
  DROP INDEX IF EXISTS idx_dividend_events_ticker_ex_dividend_date;
  DROP INDEX IF EXISTS idx_dividend_events_payment_date;
  DROP INDEX IF EXISTS ux_dividend_events_ticker_source_reference;
  DROP TABLE IF EXISTS public.dividend_events;
  ```

## 3.2 — Update `baseline_current_schema.sql`

- [ ] Remove `public.symbols` table definition and its index
- [ ] Remove `public.dividend_events` table definition and all its indexes
- [ ] Update `dividend_ledger_entries` FK to reference `market_data.dividend_events(id)`
- [ ] Add complete `market_data` schema DDL (instruments, daily_bars, dividend_events) at end of file
- [ ] Verify no stale references to `public.symbols` or `public.dividend_events` remain

## 3.3 — Persistence layer updates

- [ ] `apps/api/src/persistence/postgres.ts`:
  - `FROM symbols` → `FROM market_data.instruments` (all SELECT queries)
  - `INSERT INTO symbols` → `INSERT INTO market_data.instruments` (upsert logic)
  - `FROM dividend_events` → `FROM market_data.dividend_events` (all SELECT queries)
  - `INSERT INTO dividend_events` → `INSERT INTO market_data.dividend_events` (upsert logic)
  - Preserve `ON CONFLICT` / upsert semantics (provisional-vs-synced merge)
  - `updated_at` — set `updated_at = NOW()` in UPSERT statements (application-level, no DB trigger)

## 3.4 — Integration test helper update

- [ ] `postgres-migrations.integration.test.ts` — update `resetPublicSchema()` → rename to `resetDatabase()`:
  ```ts
  async function resetDatabase(): Promise<void> {
    await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");
  }
  ```

## 3.5 — Verify (full suite + Playwright MCP)

- [ ] `npx eslint .` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run test --prefix apps/web` passes
- [ ] `npm run test:integration:full:host` passes
- [ ] `npm run test:e2e:bypass:mem --prefix apps/web` passes
- [ ] `npm run test:e2e:oauth:mem --prefix apps/web` passes
- [ ] **Playwright MCP — demo session:**
  - Navigate to dashboard → verify holdings load (data now from `market_data.instruments`)
  - View dividend section → verify dividend events display (now from `market_data.dividend_events`)
- [ ] **Playwright MCP — dev_bypass session:**
  - Add a new transaction → verify instrument resolution still works
  - Create a dividend event → verify it persists and displays
  - Verify existing dividend ledger entries still link correctly to events
