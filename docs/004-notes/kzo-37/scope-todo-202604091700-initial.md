---
slug: kzo-37
source: scope-grill
created: 2026-04-09
tickets: [KZO-37]
required_reading:
  - docs/004-notes/001-planning/kzo-33-dividend-lifecycle.md
  - .agents/skills/tw-market-bookkeeping/references/tw-market-rules.md
  - .agents/skills/tw-market-bookkeeping/references/tw-bookkeeping-examples.md
  - apps/web/tests/e2e/AGENTS.md
  - .claude/rules/replay-position-history-invariants.md
  - .claude/rules/react-useEventStream-preconnect-pattern.md
  - .claude/rules/nextjs-i18n-serialization.md
  - .claude/rules/playwright-fast-sse-assertions.md
  - .claude/rules/playwright-duplicate-testid-pattern.md
  - .claude/rules/e2e-aaa-guardrails.md
  - .claude/rules/full-test-suite.md
  - .claude/rules/service-error-pattern.md
  - .claude/rules/migration-strategy.md
  - .claude/rules/test-placement-persistence-backend.md
superseded_by: null
---

# Todo: KZO-37 — Lightweight dividend calendar and posting UI

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation. The complete decision rationale lives in this checklist; the lifecycle contract and TW market rules are the source of truth for semantic questions.

This list is the canonical implementation plan from the scope-grill session on 2026-04-09. Tick boxes (`- [x]`) as work completes; items left unchecked at PR time signal scope agreed but not delivered.

---

## Phase 0 — Foundations

### Domain constants and helpers

- [x] Create `libs/domain/src/dividend-deductions.ts` with constants and pure helpers:
  - [x] `NHI_RATE = 0.0211` — cited to `tw-market-rules.md` L108, effective 2026-03-11
  - [x] `NHI_THRESHOLD_TWD = 20_000` — cited to `tw-market-rules.md` L110
  - [x] `DEFAULT_PAR_VALUE_TWD = 10` — TWSE convention; FinMind does not expose par value (verified against `https://finmind.github.io/llms-full.txt`)
  - [x] `SOURCE_LINE_RECONCILIATION_TOLERANCE_TWD = 1`
  - [x] `prefillNhiPremium(event, eligibleQty, instrumentType)` — returns `null` for ETFs, `null` for non-TWD, `null` for base < threshold; returns `{premiumBase, premiumAmount}` otherwise
  - [x] `validateSourceLineReconciliation(sourceLines, gross)` — uses tolerance constant
  - [x] `prefillStockPremiumBase(eligibleQty, parValuePerShare?)` — defaults to `NT$10`
- [x] Add `libs/domain/test/dividend-deductions.test.ts`:
  - [x] cash ≥ NT$20k → premium prefilled
  - [x] cash < NT$20k → null
  - [x] non-TWD currency → null
  - [x] ETF instrumentType → null (skipped per C1)
  - [x] stock dividend with default par value
  - [x] source line sum exact = gross → ok
  - [x] source line sum within ±NT$1 → ok
  - [x] source line sum > tolerance → error

### New domain types

- [x] Add `DividendSourceLine` interface to `libs/shared-types/src/index.ts`: `{id, dividendLedgerEntryId, sourceBucket, amount, currencyCode, source, sourceReference?, note?, bookedAt}`
- [x] Add `DividendSourceBucket` enum (7 values): `DIVIDEND_INCOME, INTEREST_INCOME, SECURITIES_GAIN_INCOME, REVENUE_EQUALIZATION, CAPITAL_EQUALIZATION, CAPITAL_RETURN, OTHER`
- [x] Add `SourceCompositionStatus` enum: `provided | unknown_pending_disclosure`
- [x] Update `DividendLedgerEntry` in `apps/api/src/types/store.ts` with new fields: `version: number`, `sourceCompositionStatus: SourceCompositionStatus`
- [x] Update `AccountingFacts` to include `dividendSourceLines: DividendSourceLine[]`

### Database migration

- [x] Verify `db/migrations/025_dividend_enrichment_columns.sql` is the latest applied migration; if a newer one exists, bump our number
- [x] Create `db/migrations/026_dividend_source_lines.sql`:
  - [x] `CREATE TABLE dividend_source_lines (id TEXT PRIMARY KEY, dividend_ledger_entry_id TEXT NOT NULL REFERENCES dividend_ledger_entries(id) ON DELETE CASCADE, source_bucket TEXT NOT NULL CHECK (source_bucket IN ('DIVIDEND_INCOME','INTEREST_INCOME','SECURITIES_GAIN_INCOME','REVENUE_EQUALIZATION','CAPITAL_EQUALIZATION','CAPITAL_RETURN','OTHER')), amount NUMERIC(20,4) NOT NULL, currency_code TEXT NOT NULL CHECK (currency_code = 'TWD'), source TEXT NOT NULL, source_reference TEXT, note TEXT, booked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`
  - [x] `CREATE INDEX idx_dividend_source_lines_ledger_entry ON dividend_source_lines(dividend_ledger_entry_id, booked_at)`
  - [x] `ALTER TABLE dividend_ledger_entries ADD COLUMN version INTEGER NOT NULL DEFAULT 1` (verified `updated_at` does not exist on this table — see `baseline_current_schema.sql:277-296`)
  - [x] `ALTER TABLE dividend_ledger_entries ADD COLUMN source_composition_status TEXT NOT NULL DEFAULT 'unknown_pending_disclosure' CHECK (source_composition_status IN ('provided','unknown_pending_disclosure'))`
  - [x] Verify or add `idx_dividend_events_payment_date ON market_data.dividend_events(payment_date)` to support the new GET filter (check `baseline_current_schema.sql` first)
- [x] Per `.claude/rules/migration-strategy.md`: this is a brand-new migration file, never edit applied migrations in place

---

## Phase 1 — Persistence layer

### MemoryPersistence (`apps/api/src/persistence/memory.ts`)

- [x] Add `dividendSourceLines` storage
- [x] Apply `version` (default 1) and `sourceCompositionStatus` defaults to in-memory ledger entry shape
- [x] Implement `replaceDividendSourceLinesForLedger(ledgerEntryId, sourceLines)`
- [x] Implement `findDividendLedgerEntryById(id, userId)` for PATCH authorization
- [x] Implement `updateDividendReconciliationStatus(ledgerEntryId, userId, status, note?)`
- [x] Implement `updatePostedCashDividend(ledgerEntryId, userId, expectedVersion, ...)` — increments version, throws `OptimisticLockError` on mismatch

### PostgresPersistence (`apps/api/src/persistence/postgres.ts`)

- [x] Implement `replaceDividendSourceLinesForLedger` — atomic delete-then-insert inside the active transaction
- [x] Update `loadStore(userId)` to include source lines in `Store.accounting.facts.dividendSourceLines`
- [x] Update `savePostedDividend()` to atomically replace source lines + deductions + cash ledger entries together
- [x] Add `updatePostedCashDividend()`:
  - [x] `SELECT FOR UPDATE` on the ledger entry by id
  - [x] Check `expectedVersion === current_version` → 409 on mismatch
  - [x] Check `event_type = 'CASH'` (reject `STOCK` and `CASH_AND_STOCK` with 422)
  - [x] Replace ledger entry monetary fields, deductions, source lines, linked cash ledger entries atomically
  - [x] Increment version
- [x] Add `updateDividendReconciliationStatus()`:
  - [x] `SELECT FOR UPDATE` on the ledger entry
  - [x] Validate `posting_status = 'posted'` (else 409)
  - [x] Validate `note` non-empty when status = `'explained'`
  - [x] Update reconciliation status, persist note when provided
  - [x] Increment version
- [x] Add date-range query methods:
  - [x] `listDividendEventsByPaymentDate(userId, fromPaymentDate, toPaymentDate, limit)` — uses payment_date index
  - [x] `listDividendLedgerEntriesByPaymentDate(userId, accountId?, fromPaymentDate, toPaymentDate, limit)` — joins ledger entries to events; eager-loads deductions and source lines for the nested response shape

### Persistence interface (`apps/api/src/persistence/types.ts`)

- [x] Update interface signatures to match the new methods
- [x] Per `.claude/rules/test-placement-persistence-backend.md`, place uniqueness/constraint tests for source lines in **integration** (Postgres), not memory

---

## Phase 2 — Service layer

### `apps/api/src/services/dividends.ts`

- [x] Update `postDividend()` to accept `sourceLines: DividendSourceLineInput[]` and `sourceCompositionStatus`
- [x] Auto-fill single `DIVIDEND_INCOME` source line for stock-instrument cash dividends when sourceLines is empty (C2)
- [x] Validate source line reconciliation (when status='provided') via `validateSourceLineReconciliation` from libs/domain
- [x] Add `updatePostedCashDividend(store, userId, ledgerEntryId, expectedVersion, input)`:
  - [x] Reject STOCK / CASH_AND_STOCK with `routeError(422, 'stock_dividend_in_place_edit_unsupported', ...)` (C3)
  - [x] Reject expectedVersion mismatch with `routeError(409, 'dividend_version_conflict', ...)` (C9)
  - [x] Otherwise atomically replace ledger entry + deductions + source lines + cash ledger entries
  - [x] Emit SSE `dividend_updated` event after commit (C8)
- [x] Add `updateDividendReconciliationStatus(store, userId, ledgerEntryId, status, note?)`:
  - [x] Reject if `postingStatus !== 'posted'` with `routeError(409, 'reconciliation_requires_posted_status', ...)`
  - [x] Reject `status='explained' && !note` with `routeError(400, 'reconciliation_note_required', ...)`
  - [x] Reject note > 500 chars
  - [x] Update status, increment version
  - [x] Emit SSE `dividend_reconciliation_changed` event after commit
- [x] All errors via `routeError()` per `.claude/rules/service-error-pattern.md` — never plain `throw new Error(...)`

### Dashboard service (`apps/api/src/services/dashboard.ts`)

- [x] Verify `buildUpcomingDividends()` and `buildRecentDividends()` (lines 166-243) still compile and work — they don't read `version` or `sourceLines`, but the field additions to `DividendLedgerEntry` may need shim defaults
- [x] No semantic change to dashboard widget (Q21)

---

## Phase 3 — API routes

### `apps/api/src/routes/registerRoutes.ts`

- [x] Extend `dividendPostingSchema` (line 137-143):
  - [x] `sourceLines: z.array(dividendSourceLineSchema).max(20).default([])`
  - [x] `sourceCompositionStatus: z.enum(['provided','unknown_pending_disclosure']).default('unknown_pending_disclosure')`
  - [x] `dividendLedgerEntryId: z.string().optional()` — present for in-place edits
  - [x] `expectedVersion: z.number().int().positive().optional()` — required when `dividendLedgerEntryId` is present
- [x] Branch in `POST /portfolio/dividends/postings` handler:
  - [x] If `dividendLedgerEntryId && expectedVersion` → call `updatePostedCashDividend()`
  - [x] Else → call existing `postDividend()`
- [x] Add `PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation`:
  - [x] Body: `{status: z.enum(['matched','explained','resolved','open']), note: z.string().max(500).optional()}`
  - [x] Authorization: verify ledger entry belongs to authenticated user
  - [x] Returns updated `DividendLedgerEntry`
- [x] Extend `GET /dividend-events`:
  - [x] Query: `fromPaymentDate?, toPaymentDate?, limit=500`
  - [x] Backwards compatible: returns all when no filters (for existing dashboard fetch)
- [x] Extend `GET /portfolio/dividends/ledger`:
  - [x] Query: `fromPaymentDate?, toPaymentDate?, accountId?, limit=500`
  - [x] Response shape: `{ledgerEntries: [{...entry, deductions: [...], sourceLines: [...]}]}` (nested)

### SSE event types

- [x] Add new event types (in the appropriate SSE event union — see `apps/api/src/lib/sseEventBus.ts` or equivalent): `dividend_posted`, `dividend_updated`, `dividend_reconciliation_changed`
- [x] Wire emit calls inside `postDividend()`, `updatePostedCashDividend()`, `updateDividendReconciliationStatus()` (post-commit)
- [x] Per `.claude/rules/fastify-raw-streaming-cors.md`: SSE route already propagates CORS headers; no changes needed unless adding a new SSE endpoint

---

## Phase 4 — Web app

### Drawer primitive

- [x] Add `@radix-ui/react-dialog` dependency to `apps/web/package.json` if not already present (verify with the existing UI primitives)
- [x] Create `apps/web/components/ui/Drawer.tsx`:
  - [x] Props: `open, onOpenChange, title, children, footer?, dirty?: boolean`
  - [x] Desktop: 480px right-slide
  - [x] Mobile: bottom sheet (full-width, 90vh max-height) via Tailwind `md:` breakpoint
  - [x] Sticky header (title + close button)
  - [x] Sticky footer slot
  - [x] Scrollable body
  - [x] Focus trap (radix handles)
  - [x] `role="dialog"`, `aria-modal="true"`, `aria-labelledby` to title
  - [x] Esc / backdrop click → confirm if `dirty`
- [x] Add `apps/web/components/ui/Drawer.test.tsx` for the primitive

### Calendar page

- [x] Create `apps/web/app/dividends/page.tsx` (server component):
  - [x] Fetch initial data via the new date-filtered GETs (current month default)
  - [x] Renders `<DividendCalendarClient />` with initial data and i18n dictionary
- [x] Create `apps/web/components/dividends/DividendCalendarClient.tsx`:
  - [x] Month picker (prev / next / current month label, jump-to-date later)
  - [x] Calls extended GETs on month change
  - [x] Uses `useEventStream` with `enabled: true` per `.claude/rules/react-useEventStream-preconnect-pattern.md` to receive `dividend_*` events; refresh affected row on event
  - [x] Lists rows with badge per visual mapping:
    - `Unposted` gray pill
    - `Pending review` amber pill
    - `Posted` green ✓
    - `Posted (variance)` green pill + ⓘ
    - `Resolved` green pill
  - [x] Inline `Mark matched` button on `Pending review` rows → calls PATCH endpoint
  - [x] `Post dividend` button on `Unposted` rows → opens drawer
  - [x] `Edit` button on posted CASH rows → opens drawer with current values
  - [x] STOCK / CASH_AND_STOCK posted rows: Edit button disabled with tooltip `dividends.action.stockEditDisabled`
  - [x] Empty state: `dividends.emptyState`
  - [x] NULL payment date pseudo-bucket rendered above current month as `dividends.paymentDateTbdSection`

### Posting form

- [x] Create `apps/web/components/dividends/DividendPostingForm.tsx` (drawer body):
  - [x] `Received cash` field — shown if `event.eventType !== 'STOCK'`
  - [x] `Received stock qty` field — shown if `event.eventType !== 'CASH'` AND not editing (first-time stock posting only)
  - [x] `Premium base` field — shown for stock; editable, prefilled `qty × NT$10`
  - [x] NHI section — shown only if not ETF AND TWD AND prefill produced a value:
    - [x] Premium base, premium amount, [×] removable
    - [x] At-source defaulted true and hidden (set on submit)
    - [x] Sticky on first form-open; loaded from stored deduction values on edit reopen (C10)
  - [x] "Additional deductions" repeating sub-form (8 deduction types)
  - [x] "Source composition" repeating sub-form (7 buckets):
    - [x] "I don't have the source breakdown yet" toggle (drives `sourceCompositionStatus`)
    - [x] When on: source line sub-form hidden, prior input cleared
    - [x] When off: live total + variance display vs gross; submit blocked if `|variance| > NT$1`
  - [x] Note textarea
  - [x] Submit handler:
    - [x] Edit mode: include `dividendLedgerEntryId` and `expectedVersion`
    - [x] On 409 conflict: show "This dividend was updated elsewhere — refresh to see latest" toast and don't reset
    - [x] On success: drawer closes, calendar row updates via SSE
- [x] Add `apps/web/features/dividends/hooks/useDividendPosting.ts` for the mutation logic

### Dashboard widget

- [x] Update `apps/web/components/dashboard/DividendsSection.tsx` to add a footer link `View all dividends →` routing to `/dividends`. Internal status semantics unchanged.

### Navigation

- [x] Update `apps/web/components/layout/AppShell.tsx`:
  - [x] Add `{id: "dividends", href: "/dividends", label: dict.navigation.dividendsLabel, description: dict.navigation.dividendsDescription}` to `navigationItems` (line 195)
  - [x] Extend `shellTitle`/`shellDescription` switch (lines 241-250) to include `"dividends"` section
  - [x] No changes needed to `quickSearchItems` — auto-picks up via `navigationItems.map(...)`

### i18n

Add to `apps/web/lib/i18n/types.ts` using template strings with `{placeholder}` tokens — never function values per `.claude/rules/nextjs-i18n-serialization.md`.

- [x] Navigation: `navigation.dividendsLabel`, `navigation.dividendsDescription`
- [x] Page chrome: `dividends.pageTitle`, `dividends.pageDescription`, `dividends.monthPickerLabel`, `dividends.previousMonth`, `dividends.nextMonth`, `dividends.currentMonth`, `dividends.emptyState`, `dividends.paymentDateTbdSection`
- [x] Badges: `dividends.badge.{unposted, pendingReview, posted, postedVariance, resolved}`
- [x] Actions: `dividends.action.{postDividend, markMatched, edit, cancel, save, stockEditDisabled}`
- [x] Form fields: `dividends.form.{receivedCash, receivedStockQty, premiumBase, note, unsavedChangesConfirm}`
- [x] NHI section: `dividends.form.nhi.{title, premiumBase, premiumAmount, remove}`
- [x] Deductions sub-form: `dividends.form.deductions.{title, addRow, type, amount, source, sourceReference, note, atSource, removeRow}`
- [x] 8 deduction type labels: `dividends.form.deductionType.{withholdingTax, nhiSupplementalPremium, brokerFee, bankFee, transferFee, cashInLieuAdjustment, roundingAdjustment, other}`
- [x] Source lines sub-form: `dividends.form.sourceLines.{title, unknownToggle, addRow, bucket, amount, varianceLabel}`
- [x] 7 source bucket labels: `dividends.form.sourceBucket.{dividendIncome, interestIncome, securitiesGainIncome, revenueEqualization, capitalEqualization, capitalReturn, other}`
- [x] Reconciliation: `dividends.form.reconciliation.{title, statusOpen, statusMatched, statusExplained, statusResolved, noteRequired, noteLabel}`
- [x] Errors: `dividends.form.error.{versionConflict, sourceLineMismatch, noteRequiredForExplained, stockEditNotAllowed}` (use `{variance}` placeholder for sourceLineMismatch)

---

## Phase 5 — Tests

Per `.claude/rules/full-test-suite.md`, ALL seven suites must pass.

**This repo uses the AAA (Arrange / Actions / Assert) framework for Playwright E2E and API HTTP tests.** New Playwright coverage must ship as typed POMs/endpoints + triplet assistants + thin spec files that consume the triplet — NOT as monolithic spec files with inline locators. ESLint enforces boundaries between the three triplet files (no cross-imports between Arrange/Actions/Assert). The `/aaa:add` skill scaffolds new triplets from existing precedents.

Vitest unit and integration tests are **not** part of the AAA framework (no triplet files required), but each test body should still follow arrange → act → assert as code-level organization for readability.

**Closest precedents to borrow from during scaffolding:**
- API HTTP: `libs/test-api/src/assistants/notifications/` (SSE-adjacent) and `libs/test-api/src/assistants/accounts/` (basic CRUD); spec naming: `apps/api/test/http/specs/accounts-aaa.http.spec.ts`
- E2E pages: `libs/test-e2e/src/pages/transactions/` (posting/edit flow), `libs/test-e2e/src/pages/dashboard/` (has the existing `DividendsSection` widget)
- E2E assistants: `libs/test-e2e/src/assistants/transactions/`, `libs/test-e2e/src/assistants/dashboard/`

### Unit — libs (vitest; arrange/act/assert in each test body)

- [x] `libs/domain/test/dividend-deductions.test.ts` — prefill rules + tolerance validation (covered in Phase 0 — cross-referenced here for completeness)

### Unit — web (vitest + React Testing Library; arrange/act/assert in each test body)

- [x] `apps/web/components/dividends/DividendPostingForm.test.tsx` — rendering, conditional cash/stock fields, validation, NHI prefill (initial + suppressed on reopen), source line toggle, variance display, version conflict handling
- [x] `apps/web/components/dividends/DividendCalendarClient.test.tsx` — 5-state badge mapping, inline mark-matched button gating, edit button disabled for stock rows, empty state, NULL payment date pseudo-bucket
- [x] `apps/web/components/ui/Drawer.test.tsx` — open/close, focus trap, dirty-confirm on Esc/backdrop, mobile breakpoint (bottom sheet) behavior, sticky header/footer
- [x] `apps/web/features/dividends/hooks/useDividendPosting.test.ts` — mutation handler logic, 409 conflict toast, SSE wait integration

### Integration — api (Postgres via `test:integration:full:host`; arrange/act/assert code structure)

Per `.claude/rules/test-placement-persistence-backend.md`, source-line uniqueness / in-place edit / reconciliation constraint tests must live here (not MemoryPersistence).

- [x] Extend `apps/api/test/integration/dividends.integration.test.ts`:
  - [x] Source line CRUD via `replaceDividendSourceLinesForLedger`
  - [x] In-place edit on cash dividend happy path (replaces deductions + source lines + linked cash ledger entries atomically)
  - [x] In-place edit blocked for `STOCK` / `CASH_AND_STOCK` → 422
  - [x] Optimistic concurrency: stale `expectedVersion` → 409
  - [x] Reconciliation PATCH: each transition + validation (note required for `explained`, rejected from `expected` with 409, etc.)
  - [x] Extended GETs: date filter returns subset; NULL payment dates included; limit honored
  - [x] Source line tolerance: exact = ok, ±NT$1 = ok, > tolerance = rejected
  - [x] `sourceCompositionStatus` auto-fill for stocks; ETFs default to `unknown_pending_disclosure`
  - [x] SSE emission: `dividend_posted`, `dividend_updated`, `dividend_reconciliation_changed` fire post-commit with expected payloads

### API HTTP — AAA framework (Playwright, `AUTH_MODE=oauth`)

Spec naming convention: `<feature>-aaa.http.spec.ts`. See existing precedents in `apps/api/test/http/specs/`.

#### 5.1 — Endpoint (thin REST wrapper)

- [x] Create `libs/test-api/src/endpoints/DividendsEndpoint.ts`:
  - [x] `getDividendEvents(fromPaymentDate?, toPaymentDate?, limit?)`
  - [x] `getDividendLedger(fromPaymentDate?, toPaymentDate?, accountId?, limit?)`
  - [x] `postDividendPosting(body)` — initial posting (branches on presence of `dividendLedgerEntryId`)
  - [x] `updatePostedDividend(body)` — in-place edit (carries `dividendLedgerEntryId` + `expectedVersion`)
  - [x] `patchReconciliation(dividendLedgerEntryId, body)` — reconciliation status change
- [x] Export from `libs/test-api/src/endpoints/index.ts`

#### 5.2 — Assistant triplet (`libs/test-api/src/assistants/dividends/`)

- [x] `DividendsApiArrange.ts`:
  - [x] Seed a test account with a known dividend event (CASH / STOCK / CASH_AND_STOCK) via existing test-only seed endpoints
  - [x] Seed an `expected` ledger entry for tests that start from the materialized expected state
  - [x] Seed a `posted` ledger entry + deductions + source lines for edit / reconciliation test cases
  - [x] Seed a `posted + open` (pending review) row for inline mark-matched tests
- [x] `DividendsApiActions.ts` — wraps `DividendsEndpoint` with test-friendly helpers:
  - [x] `postCashDividendWithNhi(...)`
  - [x] `postEtfDividendWithSourceLines(...)`
  - [x] `updatePostedCashDividend(...)` including expected-version branch
  - [x] `markReconciliationMatched(dividendLedgerEntryId)`
  - [x] `markReconciliationExplained(dividendLedgerEntryId, note)`
  - [x] `fetchLedgerForMonth(month)` for GET-filter assertions
- [x] `DividendsApiAssert.ts`:
  - [x] Response shape: nested `{ledgerEntries: [{...entry, deductions, sourceLines, version, sourceCompositionStatus}]}`
  - [x] Status + error-code assertions: `422 stock_dividend_in_place_edit_unsupported`, `409 dividend_version_conflict`, `409 reconciliation_requires_posted_status`, `400 reconciliation_note_required`
  - [x] Cross-field invariants: `sum(sourceLines) − gross` within NT$1 tolerance
  - [x] Version increment after update
- [x] `index.ts` barrel

#### 5.3 — Fixture wiring

- [x] Extend `libs/test-api/src/fixtures/shared.ts` (or add a dividends fixture) to expose the new assistants through the base test type
- [x] Update `libs/test-api/src/fixtures/base.ts` / mixins if a shared precondition is needed

#### 5.4 — Spec file (thin — consumes the triplet)

- [x] Create `apps/api/test/http/specs/dividends-aaa.http.spec.ts`:
  - [x] POST happy path — initial cash posting with NHI deduction and source lines
  - [x] POST happy path — initial ETF posting with `unknown_pending_disclosure` status (no source lines)
  - [x] POST happy path — initial stock dividend (verify zero-cost lot created via Assert)
  - [x] POST update path — 200 happy path for CASH
  - [x] POST update path — 422 for STOCK in-place edit rejection
  - [x] POST update path — 422 for CASH_AND_STOCK in-place edit rejection
  - [x] POST update path — 409 version conflict (stale `expectedVersion`)
  - [x] PATCH reconciliation — `matched` happy path
  - [x] PATCH reconciliation — `explained` requires non-empty note (400 without, 200 with)
  - [x] PATCH reconciliation — 409 when `postingStatus = expected`
  - [x] PATCH reconciliation — 401 unauthenticated
  - [x] PATCH reconciliation — 403 wrong-user
  - [x] PATCH reconciliation — `open` (reverse direction) always allowed
  - [x] GET extended — date-filtered subset returned
  - [x] GET extended — NULL payment dates included
  - [x] GET extended — limit honored
  - [x] GET extended — nested response shape asserts (deductions + source lines + version)
- [x] Each test reads as: `await arrange.seed…()` → `await actions.callEndpoint…()` → `await assert.expect…()`

### E2E standard — AAA framework (`apps/web/tests/e2e/specs/`, dev_bypass + memory)

#### 5.5 — POMs (`libs/test-e2e/src/pages/dividends/`)

- [x] `DividendCalendarPage.ts` — page wrapper for `/dividends`: month picker locators, row locators, badge selectors, inline action button selectors, payment-date-TBD pseudo-bucket
- [x] `DividendPostingDrawerComponent.ts` — drawer wrapper: sticky header (ticker + ex-div date + close), scrollable body, sticky footer (Cancel + Save), focus on open, dirty-confirm prompt
- [x] `DeductionSubFormComponent.ts` — repeating sub-form for the 8 deduction types: add row, remove row, type dropdown, amount, source/reference/note, at-source toggle
- [x] `SourceLineSubFormComponent.ts` — repeating sub-form for the 7 source buckets: "unknown disclosure" toggle, add row, bucket dropdown, amount, live total + variance display
- [x] `ReconciliationDropdownComponent.ts` — reconciliation status dropdown inside the drawer (Open / Matched / Explained / Resolved) with optional note field
- [x] `libs/test-e2e/src/pages/dividends/index.ts` barrel

#### 5.6 — Assistant triplet (`libs/test-e2e/src/assistants/dividends/`)

- [x] `DividendsArrange.ts`:
  - [x] Seed helpers (via test-only API endpoints or test-framework hooks): `expected` dividend row, `posted + open` row, `posted + matched` row, STOCK / CASH_AND_STOCK variants
  - [x] Navigate to the calendar page at a specified month (`visitCalendarAt(month)`)
- [x] `DividendsActions.ts`:
  - [x] `openPostingDrawerForExpectedRow(rowLocator)` — clicks `Post dividend`
  - [x] `openEditDrawerForPostedRow(rowLocator)` — clicks `Edit`
  - [x] `fillCashPostingForm({receivedCash, nhiAmount?, additionalDeductions?, sourceLines?, note?})`
  - [x] `fillStockPostingForm({receivedStockQty, premiumBase, ...})`
  - [x] `toggleUnknownSourceDisclosure()`
  - [x] `submitPostingForm()` — handles the SSE wait for `dividend_posted` / `dividend_updated`
  - [x] `clickMarkMatchedInline(rowLocator)` — fires inline action + waits for SSE
  - [x] `changeReconciliationStatus(rowLocator, newStatus, note?)` via drawer
  - [x] `changeMonth(direction)` — prev / next / jump-to-date
- [x] `DividendsAssert.ts`:
  - [x] 5-state badge assertions (Unposted / Pending review / Posted / Posted variance / Resolved)
  - [x] Row value assertions (received cash, NHI amount, net)
  - [x] Form validation message assertions (`dividends.form.error.versionConflict`, `sourceLineMismatch`, `noteRequiredForExplained`, `stockEditNotAllowed`)
  - [x] Drawer state assertions (open, closed, dirty-confirm prompt)
  - [x] Month bucket assertions (current month rows, payment-date-TBD pseudo-bucket present/absent)
  - [x] SSE-driven update assertions — use multi-state regex per `.claude/rules/playwright-fast-sse-assertions.md`; never assert exact SSE event ID values
  - [x] `.first()` selectors where needed per `.claude/rules/playwright-duplicate-testid-pattern.md` if `mutation-status` testid is reused
- [x] `libs/test-e2e/src/assistants/dividends/index.ts` barrel

#### 5.7 — Fixture wiring

- [x] Extend `libs/test-e2e/src/fixtures/appPages.ts` (and/or the relevant base fixture) to expose `dividendCalendarPage` and the `DividendsArrange` / `DividendsActions` / `DividendsAssert` assistants through the base test type
- [x] Verify `authPages.ts` / `oauthPages.ts` pick up the new page for route-protection tests

#### 5.8 — Spec file (thin — consumes the triplet)

- [x] Create `apps/web/tests/e2e/specs/dividend-calendar.spec.ts`:
  - [x] Page loads with current month rows rendered
  - [x] Cash dividend posting flow: open drawer → fill form → submit → row transitions to `Pending review`
  - [x] Inline `Mark matched` changes `Pending review` row to `Posted` (green ✓)
  - [x] Edit posted cash dividend updates values in place; version increments; row re-renders
  - [x] Stock dividend Edit button is disabled with `dividends.action.stockEditDisabled` tooltip
  - [x] Source line "unknown disclosure" toggle hides the sub-form and allows submit
  - [x] Source-line variance > NT$1 shows error message and blocks submit
  - [x] Version conflict (simulate stale state via a second client) shows conflict toast
  - [x] Payment-date-TBD pseudo-bucket renders above current month when TBD rows exist
  - [x] Each spec reads as: `await arrange.seedXxx()` → `await actions.doYyy()` → `await assert.expectZzz()`

### E2E oauth — AAA framework (`apps/web/tests/e2e/specs-oauth/`)

Reuses the same POMs, assistants, and fixtures. Only adds new specs for OAuth-specific route-protection flows.

- [x] Create `apps/web/tests/e2e/specs-oauth/dividend-calendar-auth.spec.ts`:
  - [x] Unauthenticated visit to `/dividends` redirects to `/login` (reuse existing `SessionArrange`)
  - [x] Authenticated user can access page after OAuth flow (reuse `SessionActions` + `DividendsAssert.expectCalendarLoaded()`)

### Lint and typecheck

- [x] `npx eslint .` clean (root) — includes the AAA ESLint plugin checks that enforce triplet boundaries (no cross-imports between Arrange / Actions / Assert)
- [x] `npm run typecheck` clean (root)

### Scaffolding tip

Use the `/aaa:add` skill to scaffold new POMs, endpoints, and assistant triplets. It detects the target layer, generates the boilerplate, and wires fixtures — much less error-prone than hand-writing from the precedent files. If `/aaa:add` reports the framework is missing, `/aaa:init` establishes it (though the framework should already exist per the project memory).

---

## Phase 6 — Cross-ticket coordination and docs

- [x] Update `docs/004-notes/001-planning/kzo-33-dividend-lifecycle.md`:
  - [x] Add a "Phase 1 Implementation Note" banner near the top
  - [x] Add a footnote at the start of §4 "Adjust Or Correct The Posting" pointing to the banner
- [ ] Update KZO-31 Linear ticket description with the PATCH endpoint carve-out note
- [ ] Create follow-up Linear ticket "ETF distribution source-aware tax & NHI projection" linked as related to KZO-37
- [ ] Update KZO-37 Linear ticket description with the `## Locked Scope` section
- [ ] Add session summary comment on KZO-37

(Items 1-5 in this phase are scheduled to run during scope-lock — see Linear write-back at the end of the scope-grill session.)

---

## Phase 7 — Verification (full test suite)

Run all seven suites per `.claude/rules/full-test-suite.md`:

- [x] `npx eslint .` (root)
- [x] `npm run typecheck` (root)
- [x] `npm run test --prefix apps/web` (web unit)
- [x] `npm run test:integration:full:host` (api integration, run from repo root)
- [x] `npm run test:e2e:bypass:mem --prefix apps/web` (standard E2E)
- [x] `npm run test:e2e:oauth:mem --prefix apps/web` (OAuth E2E)
- [x] `npm run test:http --prefix apps/api` (api HTTP)

---

## Open items

None — all questions resolved in Phase 1 and the ultrathink review.

---

## Key implementation decisions (one-liners for quick orientation)

- In-place edit only for CASH events; STOCK / CASH_AND_STOCK are write-only (KZO-114 Phase 1 precedent bounded to safe cases)
- Mapping B status with PATCH endpoint bundled here; KZO-31 generalizes to trades and cash ledger entries later
- Source lines structured (7 buckets) with `unknown_pending_disclosure` mode for users without issuer disclosure
- ETFs skip NHI prefill entirely (semantic correctness — prefill from gross is wrong for source-composed distributions)
- Drawer pattern via `radix-ui/react-dialog` — first complex form drawer in the codebase, sets precedent for KZO-28 and KZO-31
- Optimistic concurrency via new `version` column (`updated_at` does not exist on `dividend_ledger_entries`, verified)
- All NHI / par / tolerance constants in `libs/domain/src/dividend-deductions.ts` cited to `tw-market-rules.md` effective date 2026-03-11

---

## References

- Linear ticket: KZO-37
- Lifecycle contract: `docs/004-notes/001-planning/kzo-33-dividend-lifecycle.md` (with Phase 1 footnote added by this ticket)
- TW market rules: `.agents/skills/tw-market-bookkeeping/references/tw-market-rules.md` (effective 2026-03-11)
- TW bookkeeping examples: `.agents/skills/tw-market-bookkeeping/references/tw-bookkeeping-examples.md`
- Related tickets: KZO-31 (reconciliation status, generalized after KZO-37 lands), KZO-32 (reconciliation queue UI), KZO-28 (cash ledger), KZO-114 (Phase 1 mutability precedent), KZO-33 (lifecycle contract — now footnoted)
- Follow-up ticket: created during Phase 3 of this session — "ETF distribution source-aware tax & NHI projection"
