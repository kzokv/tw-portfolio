---
slug: kzo-129
source: scope-grill
created: 2026-04-01
tickets: [KZO-129]
required_reading: []
superseded_by: null
---

# Todo: KZO-129 — Instrument Catalog Ticker Picker

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. Also read the existing components at `apps/web/components/portfolio/AddTransactionCard.tsx`, `apps/web/components/portfolio/EditableTransactionRow.tsx`, and the AAA framework at `libs/test-e2e/src/`.

## Context

Replace the native `<select>` ticker dropdown in the transaction form with a searchable combobox backed by the full instrument catalog (`GET /instruments/catalog`, ~3,071 items). The current `<select>` only shows instruments the user already holds (from dashboard overview). The combobox enables selection from the entire TWSE catalog, ensuring every traded ticker exists in `market_data.instruments` before transaction creation — making KZO-126's first-trade backfill reliable.

## Key Decisions

- **Client-side filter** (not server-side search) — preload full catalog on form mount, filter locally. ~300KB payload, instant filtering, no debounce/race-condition complexity.
- **Cap visible results at 20** — dropdown never shows more than 20 matches. User refines by typing.
- **Build from primitives** — `<input>` + `@radix-ui/react-popover` + custom keyboard/ARIA logic. No new dependencies.
- **Filter null instrumentType client-side** — ~200 ETNs/indices/depositary receipts excluded from picker.
- **Exclude delisted at API level** — unconditional `WHERE delisted_at IS NULL` in `listInstrumentsCatalog`. No existing frontend consumers, safe to change.
- **Ticker read-only on edit** — `EditableTransactionRow` cannot change ticker (would invalidate lots, backfill, fees).
- **Form starts empty** — no default ticker selection (unlike current `<select>` which auto-selects first option).
- **Open on focus** — dropdown shows top 20 immediately, no minimum character requirement.
- **Click-outside reverts** — partial text reverts to last valid selection (or empty).
- **Backspace clears naturally** — no X button, matches native input behavior.

## Implementation Steps

### API Layer
- [x] Add `WHERE delisted_at IS NULL` to `listInstrumentsCatalog` in `apps/api/src/persistence/postgres.ts`
- [x] Add equivalent `.filter(i => !i.delistedAt)` to `listInstrumentsCatalog` in `apps/api/src/persistence/memory.ts`
- [x] Seed `MemoryPersistence` with mock instruments on dev startup (use existing mock FinMind data: 2330, 2317, 0050, 00679B, etc.)

### Web — Component
- [x] Create `InstrumentCombobox` component at `apps/web/components/portfolio/InstrumentCombobox.tsx`
  - `<input>` with `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`
  - Plain positioned `<div>` for dropdown panel (simpler than Radix Popover, no new dependency)
  - `role="listbox"` dropdown with `role="option"` items
  - Keyboard: arrow up/down, enter to select, escape to close
  - Row layout: ticker (left, monospace) | name (middle) | type badge (right, muted)
  - Input display after selection: `{ticker} — {name}`
  - Cap visible results at 20, show match count hint
- [x] Create `useInstrumentCatalog` hook at `apps/web/features/portfolio/hooks/useInstrumentCatalog.ts`
  - Fetch `GET /instruments` via `getJson()` on mount
  - Filter out `instrumentType === null` from response
  - Expose: `catalog`, `isLoading`, `error`

### Web — Integration
- [x] Replace `<select>` in `AddTransactionCard.tsx` with `InstrumentCombobox`
  - Remove dependency on `symbolOptions` prop for ticker field
  - Add "ticker required" validation (form starts empty)
  - Wire `setField("ticker", selectedTicker)` on combobox selection
  - Update `normalizedTicker` / `selectedTicker` logic for empty initial state
- [x] Make ticker field read-only in `EditableTransactionRow.tsx`
  - Already plain text, not editable — no change needed. `tickerReadOnly` prop added to `RecordTransactionDialog` for the ticker detail page context.

### Web — i18n
- [x] Add combobox strings to transaction i18n dictionaries (string templates, no functions):
  - Placeholder: "Search by ticker or name..."
  - Empty catalog: "No instruments available. Run catalog sync first."
  - No matches: "No instruments match \"{query}\""
  - Match count: "{shown} of {total} matches"
  - Ticker required: "Choose a ticker before submitting the transaction."

### Tests — API Unit (vitest)
- [x] Test `listInstrumentsCatalog` excludes delisted instruments (both postgres and memory implementations)
- [x] Test `listInstrumentsCatalog` search still works with delisted filter applied

### Tests — API Integration (vitest, Postgres-backed)
- [x] Test catalog endpoint returns only active, non-delisted instruments
- [x] Test catalog search matches by ticker and name after delisted filter

### Tests — Web Unit (vitest)
- [x] Test `useInstrumentCatalog` hook filters null instrumentType from response
- [x] Test combobox filter logic: matches by ticker, matches by name, case-insensitive, caps at 20

### Tests — E2E AAA (Playwright)
- [x] Update `TransactionFormComponent` POM (`libs/test-e2e/src/pages/shared/TransactionFormComponent.ts`):
  - Replace `tickerSelect` element with combobox elements (input, dropdown panel, option items)
- [x] Update `TransactionsActions` / `TickerDetailActions`:
  - New methods: `typeInTickerSearch(query)`, `selectTickerOption(ticker)`
- [x] Update `TransactionsAssert` / `TickerDetailAssert`:
  - New assertions: `comboboxShowsOptions(count)`, `selectedTickerContains(text)`, `comboboxIsEmpty(message)`, `recordDialogTickerIsReadOnly()`
- [x] New AAA spec: empty catalog state — verify empty message when no instruments loaded
- [x] New AAA spec: combobox search by ticker ID — type "233", verify filtered results, select "2330", verify form state
- [x] New AAA spec: combobox search by name — type Chinese name, verify match
- [x] New AAA spec: ticker read-only on edit — open edit mode, verify ticker field is not editable
- [x] Update existing `transaction-mutations-aaa.spec.ts` and related specs to use new combobox actions

## Out of Scope
- No new npm dependencies
- No server-side search / debounce
- No changes to `POST /portfolio/transactions` validation
- No changes to `InstrumentCatalogItemDto` shape
- No `?active=true` opt-in param (unconditional delisted filter)

## References
- Linear ticket: [KZO-129](https://linear.app/kzokv/issue/KZO-129)
- Blocked by: KZO-83 (merged)
- Related: KZO-126 (first-trade backfill trigger)
- Existing endpoint: `GET /instruments/catalog` in `apps/api/src/routes/registerRoutes.ts:1502`
- Current form: `apps/web/components/portfolio/AddTransactionCard.tsx:105-118`
- AAA POM: `libs/test-e2e/src/pages/shared/TransactionFormComponent.ts`
