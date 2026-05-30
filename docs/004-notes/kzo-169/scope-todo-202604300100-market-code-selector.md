---
slug: kzo-169
source: scope-grill
created: 2026-04-30
tickets: [KZO-169]
required_reading:
  - docs/004-notes/kzo-169/scope-todo-202604300100-market-code-selector.md
  - docs/004-notes/kzo-169/mockup-202604300100-market-code-selector.png
  - docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md
  - docs/004-notes/kzo-179/scope-todo-202604272000-multi-account-creation.md
  - libs/shared-types/src/index.ts
  - apps/api/src/persistence/postgres.ts
  - apps/web/components/portfolio/AddTransactionCard.tsx
  - apps/web/components/portfolio/InstrumentCombobox.tsx
superseded_by: null
---

# Todo: KZO-169 — Transaction form: market_code selector + symbol disambiguation

> **For agents starting a fresh session:** read this file, the Linear ticket KZO-169 description (with the `## Locked Scope` section appended via this session), and all files in `required_reading` above. Companion mockup: `docs/004-notes/kzo-169/mockup-202604300100-market-code-selector.png`. Sibling children: KZO-184 (DIV/STOCK_DIV/SPLIT user-entry, deferred), KZO-185 (pgboss back-compat cleanup, follow-up).

## Completion note (2026-05-01)

KZO-169 implementation work is delivered through schema, persistence, API, settings, web UI, tests, and docs. Final review evidence is in `docs/004-notes/kzo-169/review-202605010230-iter1.md`.

The remaining unchecked items that are not delivered here are intentionally future-scoped or PR-lifecycle-only:

- KZO-184 DIV/STOCK_DIV/SPLIT user-entry remains deferred.
- KZO-185 pgboss back-compat removal remains a post-deploy queue-drain cleanup.
- The post-merge transition note is only applicable after merge.
- Commit/PR metadata checks are only applicable when a commit and PR are created.

## Context (one-paragraph framing)

KZO-167 landed `accounts.defaultCurrency` + `accountType`; KZO-179 landed multi-account creation; KZO-180 landed user-level reporting currency. KZO-169 is the form-side companion: the existing transaction form gains a `market_code` chip selector, autocomplete becomes market-aware, currency derives from `instrument.market_code`, and the account dropdown filters to currency-compatible accounts. The scope-grill on 2026-04-30 chose **Model A — composite PK `(ticker, market_code)` on `market_data.instruments`** and **bundle** (schema migration + persistence rewrites + UI in one PR). DIV/STOCK_DIV/SPLIT user-entry was deferred to KZO-184; pgboss back-compat removal to KZO-185.

## Decisions (locked via scope-grill 2026-04-30)

- **D1.** Composite PK `(ticker, market_code)` on `market_data.instruments`. Forward-only migration `044_kzo169_composite_market_pk.sql`. Existing TW rows backfilled implicitly by the `NOT NULL DEFAULT 'TW'` already present on `market_code`. Migration also adds `market_code` to PK / required column on `market_data.daily_bars`, `market_data.dividend_events`, and `monitored_tickers`.
- **D2.** Single-PR bundle: schema + persistence + UI + endpoint changes ship together. No further splitting. ~5–8x the as-written ticket size; expect Tier 3 (full team) execution.
- **D3.** Trade currency derives from `instrument.market_code` via `currencyFor()`. `POST /portfolio/transactions` and `POST /portfolio/transactions/estimate` body schemas require `marketCode`. Server validates `account.defaultCurrency === currencyFor(instrument.marketCode)` and rejects mismatches with `routeError(400, "currency_mismatch", "Trade currency {X} does not match account currency {Y}")`. Client-side filtering is UX; server is the safety net for stale state and bulk-import paths.
- **D4.** Transaction types covered: **BUY and SELL only**. DIV / STOCK_DIV / SPLIT user-entry deferred to **KZO-184**.
- **D5a.** Autocomplete response shape unchanged structurally — keep current `InstrumentCatalogItemDto`. Do NOT add `currency` (client derives via `currencyFor(marketCode)`).
- **D5b.** Display labels on the chip and disambiguation suffix use `MarketCode` literals (`TW`, `US`, `AU`, `All`). i18n the chip *labels* in zh-TW; data stays the codes.
- **D5c.** `/instruments` accepts `market_code: z.enum(["TW","US","AU","ALL"]).default("ALL")` query param; server-side filter when not `ALL`.
- **D5d.** ALL mode: every row shows `TICKER · MARKET` suffix; specific-market mode shows just `TICKER`.
- **D5e.** Combobox commit: form state and POST body carry both `ticker` AND `marketCode`.
- **D6.** Testability: `/__e2e/seed-instruments` for E2E (suite 6/7) + HTTP (suite 8); `PostgresPersistence` directly for integration (suite 5). No dependency on KZO-170 (US ingestion) or KZO-172 (AU ingestion) landing first.
- **D7a.** `monitored_tickers` adds `market_code TEXT NOT NULL DEFAULT 'TW'` + CHECK enum. PUT body shape changes from `{ tickers: [string] }` to `{ tickers: [{ ticker, marketCode }] }`. Update `apps/web/features/settings/services/monitoredTickersService.ts` and the settings UI.
- **D7b.** pgboss back-compat: handler accepts both old `{ ticker, userId }` and new `{ ticker, marketCode, userId }` shapes via Zod union; old shape defaults to `marketCode='TW'`. **Removed in follow-up KZO-185 after queue drain.**
- **D7c.** Forward-only migration. No down migration.
- **D8a.** Default chip state: derived from user's account currencies. TW for TW-only users (zero-regression). `All` for multi-currency users. `All` for empty-accounts edge case (unreachable in practice; safety fallback).
- **D8b.** Account dropdown auto-clear: when chip+ticker selection produces a definite trade currency, the dropdown auto-filters to matching-currency accounts. If currently-selected account becomes incompatible, clear it; submit disabled until re-selected.
- **D8c.** No-matching-account UX: inline error in the account-dropdown slot:
  > "No {currency} account available. [+ Create {currency} account]"
  Link opens KZO-179's create-account flow pre-populated with `defaultCurrency=XXX`. Account list auto-refetches on success; new account auto-selected.
- **D9a.** Edit mode: chip + ticker locked. Rename `tickerReadOnly` → `instrumentReadOnly` on `AddTransactionCard` and `RecordTransactionDialog`. PATCH `/portfolio/transactions/:id` continues to refuse market change as it would already (per existing currency invariants).
- **D9b.** Transaction history table display untouched in this ticket. Deferred to **KZO-175**.
- **D9c.** Edit dialog pre-populates from the trade event's stored `marketCode` (now NOT NULL after migration). `TransactionHistoryItemDto.marketCode` tightens from `string | null` to `string`.
- **D10.** Full schema migration scope:
  - **Tables modified**: `market_data.instruments` (PK rewrite), `market_data.daily_bars` (PK rewrite), `market_data.dividend_events` (`market_code` column + lookup updates), `monitored_tickers` (column add).
  - **Persistence APIs**: `getInstrument(ticker, marketCode)`, `listInstrumentsCatalog(search?, type?, marketCode?, userId?)`, `getDailyBars(ticker, marketCode, ...)`, `bulkInsertDailyBars(bars)` (tighten `marketCode` to required), `getDividendEvents(ticker, marketCode)`, `upsertInstruments(userId, defs)` (tighten), `getMonitoredSet(userId)` returns shape adds `marketCode`, `replaceManualSelections(userId, items)` accepts `{ ticker, marketCode }[]`.
  - **Joins**: `postgres.ts:6074, 6102` add `AND i.market_code = c.market_code` (or `m.market_code`).
  - **MemoryPersistence mirror**: every change above.

### Mitigations from gap check

- **G1 — Provider stamping audit.** Enumerate every `?? "TW"` and `DEFAULT 'TW'` in API code; convert to fail-loud (`throw routeError(...)`) where market_code is required input. Defaults stay only on the SQL `ADD COLUMN` step (for backfill of existing TW rows), then application-side defaults are removed.
- **G2 — `POST /portfolio/transactions/estimate`.** Body accepts `marketCode`; tradeCurrency derived from instrument, not fee profile.
- **G3 — Backfill `singletonKey`** changes from `body.ticker` to `${ticker}:${marketCode}`.
- **G4 — Existing trade-submission spec audit.** Implementer responsibility (per `implementer-qa-test-ownership.md`):
  ```bash
  grep -rn "/portfolio/transactions" apps/web/tests/e2e apps/api/test
  ```
  Add `marketCode: "TW"` to all existing fixtures.
- **NC1 — Lots/holdings projection key audit.** With one-currency-per-account invariant, `(accountId, ticker)` stays unambiguous; add market_code only on uniqueness violation. Audit during persistence-layer refactor.
- **NC2 — Test API framework.** Update `libs/test-api/src/endpoints/InstrumentsEndpoint.ts` and `TransactionsEndpoint.ts` for `marketCode`; re-register in `libs/test-api/src/config/mapper.ts` per `test-api-mapper-registration.md`.
- **NC3 — i18n strings (string-only per `nextjs-i18n-serialization.md`):**
  - Chip labels: `marketChipTW`, `marketChipUS`, `marketChipAU`, `marketChipAll`
  - No-account error: `noAccountForCurrency` ("No {currency} account available — ")
  - Create-account link: `createAccountLink` ("Create {currency} account")
  - Currency-mismatch error: `currencyMismatchError`
  - Disambiguation suffix is the raw `MarketCode` literal — no i18n needed
- **NC4 — Account creation flow integration.** Verify KZO-179 form supports prefill via URL param or modal-prop; add prefill if missing. Verify whether create flow is modal or full-page; if full-page, add a banner reminding the user to resume the trade entry on return.
- **NC5 — Brand-new user / 0-account edge case.** Chip default falls back to `All` when accounts list is empty (defensive only; auto-seed prevents this).
- **NC6 — Other `/instruments` consumers** verified: only `useInstrumentCatalog` (transaction form combobox) consumes `/instruments`. Plus `/monitored-tickers` consumed by `apps/web/features/settings/services/monitoredTickersService.ts` — body shape change from D7a.

## Out of scope (explicit)

- **KZO-184** — DIV / STOCK_DIV / SPLIT user-entry transaction types. Polymorphic form, new cash-ledger posting paths, reconciliation interaction. Run `/scope-grill` before implementation.
- **KZO-185** — pgboss back-compat removal follow-up cleanup PR. Merged ≥24h after KZO-169 production deploy and queue drain.
- **KZO-175** — Holdings + transactions table multi-market display. KZO-169 leaves the existing tables alone; data is non-null after migration so 175 has clean material.
- **KZO-170** (US ingestion) and **KZO-172** (AU ingestion) — ingestion of real US/AU instruments. KZO-169 ships the schema + UI; ingestion can land independently. E2E tests use `/__e2e/seed-instruments` to inject synthetic multi-market rows.
- **KZO-178** — CSV importer for IBKR Activity Statements. Reads our schema; no coordination needed beyond migration landing first.

## Acceptance criteria mapping

| Ticket AC | Where satisfied |
|---|---|
| Selecting AU filters autocomplete to ASX-only tickers | D5c (server-side `market_code` filter); E2E test (Phase 8) |
| Selecting All returns disambiguated rows for ambiguous tickers (e.g. BHP) | D5d, D5e; E2E seeds `BHP` on TW/US/AU and asserts disambiguation in listbox |
| Currency auto-locks based on (ticker, market) — no user override | D3, D5e; web unit test on form derivation logic |
| Account dropdown filters to matching-currency accounts | D8b; web unit test on filtered options + E2E |
| BUY trade for BHP · ASX from a TWD account → blocked with "no AUD account" error | D8c; E2E asserts inline error renders + create-account link href |
| Existing transaction autocomplete endpoint returns market-scoped results | D5c; HTTP test on `/instruments?market_code=US` |
| Currency mismatch on POST → 400 | D3; HTTP test asserts `routeError(400, "currency_mismatch", ...)` |

## Implementation Steps

### Phase 1 — Schema migration (`044_kzo169_composite_market_pk.sql`)

- [ ] Create `db/migrations/044_kzo169_composite_market_pk.sql`. Idempotent. Steps:
  1. `market_data.instruments` — drop existing PK on `ticker`; add composite PK `(ticker, market_code)`. Use `DO $$` guard pattern from migration 039.
  2. `market_data.daily_bars` — drop existing PK on `(ticker, bar_date)`; add `(ticker, market_code, bar_date)`. Add `market_code TEXT NOT NULL DEFAULT 'TW'` if not already present.
  3. `market_data.dividend_events` — add `market_code TEXT NOT NULL DEFAULT 'TW'` column + CHECK enum + index `(ticker, market_code)` for lookups.
  4. `monitored_tickers` — `ALTER TABLE monitored_tickers ADD COLUMN IF NOT EXISTS market_code TEXT NOT NULL DEFAULT 'TW'` + CHECK enum + update PK to `(user_id, ticker, market_code)`.
  5. No data backfill needed — `DEFAULT 'TW'` on `ADD COLUMN`; existing rows already have valid market_code = 'TW'.
- [ ] Extend `apps/api/test/integration/postgres-migrations.integration.test.ts` with assertions on the new PK shape and column constraints.

### Phase 2 — Persistence layer (Postgres + Memory mirror)

- [ ] Update `apps/api/src/persistence/postgres.ts`:
  - `getInstrument(ticker, marketCode)` — signature change.
  - `listInstrumentsCatalog(search?, type?, marketCode?, userId?)` — add `market_code` filter.
  - `getDailyBars(ticker, marketCode, ...)` — signature change.
  - `bulkInsertDailyBars(bars)` — tighten `marketCode` to required.
  - `getDividendEvents(ticker, marketCode)` — signature change.
  - `upsertInstruments(userId, defs)` — `marketCode` required.
  - `getMonitoredSet(userId)` — return shape adds `marketCode`.
  - `replaceManualSelections(userId, items)` — accept `{ ticker, marketCode }[]`.
  - JOIN updates at lines 6074, 6102: add `AND i.market_code = c.market_code` (or `m.market_code`).
  - All `?? "TW"` patterns (e.g. `postgres.ts:2088, 3330`) — convert to fail-loud `throw routeError(...)`.
- [ ] Mirror every change in `apps/api/src/persistence/memory.ts`.
- [ ] Update `apps/api/src/persistence/types.ts` interface signatures.

### Phase 3 — Routes & job payloads

- [ ] `GET /instruments` (`registerRoutes.ts:4113`) — add `market_code: z.enum(["TW","US","AU","ALL"]).default("ALL").optional()` to query schema. When not `ALL`, pass to `listInstrumentsCatalog`.
- [ ] `POST /portfolio/transactions` (`registerRoutes.ts:3080`) — extend body Zod with `marketCode: z.enum(["TW","US","AU"])`. Look up instrument by `(body.ticker, body.marketCode)`. Validate `account.defaultCurrency === currencyFor(marketCode)`; reject 400 `currency_mismatch`. Persist `trade_event.market_code` from body.
- [ ] `POST /portfolio/transactions/estimate` (`registerRoutes.ts:3160`) — extend body with `marketCode`; derive `tradeCurrency = currencyFor(marketCode)` instead of `profile.commissionCurrency`.
- [ ] `PUT /monitored-tickers` (`registerRoutes.ts:4134`) — body shape change to `{ tickers: [{ ticker, marketCode }] }`.
- [ ] Backfill job payload: extend `BackfillJobData` shape to `{ ticker, marketCode, userId }`. Update `singletonKey: "${ticker}:${marketCode}"` (line 3152).
- [ ] pgboss back-compat handler (`apps/api/src/services/market-data/backfillWorker.ts` — verify path):
  ```ts
  const jobPayload = z.union([
    z.object({ ticker: z.string(), userId: z.string() }),
    z.object({ ticker: z.string(), marketCode: z.enum(["TW","US","AU"]), userId: z.string() }),
  ]).transform((v) => ("marketCode" in v ? v : { ...v, marketCode: "TW" as const }));
  ```
  Add a TODO comment referencing **KZO-185**.

### Phase 4 — Shared types

- [ ] Tighten `TransactionHistoryItemDto.marketCode` from `string | null` to `string` (`libs/shared-types/src/index.ts:328`).
- [ ] Tighten `InstrumentDef.marketCode` from optional to required (`apps/api/src/types/store.ts:16`). Same for `BookedTradeEvent.marketCode` (line 31).
- [ ] Update `MonitoredTickerDto` to include `marketCode: string` (`libs/shared-types/src/index.ts:615`).
- [ ] Add transaction-input type that includes `marketCode` for the form payload (`apps/web/components/portfolio/types.ts`).
- [ ] Rebuild `@tw-portfolio/shared-types`. Per `shared-types-barrel-turbopack.md`: this is type tightening + struct changes, not new runtime exports. Should be safe but verify with E2E.

### Phase 5 — Web UI: form chip + autocomplete + currency derivation

- [ ] In `apps/web/components/portfolio/AddTransactionCard.tsx`:
  - Add chip-row component above the existing fields. Chips: `TW`, `US`, `AU`, `All`. Active state per design.
  - Default chip derived from `accountOptions[].defaultCurrency` set; TW/US/AU if all share one currency; `All` otherwise.
  - On chip change: pass selected `marketCode` (or `null` for All) to `InstrumentCombobox` and re-filter `accountOptions`.
  - Currency input becomes derived: `currencyFor(committedInstrument.marketCode)` once a ticker is committed; locked.
  - Account dropdown filters: only show accounts whose `defaultCurrency === derivedCurrency`. If empty AND a market is selected, render the inline-error block with `[+ Create {currency} account]` link.
  - Auto-clear `value.accountId` if the currently-selected account becomes incompatible.
  - Submit button stays disabled while: chip+ticker not committed, OR no compatible account selected.
- [ ] Rename `tickerReadOnly` prop to `instrumentReadOnly` on `AddTransactionCard` and `RecordTransactionDialog`. Update all call sites.
- [ ] In `apps/web/components/portfolio/InstrumentCombobox.tsx`:
  - Accept `marketCodeFilter` prop (`MarketCode | null` for All).
  - Pass through to `useInstrumentCatalog` so the catalog is fetched server-side filtered.
  - In ALL mode, render every row with the `TICKER · MARKET` suffix (or a market badge per the mockup). In specific-market mode, suppress the suffix.
  - Commit selection: emit both `ticker` AND `marketCode`. Update parent state shape.
- [ ] In `apps/web/features/portfolio/hooks/useInstrumentCatalog.ts`:
  - Accept `marketCode?: MarketCode | "ALL"` param; pass to `fetchTransactionInstrumentCatalog`.
  - Add useEffect dep on `marketCode` so refetch fires on chip change.
- [ ] In `apps/web/features/portfolio/services/portfolioService.ts`:
  - `fetchTransactionInstrumentCatalog(marketCode?: ...)` — append `?market_code=` query.
- [ ] Inline error component (account slot): match mockup state-3. Includes "Create {currency} account" link that opens KZO-179's flow with `defaultCurrency` prefilled (verify URL-param or modal-prop support; add if missing per NC4).
- [ ] On account creation success: refetch accounts; auto-select newly-created account; resume form interaction.

### Phase 6 — Web UI: monitored-tickers settings page

- [ ] In `apps/web/features/settings/services/monitoredTickersService.ts`:
  - GET return shape includes `marketCode`.
  - PUT body changes to `{ tickers: [{ ticker, marketCode }] }`.
- [ ] Settings UI for monitored tickers: render `TICKER · MARKET` per row; allow add by `(ticker, market_code)` pair.

### Phase 7 — i18n

- [ ] Add string-only entries to `apps/web/components/portfolio/i18n.ts` (or wherever transaction i18n lives):
  - `marketChipTW`, `marketChipUS`, `marketChipAU`, `marketChipAll`
  - `noAccountForCurrency` ("No {currency} account available — ")
  - `createAccountLink` ("Create {currency} account")
  - `currencyMismatchError`
- [ ] EN + zh-TW dictionaries.
- [ ] Validate `nextjs-i18n-serialization.md` compliance (no functions in dictionary; `{currency}` interpolation at call site).

### Phase 8 — Tests

- [ ] **Unit (suite 4 — `apps/api`)**:
  - Currency derivation helper edge cases.
  - Instrument lookup with `(ticker, marketCode)` composite key.
  - pgboss payload back-compat union shape.
  - Provider-stamping fail-loud helpers (formerly `?? "TW"`).
- [ ] **Integration (suite 5 — Postgres)**, per `integration-test-persistence-direct.md`:
  - `apps/api/test/integration/composite-market-pk.integration.test.ts`:
    - Migration applies idempotently; PK shape correct.
    - Insert two BHP rows on US + AU; both persist.
    - JOIN queries return correct row per `(ticker, market_code)`.
    - `monitored_tickers` accepts new shape.
- [ ] **HTTP (suite 8 — `apps/api`)**: `apps/api/test/http/specs/transaction-form-market-code-aaa.http.spec.ts`:
  - GET `/instruments?market_code=TW` returns only TW rows.
  - GET `/instruments?market_code=ALL` returns all rows.
  - POST `/portfolio/transactions` with `(ticker, marketCode)` succeeds.
  - POST with mismatched account currency → 400 `currency_mismatch`.
  - POST `/portfolio/transactions/estimate` with `marketCode` → currency from instrument.
  - Register endpoint+assistant in `libs/test-api/src/config/mapper.ts` per `test-api-mapper-registration.md`.
- [ ] **Web unit (suite 3 — `apps/web`)**:
  - `AddTransactionCard` chip default derivation.
  - Account-options filter logic.
  - Inline-error render conditions.
  - `InstrumentCombobox` ALL-mode display logic.
- [ ] **E2E (suite 6/7)**: `apps/web/tests/e2e/specs/transaction-form-market-code-aaa.spec.ts`:
  - Seed user with TWD + USD + AUD accounts; seed BHP on AU + US instruments via `/__e2e/seed-instruments`.
  - Verify chip default = `All` for multi-currency user.
  - Pick `AU` chip → autocomplete shows BHP-on-AU only.
  - Pick `All` chip → autocomplete shows both BHP rows with badges.
  - Pick BHP-on-US → currency input locks to USD; account dropdown filters to USD account.
  - Delete the USD account, retry → inline error with create-account link visible.
  - Per `e2e-shared-memory-bars-ticker-hygiene.md`: pick a ticker not currently used (verify with grep before lock — `BHP` should be safe; pre-check `AAPL`).
- [ ] **Existing test fixture audit (G4):**
  ```bash
  grep -rn "/portfolio/transactions" apps/web/tests/e2e apps/api/test
  ```
  Update each to send `marketCode: "TW"` for TW tickers. Implementer responsibility.

### Phase 9 — Docs & Linear write-back

- [ ] Update `## Locked Scope` on KZO-169 (done in this scope-grill session).
- [ ] After merge: append transition note `docs/004-notes/kzo-169/transition-{datetime}-market-code-selector.md` per `doc-management.md`.
- [ ] Update `docs/001-architecture/backend-db-api.md` with the composite-PK schema note. Cross-reference KZO-184 (DIV/STOCK_DIV/SPLIT) and KZO-185 (back-compat cleanup).
- [ ] Update `docs/market-data-platform.md` with the multi-market disambiguation flow.

### Phase 10 — Pre-PR / pre-push gates (reviewer checklist)

- [ ] Run `/code-reviewer` per `code-review-before-pr.md` and produce review doc at `docs/004-notes/kzo-169/review-{datetime}-iter1.md`.
- [ ] Verify reviewer-rule compliance:
  - `migration-strategy.md` — new file 044, no edits to earlier migrations, no DROP without full-repo grep.
  - `service-error-pattern.md` — `routeError(400, "currency_mismatch", ...)` pattern.
  - `interface-caller-verification.md` — grep all callers of changed persistence APIs.
  - `replay-position-history-invariants.md` — no replay function changes; explicit non-applicability noted.
  - `nextjs-i18n-serialization.md` — i18n dictionaries are string-only.
  - `commit-format.md` — `feat(api,db,web): KZO-169: ...` shape.
  - `pr-bound-docs-review-compliance.md` — PR description has `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback`.
  - `phased-ticket-scope-completeness.md` — config → render path verified end-to-end.
  - `shared-types-barrel-turbopack.md` — type tightening verified through E2E build.
  - `typed-transient-error-catch-audit.md` — verify back-compat handler doesn't silently swallow new typed errors.
- [ ] Run the canonical pre-push gate per `full-test-suite.md`:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```

## Open Items (carried forward to children tickets)

- **KZO-184** — DIV / STOCK_DIV / SPLIT user-entry transaction types. Substantial product feature; scope-grill before implementation.
- **KZO-185** — pgboss back-compat removal cleanup. Merge ≥24h after KZO-169 prod deploy.

## References

- Linear: KZO-169 (this ticket); KZO-184, KZO-185 (children); KZO-167, KZO-179, KZO-180 (backend prerequisites — done); KZO-170, KZO-172 (forward — US/AU ingestion); KZO-175 (forward — holdings table multi-market display); KZO-178 (forward — IBKR CSV importer).
- Mockup: `docs/004-notes/kzo-169/mockup-202604300100-market-code-selector.png` — three-state design (default TW, ALL-mode disambiguation, no-USD-account error).
- Companion docs: `docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md`, `docs/004-notes/kzo-179/scope-todo-202604272000-multi-account-creation.md`, `docs/market-data-platform.md`.
- Schema precedent: `db/migrations/039_kzo166_cash_ledger_fx_rate.sql` (`DO $$` constraint guard pattern).
