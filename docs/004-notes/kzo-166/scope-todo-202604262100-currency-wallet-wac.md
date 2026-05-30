---
slug: kzo-166
source: scope-grill
created: 2026-04-26
tickets: [KZO-166]
required_reading: []
superseded_by: null
---

# Todo: KZO-166 — Currency wallet WAC + realized FX P&L tracking

> **For agents starting a fresh session:** this file is the sole handoff artifact. Read this scope-todo plus the Linear ticket KZO-166 description (the `## Locked Scope` section appended via this session) before starting implementation. Companion files for context: `apps/api/src/services/currencyWalletSnapshotGeneration.ts` (KZO-165 stub writer to extend), `apps/api/src/services/replayPositionHistory.ts` (NOT to be modified — read-only reference), `db/migrations/038_kzo165_snapshot_multi_currency.sql` (the schema KZO-166 populates), `db/migrations/037_kzo164_fx_rates.sql` (FX rate source), `apps/api/src/persistence/types.ts` (Persistence interface to extend with `getFxRate`), `.claude/rules/replay-position-history-invariants.md`, `.claude/rules/service-error-pattern.md`, `.claude/rules/migration-strategy.md`, `.claude/rules/test-placement-persistence-backend.md`, `.claude/rules/integration-test-persistence-direct.md`, `.claude/rules/typed-transient-error-catch-audit.md`.

## Context (one-paragraph framing)

KZO-165 landed the schema (`currency_wallet_snapshots` with `wac_fx_to_usd`, `realized_fx_pnl_lifetime`, `provider_source` columns) and a stub writer that always emits `null / 0 / null`. KZO-164 landed the daily Frankfurter ingestion into `market_data.fx_rates`. KZO-166 lights up the WAC engine on top of those foundations: it computes weighted-average FX cost on every cross-currency cash inflow, crystallizes realized FX P&L on every cross-currency outflow, and exposes a read-time helper for translating native realized P&L to a reporting currency at the trade's sale-date FX. It does **not** modify `replayPositionHistory.ts`, **not** introduce a new replay function, and **not** ship UI consumers — those are deferred. Until KZO-168 lands the `FX_TRANSFER` cash-entry type, KZO-166's WAC engine is structurally complete but produces no observable change in production data; tests exercise it via synthetic FX-rate-stamped entries.

## Decisions (locked via scope-grill 2026-04-26)

- **D1.** Ship standalone — no coupling to KZO-168. Tests use synthetic cash entries with explicit `fx_rate_to_usd` populated; production WAC stays inert until KZO-168 emits real FX_TRANSFER entries.
- **D2.** WAC update + realized FX P&L crystallization fire **only** on `cash_ledger_entries` rows with non-null `fx_rate_to_usd`. All other entry types (TRADE_SETTLEMENT_IN/OUT, DIVIDEND_RECEIPT/DEDUCTION, MANUAL_ADJUSTMENT, REVERSAL of non-FX) pass through `balance_native` aggregation without touching WAC. Trade settlements do not represent FX conversions and must not pollute WAC.
- **D3.** Add nullable column `fx_rate_to_usd NUMERIC(20, 8)` to `cash_ledger_entries` with `CHECK (fx_rate_to_usd IS NULL OR fx_rate_to_usd > 0)`. Migration `039_kzo166_cash_ledger_fx_rate.sql`. KZO-168 will populate it for FX_TRANSFER entries.
- **D4.** Position locked-at-sale-date FX is **read-time only** — `replayPositionHistory.ts` is unchanged. Add persistence helper `getFxRate(base, quote, asOfDate)` that reads `market_data.fx_rates` with forward-fill (latest rate ≤ asOfDate). Read-time consumers translate native realized P&L by JOINing trade events to FX rates on `trade_date`. Self-pair (e.g. `getFxRate("USD","USD",date)`) returns `1.0` without DB access.
- **D5.** Wallet replay = extend existing per-user `generateCurrencyWalletSnapshots` inline. New module `currencyWalletAccounting.ts` exposes pure helpers (`applyEntryToWalletState`, `computeRealizedFxPnl`, typed errors). **Do not** introduce `replayWalletForAccount(account, currency)` — drop from ticket scope. **Do not** publish new SSE events.
- **D6.** Realized FX P&L is **USD-denominated, signed net P&L** stored in `realized_fx_pnl_lifetime`. A loss reduces the lifetime value. Cumulative from genesis; reset to 0 only on full account purge. Drop the ticket's "never decreases" wording — incompatible with signed net.
- **D7.** REVERSAL of an FX-conversion entry: filter reversed-and-reversal pairs out of the WAC iteration upfront. Both still contribute to `balance_native` (sum to zero); both are invisible to WAC + realized-FX state.
- **D8.** Missing FX rate: `getFxRate` forward-fills from latest rate ≤ asOfDate; returns `null` if no rate exists at all. Write-path callers throw typed `MissingFxRateError(base, quote, asOfDate)`. Read-path callers degrade to native-only (do not 500 the dashboard for one missing rate).
- **D9.** Insufficient balance on FX outflow: throw typed `InsufficientWalletBalanceError(account, currency, available, requested)`; mirror `replayPositionHistory`'s `allocateSellLots` enrichment pattern. Surface through recompute-failed SSE if reached on the hot path.
- **D10.** USD wallet rows: write explicit `wac_fx_to_usd = 1.0`, `realized_fx_pnl_lifetime = 0`, `provider_source = 'frankfurter'`. Distinguishes "USD has no FX exposure" from "WAC unknown."
- **D11.** Provider attribution: `provider_source = 'frankfurter'` on non-USD wallet snapshots when WAC is computed (only FX provider today). Per-conversion provider attribution is left to KZO-168 (could add a `fx_rate_provider` column to `cash_ledger_entries` later if multiple providers emerge).
- **D12.** Decimal precision: WAC math intermediate = full precision (`Decimal.js`-style or `NUMERIC(20, 8)`). Round to `NUMERIC(20, 2)` at write using `roundToDecimal(value, 2)` from `@tw-portfolio/domain`.
- **D13.** Service error pattern: typed errors caught at the route boundary and mapped via `routeError(statusCode, code, message)` per `service-error-pattern.md`. Inner replay catch must explicitly re-throw typed FX errors per `typed-transient-error-catch-audit.md` so the outer recompute-failed SSE path runs.
- **D14.** Test placement: pure WAC math = unit tests (vitest); persistence helper + generator-end-to-end = Postgres-backed integration tests per `test-placement-persistence-backend.md`. Pick previously-unused tickers if any test seeds market data; grep-verify before writing per `e2e-shared-memory-bars-ticker-hygiene.md`.
- **D15.** Replay invariants: only invariants 3 (typed-error enrichment) and 4 (zero-amount filter, already enforced by CHECK) apply to wallet generator. Invariants 1, 2, 5 are not applicable (no replay function added; aggregation is order-independent for balance, but **WAC iteration must still walk entries in `(entry_date ASC, booked_at ASC, id ASC)` order** for determinism). Document this explicitly in implementation; do not promote `replay-position-history-invariants.md` to a generic doc.

## Out of scope (explicit)

- **KZO-167** — `accounts.default_currency` + `account_type` schema, service guardrail for cash-entry currency match, PATCH `/accounts/:id` extension, `/cash-ledger` chip display. Per-user reporting currency resolution is **NOT** in KZO-167 (corrected via KZO-167 scope-grill 2026-04-27); split into **KZO-180** which lands the column (in `user_preferences`, NOT `users`) plus the dashboard / portfolio-summary FX-aware read consumers together. Until KZO-180, `getFxRate` consumers pass `'USD'` as the reporting currency parameter.
- **KZO-168** — `FX_TRANSFER` cash-entry type, paired-entry linking, UI form, input validation. KZO-166 ships the *consumer side* of `fx_rate_to_usd`; KZO-168 is the *producer side*.
- **Read-time consumers of `getFxRate`** — no dashboard / portfolio-summary route changes ship in KZO-166. KZO-180 wires reporting-currency-aware reads after KZO-167 + KZO-176 land.
- **Surgical per-`(account, currency)` wallet replay** — only worth a follow-up ticket if profiling shows the per-user full-replace is a bottleneck.
- **Performance caching** for `getFxRate` — defer; rely on `idx_fx_rates_pair_date_desc` for now.
- **Modifications to `replayPositionHistory.ts`** — explicitly off-limits in this ticket.

## Acceptance criteria mapping

| AC (from ticket) | Where satisfied |
|---|---|
| AC1: Funding USD wallet at three different rates produces correct WAC | Unit tests on `applyEntryToWalletState` |
| AC2: USD→TWD conversion crystallizes correct realized FX P&L vs WAC | Unit tests on `computeRealizedFxPnl` + integration test on extended generator |
| AC3: WAC unchanged when partial USD is sold (only balance decreases) | Unit tests on `applyEntryToWalletState` (partial sell scenario) |
| AC4: All five replay invariants preserved | D15: `replayPositionHistory.ts` unchanged (1, 2, 5 trivially preserved); 3 mirrored via typed errors; 4 enforced by existing `CHECK (amount_ntd <> 0)` |
| AC5: Position realized P&L stored in native only; reporting translation deferred to read-time | D4: `getFxRate` helper + read-time JOIN pattern; replay unchanged |

## Implementation Steps

### Phase 1 — Migration

- [x] Create `db/migrations/039_kzo166_cash_ledger_fx_rate.sql`. Idempotent. Steps:
  1. `ALTER TABLE cash_ledger_entries ADD COLUMN IF NOT EXISTS fx_rate_to_usd NUMERIC(20, 8);`
  2. `ALTER TABLE cash_ledger_entries ADD CONSTRAINT IF NOT EXISTS ck_cash_ledger_fx_rate_positive CHECK (fx_rate_to_usd IS NULL OR fx_rate_to_usd > 0);`
  3. No data backfill — existing rows correctly remain NULL (no FX conversion happened).
  - Note: shipped using `DO $$` constraint guard (literal `ADD CONSTRAINT IF NOT EXISTS` is unsupported on in-scope Postgres versions).
- [x] Extend `apps/api/test/integration/postgres-migrations.integration.test.ts` with a walk-through case asserting the new column + CHECK exist after migration 039 applies.

### Phase 2 — Persistence layer

- [x] Add `CashLedgerEntry.fxRateToUsd?: number | null` to the `apps/api/src/persistence/types.ts` interface. (Lives on the new `CashLedgerEntryForWalletReplay` shape; `CashLedgerEntry` row type extended via `apps/api/src/types/store.ts`.)
- [x] Update `MemoryPersistence` and `PostgresPersistence` insert/select paths for `cash_ledger_entries` to round-trip `fx_rate_to_usd`. (5 INSERT + 2 SELECT sites in `postgres.ts`; Memory mirror parity preserved.)
- [x] Add `getFxRate(base: CurrencyCode, quote: CurrencyCode, asOfDate: string): Promise<number | null>` to the `Persistence` interface.
  - Self-pair shortcut: returns `1.0` synchronously (no DB hit) when `base === quote`.
  - Postgres query: `SELECT rate FROM market_data.fx_rates WHERE base_currency=$1 AND quote_currency=$2 AND date <= $3 ORDER BY date DESC LIMIT 1`.
  - Memory implementation: linear scan over seeded FX rates (test-only fixture).
  - Returns `null` when no rate exists ≤ asOfDate.
- [x] Add `getCashLedgerEntriesForWalletReplay(userId)` (or extend `getCashLedgerEntriesForBalances`) to return entries in `(entry_date ASC, booked_at ASC, id ASC)` deterministic order, with reversed-pair filtering applied. Returned shape includes `fxRateToUsd`, `entryType`, `id`, `reversalOfCashLedgerEntryId`. (New method added; existing `getCashLedgerEntriesForBalances` left intact for backward compat.)

### Phase 3 — Service module: `currencyWalletAccounting.ts`

- [x] Create `apps/api/src/services/currencyWalletAccounting.ts`. Pure functions only — no I/O, no persistence import. (Validator gate 9.3: zero persistence/pg/pool/fastify imports.)
- [x] Define types:
  ```ts
  type WalletState = {
    balance: number;        // native currency, NUMERIC(20, 2)
    wacFxToUsd: number | null;  // null when balance is 0 OR no FX inflow seen
    realizedFxPnlLifetime: number;  // USD, signed net, NUMERIC(20, 2)
  };

  type WalletEntry = {
    amount: number;  // native, signed
    fxRateToUsd: number | null;
    entryDate: string;
  };
  ```
- [x] Implement `applyEntryToWalletState(prev: WalletState, entry: WalletEntry): WalletState`:
  - If `entry.fxRateToUsd` is null → balance += amount; WAC and realized unchanged.
  - If `entry.amount > 0` (credit/inflow with FX rate) → WAC = weighted average of (prev.balance × prev.wacFxToUsd) and (amount × fxRateToUsd) divided by (prev.balance + amount). Use full precision.
  - If `entry.amount < 0` (debit/outflow with FX rate) → if `prev.balance + entry.amount < 0` throw `InsufficientWalletBalanceError`; otherwise crystallize realizedFxPnl = (entry.fxRateToUsd − prev.wacFxToUsd) × |amount|; lifetime += this; balance += amount; **WAC unchanged** (per AC3).
  - Edge: balance reaches 0 → WAC reset to `null`; next inflow re-seeds the WAC. (Locked in architect-design §3.)
- [x] Implement `computeRealizedFxPnl(wac: number, saleRate: number, amountSold: number): number` as a thin pure helper used inside applyEntryToWalletState.
- [x] Implement typed errors: `InsufficientWalletBalanceError`, `MissingFxRateError`. Both extend a shared base (`WalletAccountingError`); both carry structured context fields (account, currency, dates, amounts).

### Phase 4 — Wire into snapshot generator

- [x] Modify `apps/api/src/services/currencyWalletSnapshotGeneration.ts`:
  - Replace stub WAC values with running state per `(accountId, currency)`. (Map-based state per group — interleaved sort order across groups.)
  - Source entries via the new persistence query (deterministic order, reversed-pairs filtered).
  - Call `applyEntryToWalletState` per entry; emit one snapshot row per `(account, currency, date-with-activity)` carrying the running tuple.
  - For the USD wallet, rows always carry `wacFxToUsd = 1.0`, `realizedFxPnlLifetime = 0`, `providerSource = 'frankfurter'`.
  - For non-USD wallets where WAC was computed, stamp `providerSource = 'frankfurter'`.
  - For non-USD wallets where no FX inflow has happened yet (balance positive but no FX trace), leave `wacFxToUsd = null`, `realizedFxPnlLifetime = 0`, `providerSource = null` (matches KZO-165 stub semantics for backwards compatibility).
- [x] Catch `MissingFxRateError` and `InsufficientWalletBalanceError` inside the generator and surface with structured context to the caller. Verify `typed-transient-error-catch-audit.md` rule: any inner try/catch in the generator must explicitly re-throw these typed errors before falling through to a generic warn-and-continue. (Implementation has NO inner try/catch around the walk; typed errors propagate unwrapped — equivalent satisfaction of the rule. Validator gate 9.5 confirmed.)

### Phase 5 — Tests

#### Unit tests (vitest, in `apps/api/test/unit/`)

- [x] `currencyWalletAccounting.test.ts`:
  - AC1: USD wallet funded at three different rates (synthetic FX inflows on TWD wallet at rates 0.030, 0.032, 0.034 with amounts 100, 200, 100). Assert WAC computed correctly via weighted-average formula.
  - AC2: USD→TWD outflow scenario (set up TWD wallet with WAC=0.032; outflow 500 TWD at sale rate 0.034). Assert realized FX P&L = (0.034 − 0.032) × 500 = 1.0 USD.
  - AC3: Partial sell preserves WAC (start with TWD WAC=0.032 balance=1000; sell 500 at rate 0.034; assert balance=500 and WAC unchanged at 0.032).
  - Loss case: TWD WAC=0.034 balance=500; outflow 500 at rate 0.032 → realized = -1.0 USD (signed negative).
  - Insufficient balance case: TWD balance=100; outflow 500 → throws InsufficientWalletBalanceError with structured context.
  - Edge: balance reaches 0 → next inflow re-seeds WAC (not weighted with prior null).
  - Edge: REVERSAL pair filtered upstream → applyEntryToWalletState never sees them; no test here, covered in integration.

#### Integration tests (Postgres-backed, in `apps/api/test/integration/`)

- [x] `currency-wallet-wac.integration.test.ts`:
  - Use `PostgresPersistence` directly per `integration-test-persistence-direct.md` (not `buildApp`).
  - Seed FX rates in `market_data.fx_rates` for the test dates.
  - Seed synthetic FX-conversion cash entries (`MANUAL_ADJUSTMENT` rows tagged with `fx_rate_to_usd`, since `FX_TRANSFER` is KZO-168). REVERSAL rows seeded with `entry_type = 'REVERSAL'` per `cash_ledger_entries_check1` constraint (Phase 4 fix 4A.1).
  - Invoke `generateCurrencyWalletSnapshots` and read `currency_wallet_snapshots` rows.
  - Assert WAC, realized_fx_pnl_lifetime, provider_source values across multi-day scenarios.
  - REVERSAL test: seed an original FX inflow + a REVERSAL entry; assert WAC and realized are unchanged from baseline.
  - USD wallet test: assert USD rows always have `wac_fx_to_usd = 1.0`, `realized_fx_pnl_lifetime = 0`, `provider_source = 'frankfurter'`.
  - Validator iter-2: 8/8 cases PASS.
- [x] `getFxRate.integration.test.ts`:
  - Self-pair returns 1.0 without DB access (verify via mocked DB to ensure no query).
  - Forward-fill: seed rate on Mon, query Sat → returns Mon's rate.
  - Missing-rate: seed nothing for a pair → returns `null`.
  - Date precision: seed rates on 5 consecutive days; query each → returns the exact-date rate (not forward-fill when exact match exists).
  - Validator iter-2: 10/10 cases PASS (D12 NUMERIC coercion test now executes correctly post Phase 4 fix 4A.2).

### Phase 6 — Documentation

- [x] Update `docs/market-data-platform.md` to describe the WAC engine + `getFxRate` helper. Note that consumers come in a follow-up. (Wave 2 Technical Writer Artifact 1; landed.)
- [x] Append note to `.claude/rules/replay-position-history-invariants.md` clarifying that the wallet generator inherits invariants 3 & 4 by analogy but is not a replay function (avoids future confusion). (Companion section appended after invariant 5; D15 framing preserved — explicitly states the rule is NOT to be promoted to a generic doc.)
- [ ] Optional: add a lifecycle note to `apps/api/src/services/currencyWalletSnapshotGeneration.ts` referencing this scope-todo for the WAC algorithm. *(Optional — not required.)*

### Phase 7 — Pre-PR

- [x] Full eight-suite gate per `.claude/rules/full-test-suite.md` — `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`. (Canonical one-shot chain ran from worktree root and exited 0; log at `.worklog/team/eight-suite-run.log`. All eight suites green sequentially, post Phase 4 fixes.)
- [x] Run `/code-reviewer` per `.claude/rules/code-review-before-pr.md` — produce review doc at `docs/004-notes/kzo-166/review-{datetime}-iter1.md`. (Landed at `docs/004-notes/kzo-166/review-202604262220-iter1.md`; H1 + L1 both resolved via Phase 4 fixes.)
- [x] PR description follows `docs/git-pr-flow.md` §3-4: `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block of suite results), `## Risk/Rollback`. Verify `pr-gate.yml` body validation passes per `.claude/rules/pr-bound-docs-review-compliance.md`. (Drafted at `.worklog/team/pr-description-draft.md` with all four required sections, fenced `Evidence:` block, contract spot-checks, and a renamed-types table per `process-refactor-rename-verification.md`.)

## Open Items (note-only — promote to Linear later if needed)

- [ ] **Wire `getFxRate` consumers in portfolio reporting paths** — once KZO-167 (`accounts.default_currency`) lands, a small ticket can JOIN `market_data.fx_rates` on `trade_date` in the dashboard / portfolio-summary route handlers to surface reporting-currency realized P&L. Today no such consumer exists.
- [ ] **Performance profiling for `getFxRate` read-time JOINs** — only escalate to a ticket if dashboard load times regress meaningfully.
- [ ] **Per-conversion provider attribution column on `cash_ledger_entries`** — only needed when a second FX provider is integrated.
- [ ] **Surgical per-`(account, currency)` wallet replay** — promote to a ticket only if per-user full-replace becomes a bottleneck post-KZO-168.

## References

- Linear ticket: KZO-166
- Predecessor scope-todo: `docs/004-notes/kzo-165/scope-todo-202604261503-snapshot-multi-currency.md`
- KZO-164 (FX rates): `docs/004-notes/kzo-164/scope-todo-202604261830-frankfurter-fx.md`
- Schema: `db/migrations/038_kzo165_snapshot_multi_currency.sql` (currency_wallet_snapshots) + `db/migrations/037_kzo164_fx_rates.sql` (market_data.fx_rates)
- Stub writer (extend): `apps/api/src/services/currencyWalletSnapshotGeneration.ts`
- Reference replay (do not modify): `apps/api/src/services/replayPositionHistory.ts`
- Rules cited: `replay-position-history-invariants.md`, `service-error-pattern.md`, `migration-strategy.md`, `test-placement-persistence-backend.md`, `integration-test-persistence-direct.md`, `typed-transient-error-catch-audit.md`, `full-test-suite.md`, `pr-bound-docs-review-compliance.md`, `code-review-before-pr.md`, `e2e-shared-memory-bars-ticker-hygiene.md`.
