---
slug: kzo-167
source: scope-grill
created: 2026-04-27
tickets: [KZO-167]
required_reading:
  - docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md
  - docs/004-notes/kzo-166/scope-todo-202604262100-currency-wallet-wac.md
  - docs/market-data-platform.md
superseded_by: null
---

# Todo: KZO-167 — Account model: `default_currency` + `account_type` enum

> **For agents starting a fresh session:** read this file plus the Linear ticket KZO-167 description (the `## Locked Scope` section appended via this session) before starting implementation. Companion files for context: `db/migrations/038_kzo165_snapshot_multi_currency.sql`, `db/migrations/039_kzo166_cash_ledger_fx_rate.sql` (for the `DO $$` constraint guard precedent), `apps/api/src/types/store.ts` (the `Account` interface to remove), `libs/shared-types/src/index.ts` (the `AccountDto` to extend), `apps/api/src/services/accountingStore.ts` (`appendCashLedgerEntry`), `apps/api/src/services/portfolio.ts:120,282` (path 1 emission + helper), `apps/api/src/services/recompute.ts:84,105` (path 3 emission + helper duplicate), `apps/api/src/services/dividends.ts:610-655` (path 2 emission), `apps/api/src/services/replayPositionHistory.ts:161` (path 4 — explicitly skipped), `apps/api/src/routes/registerRoutes.ts:2479,2484` (existing `/accounts` endpoints), `apps/web/features/cash-ledger/components/CashLedgerClient.tsx` (display target). Rules: `migration-strategy.md`, `service-error-pattern.md`, `interface-caller-verification.md`, `replay-position-history-invariants.md`, `typed-transient-error-catch-audit.md`, `test-placement-persistence-backend.md`, `integration-test-persistence-direct.md`, `nextjs-i18n-serialization.md`, `commit-format.md`, `code-review-before-pr.md`, `full-test-suite.md`.

## Context (one-paragraph framing)

KZO-165 landed multi-currency snapshot schema; KZO-166 lit up the WAC engine and realized FX P&L. Both deferred the account-side schema (per-account default currency, account type) and the cash-entry currency invariant to KZO-167. The **as-written** ticket bundled schema additions, a service guardrail, an account-creation form (mockup #4), an admin accounts column, sharing-view changes, and a per-user reporting currency. The scope-grill on 2026-04-27 split aggressively: this ticket ships the schema + types + service guard + PATCH extension + a minimal display chip on `/cash-ledger`. Three sibling tickets (KZO-179, KZO-180, KZO-181) carry out the rest. Until those land, the new `default_currency` and `account_type` fields are mutable only via PATCH on the auto-seeded "Main" account, which is the conservative path that keeps KZO-167 small while unblocking KZO-170/171 (US/AU) and KZO-180 (reporting currency).

## Decisions (locked via scope-grill 2026-04-27)

- **D1.** Schema-only on the user-facing side. **No** account-creation form, **no** `POST /accounts`, **no** admin accounts page in this ticket. Multi-account creation UX splits to **KZO-179**.
- **D2.** Ship four observable surfaces: (a) schema additions, (b) service-layer cash-entry currency guard, (c) PATCH `/accounts/:id` extension to mutate `defaultCurrency` and `accountType`, (d) display chip on `/cash-ledger` rendering `name (TWD · Broker)` in account dropdown options + per-account summary chips. Pure schema + guard would be unobservable; D2 ensures end-to-end testability through real user-reachable paths.
- **D3.** New service module `apps/api/src/services/cashLedgerService.ts`. Exports a pure helper `assertCashEntryCurrencyMatchesAccount(entry, account)` and a wrapper `bookCashLedgerEntry(store, entry)` that looks up the account from `store.accounts`, runs the assertion, and delegates to `appendCashLedgerEntry`. Existing `appendCashLedgerEntry` stays exported as a documented test-only / internal backdoor for synthetic seeding. Per `interface-caller-verification.md`, grep all callers before refactor.
- **D4.** `account_type` is **metadata-only** in this ticket. Schema-level CHECK enum `('broker','bank','wallet')`. Same for `default_currency`: CHECK `('TWD','USD','AUD')`. **No runtime behavioral gating** — bank/wallet accounts can technically receive `TRADE_SETTLEMENT_*` entries through normal API paths today. Type semantics get locked by downstream tickets that have product reasons (e.g. KZO-168 FX_TRANSFER, KZO-170 US-market broker accounts).
- **D5.** Per-user reporting currency is **out of scope** — splits to **KZO-180** which lands the `user_preferences.reporting_currency` column **and** the dashboard / portfolio-summary FX-aware read consumers together. The previous "future column with no consumer" pattern is rejected. The KZO-166 scope-todo memo (`docs/004-notes/kzo-166/scope-todo-202604262100-currency-wallet-wac.md:38`) is patched in this PR to remove the contradictory "KZO-167 covers per-user reporting currency" claim.
- **D6.** Sharing-view currency display is **dropped from scope.** No surface exists today (`apps/web/components/sharing/SharingClient.tsx` and `apps/web/app/share/[token]/page.tsx` reference no account data). Revisit when account-scoped sharing becomes a thing — likely after KZO-179.
- **D7.** PATCH `/accounts/:id` change to `defaultCurrency` is **blocked** when the account has any `cash_ledger_entries` row OR any `trade_events` row. Throw `routeError(409, "currency_change_blocked", "Cannot change default currency: account has existing cash entries or trade events. Open a new account or contact support.")`. `accountType` changes are unguarded (per D4). The lockdown logic lives in `cashLedgerService.ts` (or sibling `accountService.ts` — implementer judgment) so it composes with the cash-entry guard cleanly.
- **D8.** The cash-entry currency guard fires on **emission paths 1, 2, 3 only**:
  1. **Path 1** — `portfolio.ts:120` (initial trade booking). Wrap with `bookCashLedgerEntry(store, entry)`.
  2. **Path 2** — `dividends.ts:610-655` (dividend posting). Inside `buildDividendCashLedgerEntries`, call `assertCashEntryCurrencyMatchesAccount(entry, account)` for each built entry before `replaceCashLedgerEntriesForDividend`. Account is already loaded in the calling context.
  3. **Path 3** — `recompute.ts:84` (fee-profile recompute single-trade replacement). Wrap with `bookTradeSettlementRecompute(store, tx)` (D11) calling the assertion before `replaceCashLedgerEntryForTrade`.
  - **Path 4** — `replayPositionHistory.ts:161` (full replay) is **explicitly skipped.** Replay re-derives entries from already-validated `trade_events`. Combined with D7's lockdown, no source-data drift can introduce a mismatch on the replay path. This is documented as an explicit invariant continuation in line with `replay-position-history-invariants.md`.
- **D9.** `/cash-ledger` page UX update. Page fetches `GET /accounts` once, builds `Map<accountId, {name, defaultCurrency, accountType}>`. Renders `name (TWD · Broker)` in the dropdown options (currently raw account ID) and per-account summary chips. Per-row account display can stay raw ID (filter key) — implementer judgment. i18n strings live in `apps/web/features/cash-ledger/i18n.ts` (`accountTypeBroker`, `accountTypeBank`, `accountTypeWallet`). Currency codes (TWD/USD/AUD) render untranslated by industry convention.
- **D10.** Schema and TypeScript types:
  - **Migration `db/migrations/040_kzo167_account_currency_and_type.sql`**, idempotent. `ADD COLUMN IF NOT EXISTS default_currency CHAR(3) NOT NULL DEFAULT 'TWD'` and `ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'broker'`. Both CHECK constraints inside `DO $$` guards mirroring the pattern in `db/migrations/039_kzo166_cash_ledger_fx_rate.sql`. Postgres backfills automatically via `DEFAULT` on `ADD COLUMN` — no explicit UPDATE needed.
  - **Type merge — `Account` → `AccountDto`.** Remove the duplicate `Account` interface from `apps/api/src/types/store.ts:4`. Define new literal unions `AccountDefaultCurrency = "TWD" | "USD" | "AUD"` and `AccountType = "broker" | "bank" | "wallet"` in `libs/shared-types/src/index.ts`. Add the two fields to `AccountDto`. Replace the single `accounts: Account[]` reference at `store.ts:257` with `accounts: AccountDto[]` plus the new `import type` line. `FeeProfile` and `FeeProfileBinding` mirrors stay untouched (real divergence — `taxRules?` and `marketCode?` respectively); see **KZO-181** for that cleanup.
  - **Auto-seed defaults.** `ensureDefaultPortfolioData` (`postgres.ts:430`) and the `MemoryPersistence` mirror hard-code `'TWD'`/`'broker'` in the INSERT.
- **D11.** Path 3 helper symmetry. Export `bookTradeSettlementRecompute(store, tx)` from `cashLedgerService.ts` that wraps assertion + `replaceCashLedgerEntryForTrade`. Mirrors the path-1 wrapper pattern.
- **D12.** Bundle the `buildTradeSettlementCashEntry` consolidation. The helper is currently duplicated between `portfolio.ts:282` and `recompute.ts:105`. Move into `cashLedgerService.ts`. Both call sites import the consolidated version.
- **D13.** Test placement (per `test-placement-persistence-backend.md`, `integration-test-persistence-direct.md`, `full-test-suite.md`):
  - **Unit (suite 4 `apps/api`):** `apps/api/test/unit/cashLedgerService.test.ts` — pure helper + wrapper coverage.
  - **Integration (suite 5 Postgres):** extend `apps/api/test/integration/postgres-migrations.integration.test.ts` with assertions on the new columns, defaults, and CHECK constraints. New `apps/api/test/integration/account-currency-change-guard.integration.test.ts` covering D7 (PATCH allowed when empty, blocked with cash entries, blocked with trade events) using `PostgresPersistence` directly per `integration-test-persistence-direct.md`.
  - **HTTP (suite 8 `test:http`):** `apps/api/test/http/specs/account-currency-and-type-aaa.http.spec.ts` — GET shape, PATCH success/fail paths, currency-mismatch on cash-entry-creation paths.
  - **Web unit (suite 3 `apps/web`):** assertion on the account-options mapping logic for `CashLedgerClient.tsx`.
  - **No new E2E specs.** Existing E2E specs that read account dropdown text need to be checked for breakage (Implementer responsibility — see implementation step 12).

## Out of scope (explicit)

- **KZO-179** — multi-account creation form + `POST /accounts` + DTO write contracts + audit. Mockup #4 (account creation form).
- **KZO-180** — `user_preferences.reporting_currency` column + dashboard / portfolio-summary FX-aware read consumers + settings UI. Per `docs/market-data-platform.md:157`.
- **KZO-181** — investigate and consolidate `FeeProfile` / `FeeProfileBinding` mirror divergence (`taxRules?` and `marketCode?`).
- **`account_type` behavioral gating** — bank/wallet accounts are not refused trades or specific entry types in this ticket. Defer to downstream tickets that have product reasons.
- **Sharing-view changes** — no current surface; revisit when account-scoped sharing exists.
- **Other UI surfaces** — transactions page, dashboard, etc. continue showing raw account IDs. Only `/cash-ledger` gets the chip in this ticket.

## Acceptance criteria mapping

| Ticket AC | Where satisfied |
|---|---|
| Migration applies cleanly; existing accounts → TWD/broker | D10 (`040_kzo167_*.sql`); integration test in `postgres-migrations.integration.test.ts` |
| Account creation form matches mockup #4 | **Out of scope** — split to KZO-179 |
| Cash entry with mismatched currency → 400 error | D8 (paths 1+2+3); HTTP test in `account-currency-and-type-aaa.http.spec.ts` |
| Admin list shows new columns | **Out of scope** — no admin accounts page exists; would split to a sibling ticket if needed |
| Existing TW-only flows unchanged | Auto-seed remains TWD/broker; existing TWD trades continue to settle without guard violations |

## Implementation Steps

### Phase 1 — Migration

- [ ] Create `db/migrations/040_kzo167_account_currency_and_type.sql`. Idempotent. Steps:
  1. `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS default_currency CHAR(3) NOT NULL DEFAULT 'TWD';`
  2. `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'broker';`
  3. `DO $$ ... ck_accounts_default_currency CHECK (default_currency IN ('TWD','USD','AUD')) ...;` (mirror 039 guard pattern).
  4. `DO $$ ... ck_accounts_account_type CHECK (account_type IN ('broker','bank','wallet')) ...;` (same pattern).
  5. No data backfill — `DEFAULT` on `ADD COLUMN` does it.
- [ ] Extend `apps/api/test/integration/postgres-migrations.integration.test.ts` with assertions: column existence, NOT NULL, DEFAULT, CHECK enum membership.

### Phase 2 — Types

- [ ] Add to `libs/shared-types/src/index.ts`:
  ```ts
  export type AccountDefaultCurrency = "TWD" | "USD" | "AUD";
  export type AccountType = "broker" | "bank" | "wallet";
  ```
  Extend `AccountDto` with `defaultCurrency: AccountDefaultCurrency` and `accountType: AccountType`.
- [ ] Remove `interface Account` from `apps/api/src/types/store.ts:4-9`. Replace `accounts: Account[]` (line 257) with `accounts: AccountDto[]`. Add `import type { AccountDto } from "@tw-portfolio/shared-types";` at the top of the file.
- [ ] Rebuild `@tw-portfolio/shared-types` and `@tw-portfolio/config` packages so downstream typechecks see the new fields.
- [ ] Audit per `shared-types-barrel-turbopack.md`: this is a *type* addition (`export type`), not a new runtime value export. Should not trigger the Turbopack value-export trap, but verify with E2E run if any unit tests pass but bundling fails.

### Phase 3 — Persistence layer

- [ ] Update `apps/api/src/persistence/postgres.ts` INSERT/SELECT/UPDATE sites:
  - `INSERT INTO accounts` at `postgres.ts:430` (default seed) — add `default_currency, account_type` columns with `'TWD', 'broker'` literals.
  - `INSERT INTO accounts` at `postgres.ts:2233` (saveStore) — same.
  - All `SELECT ... FROM accounts` paths — add the two columns to projection lists; map `default_currency` → `defaultCurrency`, `account_type` → `accountType` in row mapping.
  - Any account UPDATE in saveStore needs the new columns too (saveStore is full-replace; check `saveAccountingStoreTx` for any account-touching path).
- [ ] Mirror in `apps/api/src/persistence/memory.ts`:
  - `MemoryPersistence` Account fixtures and any internal seeding helper get `'TWD' / 'broker'` defaults.
  - Round-trip the new fields wherever `Account[]` is constructed.

### Phase 4 — Service module + emission paths

- [ ] Create `apps/api/src/services/cashLedgerService.ts`:
  ```ts
  export function assertCashEntryCurrencyMatchesAccount(entry: CashLedgerEntry, account: AccountDto): void;
  export function bookCashLedgerEntry(store: Store, entry: CashLedgerEntry): void;
  export function bookTradeSettlementRecompute(store: Store, tx: Transaction): void;
  export function buildTradeSettlementCashEntry(tx: Transaction): CashLedgerEntry; // consolidated from portfolio.ts + recompute.ts
  ```
  The two builders+wrappers use the consolidated `buildTradeSettlementCashEntry` internally. `bookCashLedgerEntry` looks up the account from `store.accounts` by `entry.accountId` (throw 404 `account_not_found` if missing) and calls the assertion before delegating to `appendCashLedgerEntry`. `bookTradeSettlementRecompute` does the same before `replaceCashLedgerEntryForTrade`.
- [ ] Refactor **path 1** at `portfolio.ts:120`: replace `appendCashLedgerEntry(store, buildTradeSettlementCashEntry(tx))` with `bookCashLedgerEntry(store, buildTradeSettlementCashEntry(tx))`. Remove the now-duplicate local `buildTradeSettlementCashEntry` from `portfolio.ts:282`; import from `cashLedgerService.ts`.
- [ ] Refactor **path 3** at `recompute.ts:84`: replace `replaceCashLedgerEntryForTrade(store, tx.id, buildTradeSettlementCashEntry(tx))` with `bookTradeSettlementRecompute(store, tx)`. Remove duplicate `buildTradeSettlementCashEntry` at `recompute.ts:105`; import from `cashLedgerService.ts`.
- [ ] Refactor **path 2** at `dividends.ts:610-655`: inside `buildDividendCashLedgerEntries`, after building each entry, call `assertCashEntryCurrencyMatchesAccount(entry, account)` (account is already loaded at the call site — verify with grep `account_not_found` near the call). The existing in-function `currency_mismatch` for `deduction.currencyCode !== dividendEvent.cashDividendCurrency` stays — it's a separate intra-dividend invariant.
- [ ] Path 4 (`replayPositionHistory.ts:161`) — **no change.** Add a one-line doc comment near the `bulkInsertCashLedgerEntries` call referencing this scope-todo and `replay-position-history-invariants.md` for the explicit invariant continuation.
- [ ] Verify `appendCashLedgerEntry` callers post-refactor: grep `appendCashLedgerEntry` in `apps/api/src` should return only the export line in `accountingStore.ts`. Tests can call it directly as the documented backdoor.

### Phase 5 — Routes (PATCH extension + lockdown)

- [ ] Update PATCH `/accounts/:id` Zod schema at `registerRoutes.ts:2484`:
  ```ts
  z.object({
    name: z.string().trim().min(1).max(80).optional(),
    feeProfileId: userScopedIdSchema.optional(),
    defaultCurrency: z.enum(["TWD", "USD", "AUD"]).optional(),
    accountType: z.enum(["broker", "bank", "wallet"]).optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.feeProfileId !== undefined || v.defaultCurrency !== undefined || v.accountType !== undefined,
    { message: "at least one field required" },
  )
  ```
- [ ] Implement D7 lockdown in the route handler:
  - When `body.defaultCurrency` is provided AND differs from existing `account.defaultCurrency`, query `cash_ledger_entries` AND `trade_events` for the account (count(*) > 0). If either exists, throw `routeError(409, "currency_change_blocked", "Cannot change default currency: account has existing cash entries or trade events. Open a new account or contact support.")`.
  - Otherwise, set `account.defaultCurrency` and persist via `saveStore`.
- [ ] `accountType` changes are unguarded — direct assignment + saveStore.
- [ ] GET `/accounts` at `registerRoutes.ts:2479` automatically returns the new fields (it returns `store.accounts` which is `AccountDto[]` after Phase 2 + 3).

### Phase 6 — `/cash-ledger` web UI

- [ ] In `apps/web/features/cash-ledger/components/CashLedgerClient.tsx`:
  - Add SWR/`useEffect` fetch for `GET /accounts` on mount; cache as `Map<accountId, { name, defaultCurrency, accountType }>`.
  - Replace dropdown option label `${id}` (line 222) with `${account.name} (${account.defaultCurrency} · ${formatType(account.accountType, t)})`.
  - Replace summary chip label `${s.accountId} / ${s.currency}` (line 258) with `${account.name} (${account.defaultCurrency} · ${formatType(...)})`.
  - Per-row `entry.accountId` cell (lines 308, 374) can stay as raw ID — Implementer judgment.
  - Strict-typing: handle the case where the accounts fetch hasn't returned yet (fall back to raw ID rendering until loaded).
- [ ] Add i18n keys to `apps/web/features/cash-ledger/i18n.ts` (en + zh-TW dictionaries):
  - `accountTypeBroker: "Broker"` / `"券商"`
  - `accountTypeBank: "Bank"` / `"銀行"`
  - `accountTypeWallet: "Wallet"` / `"錢包"`
- [ ] Review for `nextjs-i18n-serialization.md` compliance: dictionary stays string-only; `formatType(type, t)` is a helper, not a function in the dictionary.

### Phase 7 — Tests

- [ ] **Unit (suite 4 — `apps/api`):** `apps/api/test/unit/cashLedgerService.test.ts`
  - `assertCashEntryCurrencyMatchesAccount` — match → no throw; mismatch → routeError 400 with code `currency_mismatch`.
  - `bookCashLedgerEntry` — happy path + missing-account 404 + mismatch 400.
  - `bookTradeSettlementRecompute` — same shape.
- [ ] **Integration (suite 5 — Postgres):**
  - Extend `apps/api/test/integration/postgres-migrations.integration.test.ts` with column / default / CHECK assertions for migration 040.
  - New `apps/api/test/integration/account-currency-change-guard.integration.test.ts` per `integration-test-persistence-direct.md`:
    - Seed real user via `resolveOrCreateUser`. Get the auto-seeded account.
    - PATCH defaultCurrency on empty account → 200, persisted.
    - Seed a cash entry; PATCH → 409 `currency_change_blocked`.
    - Reset; seed a trade event (via persistence helper, no cash entry); PATCH → 409 `currency_change_blocked`.
- [ ] **HTTP (suite 8 — `apps/api`):** `apps/api/test/http/specs/account-currency-and-type-aaa.http.spec.ts`
  - GET /accounts after default seed → response includes `defaultCurrency: 'TWD'`, `accountType: 'broker'`.
  - PATCH `accountType: 'bank'` → 200; subsequent GET reflects.
  - PATCH `defaultCurrency: 'USD'` on empty account → 200.
  - Book a trade through the existing trade-booking path; PATCH `defaultCurrency: 'USD'` → 409.
  - Validate Zod enum rejection: PATCH `defaultCurrency: 'EUR'` → 400.
  - Register the new endpoint+assistant pair in `libs/test-api/src/config/mapper.ts` per `test-api-mapper-registration.md` if a new test-API endpoint shape is needed.
- [ ] **Web unit (suite 3 — `apps/web`):** assertion on `CashLedgerClient` account-options mapping logic.
- [ ] **Update existing fixtures** that build `Account` / `AccountDto` literals — typecheck failures will surface them. Add `defaultCurrency: 'TWD'` and `accountType: 'broker'` defaults.
- [ ] **Existing E2E grep:** `grep -rn 'getByLabel.*account\|byTestId.*account-id\|byText.*account-1' apps/web/tests/e2e/specs apps/web/tests/e2e/specs-oauth` — verify no spec relies on the exact dropdown rendering. Update if any selectors break with the new label format.

### Phase 8 — Docs & Linear write-back

- [x] Patch `docs/004-notes/kzo-166/scope-todo-202604262100-currency-wallet-wac.md:38` (done in same PR via this scope-grill).
- [ ] Add a paragraph to `docs/market-data-platform.md` noting that KZO-167 ships per-account currency, KZO-180 wires the user-level reporting currency consumer; cross-link both tickets.
- [ ] Append a transition note `docs/004-notes/kzo-167/transition-{datetime}-account-currency-and-type.md` after merge, per `doc-management.md`.
- [ ] Update `## Locked Scope` on KZO-167 (done in this scope-grill session).

### Phase 9 — Pre-PR / pre-push gates (reviewer checklist)

- [ ] Run the canonical pre-push gate per `full-test-suite.md`:
  ```bash
  npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full
  ```
- [ ] Run `/code-reviewer` per `code-review-before-pr.md` and produce review doc at `docs/004-notes/kzo-167/review-{datetime}-iter1.md`.
- [ ] Verify reviewer-rule compliance:
  - `service-error-pattern.md` — `routeError(400, "currency_mismatch", ...)`, `routeError(409, "currency_change_blocked", ...)`, `routeError(404, "account_not_found", ...)`.
  - `migration-strategy.md` — new file 040, no edits to earlier migrations, no DROP without full-repo grep.
  - `replay-position-history-invariants.md` — D8 path-4 skip documented as invariant continuation.
  - `interface-caller-verification.md` — grep all callers of `appendCashLedgerEntry` post-refactor.
  - `test-placement-persistence-backend.md` + `integration-test-persistence-direct.md` — D7 lockdown test is Postgres-backed via `PostgresPersistence` directly.
  - `nextjs-i18n-serialization.md` — i18n dictionaries are string-only.
  - `commit-format.md` — `feat(api,db,web): KZO-167: ...` shape.
  - `pr-bound-docs-review-compliance.md` — PR description has `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback`.

## Open Items (carried forward to sibling tickets)

- **KZO-179** — Multi-account creation UX: form + `POST /accounts`. Mockup #4. Blocked by KZO-167.
- **KZO-180** — User-level reporting currency: `user_preferences.reporting_currency` column + dashboard FX-aware reads + settings UI. Blocked by KZO-167 + KZO-176.
- **KZO-181** — Investigate `FeeProfile` / `FeeProfileBinding` mirror divergence (`taxRules?`, `marketCode?`); consolidate where safe. Low priority.

## References

- Linear: KZO-167 (this ticket); KZO-179, KZO-180, KZO-181 (children); KZO-166 (sibling — WAC engine producer side); KZO-168 (forward — FX_TRANSFER consumer side); KZO-170 / KZO-171 (forward — US/AU markets).
- Companion docs: `docs/004-notes/kzo-166/scope-todo-202604262100-currency-wallet-wac.md`, `docs/market-data-platform.md`, `db/migrations/039_kzo166_cash_ledger_fx_rate.sql` (constraint guard precedent).
- Mockup: Mockup 04 attached to ticket #14 (account creation form — used by KZO-179, not this ticket).
