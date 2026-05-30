---
slug: kzo-86
source: scope-grill
created: 2026-04-02
tickets: [KZO-86]
required_reading: []
superseded_by: null
---

# Todo: KZO-86 — Manual Repair/Backfill Endpoint + UI

> **For agents starting a fresh session:** read the KZO-86 ticket description (Locked Scope section) and this file before starting implementation. Also read the AGENTS.md nearest to each file you touch.

## Implementation Steps

### API Layer

- [ ] Add `endDate` optional param to `fetchDataset()` in `finmindClient.ts` — pass as `end_date` in URLSearchParams when provided
- [ ] Update `FinMindProvider` interface methods: `fetchDailyBars(ticker, startDate?, endDate?)` and `fetchDividendEvents(ticker, startDate?, endDate?)`
- [ ] Update `finmindClient.mock.ts` to match new interface signatures
- [ ] Add `"repair"` to the `BackfillJobData.trigger` union type in `backfillWorker.ts`
- [ ] Add `endDate?: string` and `includeBars?: boolean` and `includeDividends?: boolean` to `BackfillJobData`
- [ ] Replace hardcoded `CALLS_PER_TICKER = 2` with dynamic cost computation based on `includeBars`/`includeDividends` flags, capped at `MAX_CALLS_PER_TICKER`
- [ ] Update backfill handler to pass `endDate` through to `finmind.fetchDailyBars()` and `finmind.fetchDividendEvents()`
- [ ] Update backfill handler: repair trigger skips `backfilling` status transition (like `daily_refresh`)
- [ ] Update backfill handler: repair trigger skips `bars_backfill_status` and `last_synced_at` updates on completion
- [ ] Update backfill handler: repair trigger conditionally skips bars fetch (when `includeBars: false`) or dividends fetch (when `includeDividends: false`)
- [ ] Add SSE event types: `repair_started`, `repair_complete`, `repair_failed` — publish to requesting user only
- [ ] Update backfill handler: repair trigger publishes repair-specific SSE events instead of backfill events

### Migration

- [ ] Add `last_repair_at TIMESTAMPTZ` nullable column to `market_data.instruments` table — check if `018_market_data_schema.sql` has been applied to any environment before deciding new file vs in-place edit
- [ ] Add `REPAIR_COOLDOWN_MINUTES` to env schema in `libs/config/src/env-schema.ts` (default: `60`)
- [ ] Add to `.env.example`

### Route — `POST /backfill/repair`

- [ ] Request validation: `tickers` array required, max 20 items, reject empty array
- [ ] Request validation: `includeBars` and `includeDividends` cannot both be `false`
- [ ] Request validation: `startDate` and `endDate` format (`YYYY-MM-DD`), reject if `startDate > endDate`
- [ ] Demo user exclusion: `if (isDemo) throw routeError(403, "demo_restricted", ...)`
- [ ] Queue availability check: `if (!app.boss) throw routeError(503, ...)`
- [ ] Per-ticker status gate: lookup each ticker in instrument catalog, reject `pending`/`backfilling`, accept `ready`/`failed`
- [ ] Per-ticker cooldown gate: check `last_repair_at` + `REPAIR_COOLDOWN_MINUTES`, reject if within cooldown (return remaining minutes in error)
- [ ] Enqueue one job per ticker: `{ ticker, userId, trigger: "repair", startDate, endDate, includeBars, includeDividends }` with `singletonKey: ticker` and `priority: 5`
- [ ] Update `last_repair_at` on successful job completion (in handler, not route)
- [ ] Response shape: `{ queued: string[], rejected: { ticker: string, reason: string }[] }` — partial success supported

### Shared Types

- [ ] Add `last_repair_at` to `InstrumentCatalogItemDto` and `MonitoredTickerDto` in `libs/shared-types`
- [ ] Add repair-related SSE event types to shared types

### Ticker Detail Page UI (`/tickers/[ticker]`)

- [ ] Fetch instrument metadata (backfill status, `last_repair_at`) — new API call or extend existing data fetch in `page.tsx`
- [ ] Add "Repair" button in header action area (next to "Record Transaction" button)
- [ ] Repair modal: date range pickers (startDate, endDate) + bars/dividends checkboxes
- [ ] Cooldown display: status badge showing "Last repaired: X ago" or "Repairing..." or cooldown remaining
- [ ] Grey out Repair button during cooldown with tooltip
- [ ] SSE integration: listen for `repair_started`, `repair_complete`, `repair_failed` — update badge + fire toast
- [ ] Toast on completion/failure using existing `StatusToast` pattern
- [ ] i18n: add repair-related strings to ticker history dictionary

### Monitored Tickers List UI (Settings Drawer)

- [ ] Add "Repair" mode toggle button to `MonitoredTickersSection`
- [ ] Selection mode: checkboxes switch from monitoring toggles to repair selection
- [ ] Visual differentiation: different checkbox style/color in repair selection mode
- [ ] Grey out `pending`/`backfilling` tickers with tooltip: "Backfill in progress"
- [ ] Grey out cooldown-active tickers with tooltip: "Available in X min"
- [ ] Position-locked tickers: show checkboxes in selection mode (repairable despite monitoring lock)
- [ ] Max 20 selection enforcement in UI
- [ ] "Cancel" exits selection mode, "Continue" opens repair modal
- [ ] Repair modal: Apply All / Per-Ticker mode toggle
  - Apply All: one set of options (date range + flags) for all selected tickers
  - Per-Ticker: each ticker row with own options, pre-filled with defaults
- [ ] Submit fires API call, exits selection mode
- [ ] SSE-driven status updates for repair progress
- [ ] i18n: add repair-related strings to settings dictionary

### E2E Tests

- [ ] **API HTTP tests** (`apps/api/test/http/specs/`): repair endpoint request/response contract
  - Happy path: single ticker, multiple tickers, bars-only, dividends-only, both
  - Validation: empty array, >20 tickers, both flags false, invalid dates, startDate > endDate
  - Status gate: reject pending/backfilling, accept ready/failed
  - Cooldown gate: reject within window, accept after expiry
  - Demo user: 403
- [ ] **Integration tests** (`apps/api/test/integration/`): handler behavior with real Postgres
  - Dynamic rate limit cost computation
  - Repair does not touch `bars_backfill_status` or `last_synced_at`
  - `last_repair_at` updated on completion
  - singletonKey dedup
  - SSE events: `repair_started`, `repair_complete`, `repair_failed`
- [ ] **E2E Playwright tests** (`apps/web/tests/e2e/specs/`): both UI surfaces
  - Ticker detail page: repair button, modal interaction, status badge, toast
  - Monitored list: selection mode, bulk repair modal (apply-all + per-ticker), cooldown grey-out
  - Pre-connect SSE pattern (`enabled: true`), multi-state regex assertions

## Open Items

- [ ] Follow-up: KZO-133 — System-level settings table & admin UI (UI-configurable cooldown replacing env var)

## References

- Linear ticket: [KZO-86](https://linear.app/kzokv/issue/KZO-86)
- Follow-up ticket: [KZO-133](https://linear.app/kzokv/issue/KZO-133)
- FinMind API samples: `data/finmind-api-samples/` (confirms `end_date` support)
- Existing backfill handler: `apps/api/src/services/market-data/backfillWorker.ts`
- Existing backfill route: `apps/api/src/routes/registerRoutes.ts` (lines 1573-1602)
- FinMind client: `apps/api/src/services/market-data/finmindClient.ts`
- Monitored tickers UI: `apps/web/features/settings/components/MonitoredTickersSection.tsx`
- Ticker detail page: `apps/web/app/tickers/[ticker]/TickerHistoryClient.tsx`
