---
slug: kzo-123
source: scope-grill
created: 2026-03-29
tickets: [KZO-123]
required_reading: []
superseded_by: null
---

# Todo: KZO-123 — User Monitored Symbols Join Table and Settings UI

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read the KZO-122 ADR at `docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md` (Section 3: demand-driven backfill) for architectural context.

## Implementation Steps

### Database

- [ ] Create migration `019_user_monitored_symbols.sql` in `db/migrations/`
  - Table in `public` schema: `user_monitored_symbols(user_id TEXT, ticker TEXT, added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
  - Primary key: `(user_id, ticker)`
  - FK: `user_id REFERENCES users(id) ON DELETE CASCADE`
  - FK: `ticker REFERENCES market_data.instruments(ticker)`
  - Index on `user_id` for fast lookup

### API — Fastify Routes

- [ ] `GET /api/instruments` — catalog endpoint
  - Authed via `resolveUserId`
  - Query params: `search` (filters by ticker + name), `type` (filters by instrument_type: STOCK/ETF/BOND_ETF)
  - Returns: `{ instruments: InstrumentRef[] }` from `market_data.instruments`

- [ ] `GET /api/monitored-symbols` — monitored set endpoint
  - Authed via `resolveUserId`
  - Returns query-time union: `user_monitored_symbols UNION DISTINCT lots.ticker (via accounts, where open_quantity > 0)`
  - Each entry includes: `{ ticker, source: 'manual' | 'position', name, instrumentType, barsBackfillStatus }` — nullable metadata for position-derived symbols without instrument data
  - Source is `'position'` if from lots only, `'manual'` if from join table only, `'manual'` if in both (manual takes precedence in display)

- [ ] `PUT /api/monitored-symbols` — bulk replace manual selections
  - Authed via `resolveUserId`
  - Body: `{ tickers: string[] }`
  - Deletes all existing `user_monitored_symbols` rows for the user, inserts new set
  - Server diffs incoming against the **full monitored set** (union, not just join table) to identify genuinely new symbols
  - TODO comment: `// KZO-126: enqueue backfill for newTickers. Must check users.is_demo before enqueuing — demo users get no FinMind calls.`

### Persistence Layer

- [ ] Add `user_monitored_symbols` persistence methods
  - `getManualSelections(userId)` — rows from join table
  - `getMonitoredSet(userId)` — the full union query (manual + position-derived), with LEFT JOIN to instruments for metadata + backfill status
  - `replaceManualSelections(userId, tickers[])` — atomic delete + insert within transaction

### TypeScript Types

- [ ] Add domain types for monitored symbols
  - `MonitoredSymbol: { ticker, source: 'manual' | 'position', name: string | null, instrumentType: string | null, barsBackfillStatus: string | null }`
  - Request/response types for the three endpoints

### Web — Settings Drawer

- [ ] Add `symbols` tab to `SettingsTab` type and drawer navigation
  - Extends existing `"profile" | "general" | "fees"` with `"symbols"`

- [ ] Symbols tab content — typeahead filter
  - Search input that filters instruments by ticker and company name (client-side filter over fetched catalog)
  - Two sections:
    - **"Auto-included from positions"** — position-derived symbols, locked/non-deselectable, visual lock indicator
    - **"Your selections"** — manual selections with checkboxes, add/remove
  - "Browse full catalog" button to open full-screen sheet

- [ ] Full catalog sheet — Dialog content transition to full-screen mode
  - NOT a nested overlay or route navigation — same Radix Dialog, expanded content
  - Shares selection state with drawer tab (same React tree, live sync)
  - Search by ticker and company name
  - Filter by instrument type (STOCK / ETF / BOND_ETF)
  - Responsive layout, polished UI, easy to scan
  - Clear visual distinction: selected vs unselected, position-locked symbols
  - Back/close returns to drawer tab with selections preserved

- [ ] Save flow
  - Single "Save" action from either view calls `PUT /api/monitored-symbols`
  - Consistent with existing per-section save pattern in settings drawer
  - Batch save — not per-toggle

### Demo Users

- [ ] No restrictions — demo users have full access to the symbols tab and full catalog sheet
  - Selections persist in `user_monitored_symbols` and expire with the demo account (`ON DELETE CASCADE`)

## Scope Boundary — Explicitly Out of Scope

- Job queue infrastructure, backfill worker, retry policy (KZO-126)
- SSE notification on backfill completion (KZO-126)
- `is_demo` guard on backfill enqueue (KZO-126)
- `lots.ticker` FK to `instruments.ticker` (separate data quality ticket)
- FinMind ingestion / instrument catalog sync
- i18n copy decisions ("Symbol" vs "Ticker")

## Implementation Notes

- **Nuance 1 — KZO-126 hook diff target:** The TODO in the PUT handler must diff against the full monitored set (union), not just the join table. A symbol already position-derived should not be flagged as "new" when manually added.
- **Nuance 2 — Dialog transition:** The full catalog sheet is implemented as the same Radix Dialog in expanded mode (content transition). Do not nest overlays — avoids focus trap and scroll lock conflicts.
- **Nuance 3 — Demo backfill guard:** The TODO comment must note that KZO-126 needs to check `users.is_demo` before enqueuing backfill.
- **Nuance 4 — Fastify routes:** All three endpoints are Fastify routes on the API server, not Next.js API route handlers. Web app consumes via proxy or direct fetch.

## References

- KZO-122 ADR: `docs/004-notes/005-market-data/adr-202603251800-historical-data-store-topology.md`
- KZO-82 migration: `db/migrations/018_market_data_schema.sql`
- KZO-126: Backfill job queue infrastructure (created during this scope session)
- Settings drawer: `apps/web/features/settings/`
- SSE infrastructure: `apps/api/src/events/buffered.ts`, `apps/api/src/routes/sseRoute.ts`
- Existing instruments types: KZO-82 step 04 domain types (`InstrumentRef`, etc.)
