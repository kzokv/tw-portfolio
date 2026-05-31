---
slug: kzo-168
source: scope-grill
created: 2026-04-29
tickets: [KZO-168]
required_reading:
  - docs/004-notes/kzo-166/scope-todo-202604262100-currency-wallet-wac.md
  - docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md
superseded_by: null
---

# Todo: KZO-168 — FX-transfer transaction type + form

> **For agents starting a fresh session:** this scope-todo is the sole handoff artefact from the 2026-04-29 grill session. Read locked decisions D1–D18 in full before opening any source file. KZO-166 (WAC engine) and KZO-167 (account `default_currency` + `account_type`) are merged; this ticket is the *producer* side of `fx_rate_to_usd` — KZO-166 D2 explicitly declared the engine inert until this ticket lands.
>
> Companion files for context:
> - `apps/api/src/services/currencyWalletAccounting.ts` (WAC engine — D3 modifies)
> - `apps/api/src/services/cashLedgerService.ts` (currency-match guard precedent)
> - `apps/api/src/persistence/types.ts` (`Persistence.getFxRate` already exists from KZO-166)
> - `apps/web/components/portfolio/RecordTransactionDialog.tsx` (modal form precedent)
> - `apps/web/features/cash-ledger/CashLedgerClient.tsx` (ledger view to extend)
> - `db/migrations/003_accounting_core_schema.sql` lines 93-157 (cash_ledger_entries CHECK constraints to refine)
> - `db/migrations/039_kzo166_cash_ledger_fx_rate.sql` (`fx_rate_to_usd` column already added)
> - `db/migrations/040_kzo167_account_currency_and_type.sql` (account currency CHECK enum)
> - `.claude/rules/service-error-pattern.md` — `routeError(status, code, message)` only
> - `.claude/rules/replay-position-history-invariants.md` — wallet-generator invariants 3, 4 inherited
> - `.claude/rules/migration-strategy.md` — migration 003 is applied; **never edit; create new migration**
> - `.claude/rules/integration-test-persistence-direct.md` — Postgres tests use `PostgresPersistence` direct
> - `.claude/rules/test-api-mapper-registration.md` — register new endpoint+assistant
> - `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md` — currency-pair-and-date hygiene equivalent
> - `.claude/rules/playwright-fast-sse-assertions.md` — SSE assertion patterns
> - `.claude/rules/agent-team-workflow.md` — Tier-2 parallel Phase 1+2 launch
> - `.claude/rules/code-review-before-pr.md` — `/code-reviewer` before PR for any 5+ file ticket

## Context (one-paragraph framing)

KZO-168 is the producer side of `cash_ledger_entries.fx_rate_to_usd` — KZO-166 shipped the WAC engine + realized FX P&L crystallization but kept production data inert until FX_TRANSFER entries materialize. This ticket adds two new entry types (`FX_TRANSFER_OUT`, `FX_TRANSFER_IN`), a UUID-typed `fx_transfer_id` linkage column, an FX-transfer service with create / edit (`PATCH`) / reverse / estimate endpoints, a modal form with live FX gauge + summary box, and cash-ledger view enrichment for paired-leg display. The WAC engine gains one semantic change: `WAC=null + balance > 0 + outflow with fx_rate_to_usd` now seeds WAC at the entry's rate (realized=0) instead of throwing — covering the most common scenario where a TWD wallet's first-ever FX outflow has no prior FX cost basis. All six TWD/USD/AUD pair directions are supported via a generalized derivation that preserves KZO-166 D10's "USD wallets always carry WAC=1.0" invariant.

## Decisions (locked via scope-grill 2026-04-29)

- **D1. Entry type extension.** Add `FX_TRANSFER_OUT` and `FX_TRANSFER_IN` as new values in `cash_ledger_entries.entry_type` CHECK enum. Migration drops + re-adds the CHECK with the new values. The conditional checks at migration 003 lines 122-141 (currently exempt MANUAL_ADJUSTMENT/REVERSAL from trade-event and dividend-ledger link requirements) must be refined so FX_TRANSFER_* rows are also exempt.

- **D2. Two-leg linkage via `fx_transfer_id UUID NULL` column on `cash_ledger_entries`.** Same-table column (no separate `fx_transfers` table). Operational metadata (mid-rate snapshot, tolerance %, provider, decision) lives in `audit_log`, not in the cash ledger schema.
  - CHECK constraint: `fx_transfer_id IS NULL OR entry_type IN ('FX_TRANSFER_OUT','FX_TRANSFER_IN','REVERSAL')`. Service layer enforces "REVERSAL of an FX_TRANSFER inherits its parent's `fx_transfer_id`; non-FX REVERSAL gets null."
  - Partial UNIQUE index: `(fx_transfer_id, entry_type) WHERE fx_transfer_id IS NOT NULL AND reversal_of_cash_ledger_entry_id IS NULL` — exactly one OUT and one IN among non-reversal originals per `fx_transfer_id`.

- **D3. WAC engine semantic change.** `apps/api/src/services/currencyWalletAccounting.ts` Case C: when `prev.wacFxToUsd === null && prev.balance + amount > 0` on an outflow with non-null `fx_rate_to_usd`, **seed WAC at the entry's `fx_rate_to_usd`, realized=0** (instead of throwing `InsufficientWalletBalanceError`). The genuine `prev.balance + amount < 0` throw stays unchanged. The new branch generalizes to any `fx_rate_to_usd`-stamped outflow — not entry-type-specific.
  - **KZO-168 owns updating** `apps/api/test/unit/currencyWalletAccounting.test.ts` and any integration tests asserting the prior throw behaviour.

- **D4. Rate input direction = destination-per-source.** User types `0.0322` for TWD→USD, `31.05` for USD→TWD, `0.0488` for TWD→AUD. Form prefills via `getFxRate(fromCurrency, toCurrency, transferDate)` directly. Tolerance check (D6) compares user input against this prefilled value.

- **D5. All six currency-pair directions supported** (TWD↔USD, USD↔AUD, TWD↔AUD). Generalized `fx_rate_to_usd` derivation per leg:
  - **USD legs always carry `fx_rate_to_usd = 1.0`** (KZO-166 D10 invariant: USD has no FX exposure to itself).
  - **Non-USD OUT leg**: `(toAmount × midUsdPerToCurrency) / fromAmount`. For USD destination this collapses to `toAmount / fromAmount` = the user's typed rate.
  - **Non-USD IN leg**: `(fromAmount × midUsdPerSourceCurrency) / toAmount`. For USD source this collapses to `fromAmount / toAmount` = inverse of the user's typed rate.
  - For TWD↔AUD, both legs are non-USD → both `fx_rate_to_usd` values are derived using `getFxRate(_, USD, date)` lookups.

- **D6. Mid-rate validation thresholds: 2% warn, 10% hard-block.** Hard-coded as named constants in `apps/api/src/services/fxTransferService.ts` (NOT env vars).
  - Soft-warn (allow submit) on missing direct mid-rate `getFxRate(from, to, date)`.
  - Hard-block (`routeError(400, "fx_rate_unavailable", ...)` from typed `MissingFxRateError`) on missing USD-bridge mid-rate for any non-USD leg — the WAC engine literally cannot stamp without it.
  - **TWD↔AUD with missing direct rate**: form synthesizes via USD bridge `getFxRate(from,USD,date) × getFxRate(USD,to,date)` for prefill display only with a "★ derived rate" badge; tolerance band shown but **not enforced** against the synthesized number; soft-warn message shown.

- **D7. Service-layer validation cluster** (in `fxTransferService.ts`):
  - Same-account rejection → `400 fx_transfer_same_account`.
  - Same-currency rejection → `400 fx_transfer_same_currency`.
  - Account-ownership scoping (both accounts belong to the calling user) → `404 account_not_found` (don't leak existence of other-user accounts).
  - Amount positivity (Zod-validated at route boundary) → `400 invalid_input`.
  - Amount-rate epsilon `|effectiveRate × fromAmount − toAmount| < 0.01` → `400 fx_transfer_amount_rate_mismatch`.
  - Future-dated transfer `entry_date > today` → `400 fx_transfer_future_date`. Past-dated allowed (replay handles re-WAC).
  - **Synchronous insufficient-balance pre-check** via live `SUM(amount)` aggregation over `cash_ledger_entries WHERE account_id = $1 AND currency = $2 AND reversal_of_cash_ledger_entry_id IS NULL AND id NOT IN (SELECT reversal_of_cash_ledger_entry_id ...)` (matches KZO-166 D7 reversal-pair filter) → `400 fx_transfer_insufficient_balance` if `available < fromAmount`. Reject before insert; never let the WAC engine throw on this hot path.
  - Account-type behavioral guard: **none in this ticket** (KZO-167 D4: `account_type` is metadata-only).

- **D8. Date/time semantics.** Both legs share `entry_date` (user-entered, defaults to today client-side, validated server-side) and `booked_at = NOW()` at server insert time. `fx_transfer_id` UUID is generated server-side and shared by both legs. All inserts (2 cash_ledger_entries + 1 audit_log row) happen in a single DB transaction.

- **D9. Edit endpoint** `PATCH /fx-transfers/:id`:
  - **Editable fields**: `{fromAmount, toAmount, effectiveRate, entryDate, notes}`. The first three form an **atomic economic triple** — body must include all three together if any of them is provided.
  - **NOT editable**: `fromAccountId`, `toAccountId`, currencies (locked at create; user must reverse + re-create to change accounts).
  - PATCH re-runs full validation: mid-rate tolerance (D6) using new rate + new entryDate's mid-rate; insufficient-balance pre-check using new fromAmount; USD-bridge mid-rate availability if entryDate changed.
  - PATCH triggers `regenerateCurrencyWalletSnapshots(userId)` — full-user replay (KZO-166 path).
  - PATCH writes a diff entry to `audit_log` (`kind: "fx_transfer_updated"`, `details.diff` carries before/after of touched fields).
  - Disallowed on already-reversed transfers → `409 fx_transfer_already_reversed`.
  - Edit-then-reverse allowed; reverse-then-edit rejected.

- **D10. Reversal endpoint** `POST /fx-transfers/:id/reverse`:
  - Full-amount reversal of the **current (post-edit) state**. No partial reversal in v1.
  - Creates two `REVERSAL` entries; each has `reversal_of_cash_ledger_entry_id` → corresponding original leg's `id`.
  - Both reversal entries inherit the original `fx_transfer_id` (D2 service-layer enforcement).
  - Reversal entries' `fx_rate_to_usd` matches the originals (rate value irrelevant — KZO-166 D7 filters reversal pairs out of WAC iteration).
  - Optional `{ reason?: string }` body logged to audit_log.
  - Disallowed if already reversed → `409 fx_transfer_already_reversed` (existence check: `EXISTS (SELECT 1 FROM cash_ledger_entries WHERE fx_transfer_id = $1 AND reversal_of_cash_ledger_entry_id IS NOT NULL)`).

- **D11. SSE event emission.** Reuse existing `recompute_complete` event after wallet snapshot regeneration completes (for create / edit / reverse alike). Payload's `cashBalanceChanges` field carries `[{accountId, currency, delta}]` for both wallets; `holdings` field is empty for FX transfers. **No new event type.** Consumer side: `useEventStream` is preconnected (`enabled: true` per `react-useEventStream-preconnect-pattern.md`); cash-ledger view, dashboard, account-balance widgets refetch on receipt.

- **D12. Cash ledger view changes.**
  - Two adjacent rows per FX transfer (one per leg). Sort `(entry_date DESC, booked_at DESC, id DESC)` ensures adjacency.
  - Each row badge: `FX ↗ Out` / `FX ↘ In` (color-coded amber/emerald). Reversal pair shows existing `REVERSAL` badge with secondary `↺ FX` indicator.
  - Inline secondary line on each FX row: paired account name, paired amount + currency, effective rate as `@ {rate} {destCurrency}/{srcCurrency}`.
  - Backend: `EnrichedCashLedgerEntry` gains optional `fxTransferDetail: { pairedAccountId, pairedAccountName, pairedAmount, pairedCurrency, effectiveRate }`. Postgres + Memory persistence both implement via LEFT JOIN on `fx_transfer_id` filtering out reversal counterparts.
  - Single "FX Transfer" filter chip → `entryType IN ('FX_TRANSFER_OUT','FX_TRANSFER_IN')`. Reversal pairs stay under the existing `REVERSAL` chip.
  - "..." menu on each FX row with "Edit transfer" (opens `RecordFxTransferDialog` in edit mode) and "Reverse transfer" (confirm dialog → POST). Both greyed out on already-reversed pairs.

- **D13. Form UX.**
  - Modal `RecordFxTransferDialog` via Radix `Dialog.Root` + glass-panel pattern (mirrors `RecordTransactionDialog.tsx`). Title "New FX Transfer", subtitle "Move money between accounts of different currencies."
  - Sections per mockup #3: **From** (account dropdown + amount input), **To** (account dropdown + amount input), **Exchange Rate** (numeric input + live SVG gauge + tooltip).
  - Account dropdown options show `{name} (balance: {liveBalance} {currency})`. Live balance source: extend accounts endpoint with `?includeBalances=true` flag → returns per-account per-currency live `SUM(amount)` aggregation (same source as D7 pre-check).
  - **FX gauge**: static SVG with React-driven animated marker position. Color zones: green <2%, amber 2-10%, red >10%. Tooltip shows `Spread: X.X% above/below mid (mid: M; yours: Y)`. Marker animates as user types in the rate input. **No interactive draggability** in v1 — user edits via the input field; marker reflects.
  - **Summary box**: "Effective rate: {rate} {destCurrency}/{srcCurrency}", "{destCurrency} acquired: {toAmount}", "Realized FX impact: {value}". Direction-branched copy: for inflows-into-non-USD show "deferred until {currency} converted back"; for transfers that crystallize show concrete USD value.
  - Buttons: "Cancel" (close, with confirm-discard if fields edited) and "Save Transfer" (disabled while validation pending or hard-block active).

- **D14. Estimate endpoint** `POST /fx-transfers/estimate`:
  - Body: same shape as create (`fromAccountId, toAccountId, fromAmount, toAmount, effectiveRate, entryDate`).
  - Response: `{ realizedFxImpactUsd, midRate, midRateAvailable, midRateProvider, tolerancePct, toleranceState: "safe"|"warn"|"block", fromAccountAvailableBalance, insufficientBalance }`.
  - Reuses service-layer validation; same error vocabulary as create (no separate codes).
  - Form calls on rate / amount / entryDate / account blur to refresh the summary box and gauge.

- **D15. Audit log.** Every create / edit / reverse writes one `audit_log` row:
  ```jsonc
  {
    "actor_user_id": "<uuid>",
    "kind": "fx_transfer_created" | "fx_transfer_updated" | "fx_transfer_reversed",
    "details": {
      "fxTransferId": "<uuid>",
      "fromAccountId": "<id>", "toAccountId": "<id>",
      "fromCurrency": "TWD", "toCurrency": "USD",
      "fromAmount": 1000.00, "toAmount": 32.20,
      "effectiveRate": 0.0322,
      "midRate": 0.0320, "midRateAvailable": true,
      "midRateProvider": "frankfurter",
      "tolerancePct": 0.625, "toleranceState": "safe",
      "decision": "accepted",
      "diff": { /* updates only — before/after of touched fields */ }
    }
  }
  ```

- **D16. Test surface**:
  - **Unit (vitest)**:
    - `apps/api/test/unit/fxTransferService.test.ts` — validation cluster, mid-rate tolerance branches, USD-bridge fallback semantics, edit-then-reverse / reverse-then-edit gating.
    - `apps/api/test/unit/currencyWalletAccounting.test.ts` — extend with new test cases for D3's seed-on-WAC-null branch; **update existing tests** that previously asserted the throw path.
  - **Integration (Postgres-backed, vitest)**:
    - `apps/api/test/integration/fxTransferRoutes.integration.test.ts` — POST/PATCH/POST-reverse against real Postgres. Use `PostgresPersistence` directly per `integration-test-persistence-direct.md`; seed FX rates via raw INSERT.
  - **HTTP/AAA (Playwright API spec)**:
    - `apps/api/test/http/specs/fx-transfer-aaa.http.spec.ts` — full request/response shape, error vocabulary, audit_log writes, estimate endpoint preview.
    - New endpoint class `apps/api/test/http/endpoints/FxTransferEndpoint.ts` + assistant `FxTransferAssistant.ts`.
    - **Register in** `libs/test-api/src/config/mapper.ts` per `test-api-mapper-registration.md`.
  - **E2E (Playwright)**:
    - `apps/web/tests/e2e/specs/fx-transfer-aaa.spec.ts` — full create / edit / reverse flow; mid-rate gauge color states; summary box realized-impact preview; cash ledger view paired-leg display; balance updates via SSE.
  - **Re-stated AC2** (was: "create reverse FX transfer USD → TWD; realized FX P&L crystallizes correctly per WAC"):
    > **AC2 (re-stated)**: 3-step round-trip — TWD→USD #1 (seed/realize), USD→TWD (TWD WAC update), TWD→USD #2 at different rate (realize against weighted WAC). Realized FX P&L lifetime accumulates correctly per the WAC formula across all three steps.

- **D17. FX rate fixture seeding.**
  - New endpoint `POST /__e2e/seed-fx-rates`. Body: `[{ base, quote, date, rate }]`. Gated by `assertE2ESeedEnabled()` (NOT reset guard — must work in `AUTH_MODE=oauth` for HTTP tests). Per `e2e-seed-vs-reset-guards.md`.
  - **Currency-pair-and-date hygiene**: each spec reserves its own non-overlapping date set. Grep before adding new (currency-pair, date) tuples to confirm no collision with existing specs. Document reserved sets in a top-of-file comment per spec.

- **D18. No feature flag.** Feature is fully self-contained behind new endpoints + modal; no existing flow's behaviour changes. KZO-166's WAC engine stays inert until the first FX_TRANSFER row materializes.

## Out of scope (explicit)

- **Edit/delete beyond PATCH + reverse** — no partial reversal, no editable account/currency, no hard-delete. (Hard-delete intersects KZO-81 PII deletion territory.)
- **Per-conversion `fx_rate_provider` column on `cash_ledger_entries`** — KZO-166 D11 deferred this; remains deferred. Provider attribution lives in `audit_log` for KZO-168.
- **Direct TWD↔AUD ingestion into `market_data.fx_rates`** — rely on USD-bridge synthesis (D6) and missing-direct-rate soft-warn for TWD↔AUD prefill.
- **Interactive draggable FX gauge** — static SVG with marker animation in v1; defer drag interaction.
- **Sub-currency precision** — uniform `NUMERIC(20, 2)` per KZO-166. TWD has no fractional unit by convention but stored as 2dp.
- **Tax reporting / cost-basis-method controls** — project-level out-of-scope.
- **Mockup #3's exact visual polish beyond the locked behaviours** — implement the structural decisions; stylistic refinement is a follow-up if requested.

## Acceptance criteria mapping

| AC (from ticket / re-stated) | Where satisfied |
|---|---|
| **AC1.** TWD→USD creates 2 ledger entries, balances update, realized FX = 0 | E2E spec scenario 1 + integration test on `createFxTransfer` |
| **AC2 (re-stated).** 3-step round-trip realizes against WAC correctly | E2E spec scenario 2 + integration test exercising `applyEntryToWalletState` via 3 sequential transfers |
| **AC3.** Mid-rate validation: 1.5% no-warn / 3% soft-warn / 12% blocked | Service-layer unit tests + estimate endpoint HTTP spec |
| **AC4.** Form matches mockup #3 visually (gauge, tooltips, summary box) | E2E visual + DOM-assertion checks; mockup HTML at `docs/004-notes/kzo-168/mockup-202604291700-fx-transfer-form.html` |
| **AC5.** Cash ledger view shows FX_TRANSFER entries with both legs grouped | E2E spec scenario 3 + cash-ledger integration test for `EnrichedCashLedgerEntry.fxTransferDetail` |

## Implementation Steps

### Phase 1 — Migration

- [ ] Create `db/migrations/043_kzo168_fx_transfer.sql`. Idempotent. Steps:
  1. `ALTER TABLE cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_entry_type_check; ALTER TABLE cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_entry_type_check CHECK (entry_type IN ('TRADE_SETTLEMENT_IN','TRADE_SETTLEMENT_OUT','DIVIDEND_RECEIPT','DIVIDEND_DEDUCTION','MANUAL_ADJUSTMENT','REVERSAL','FX_TRANSFER_OUT','FX_TRANSFER_IN'));`
  2. Refine the conditional checks (`cash_ledger_entries_check{N}` at migration 003 lines 122-141) so FX_TRANSFER_* rows behave like MANUAL_ADJUSTMENT/REVERSAL with respect to trade_event and dividend-ledger link requirements: drop and re-add with FX_TRANSFER_OUT and FX_TRANSFER_IN added to the exemption set.
  3. `ALTER TABLE cash_ledger_entries ADD COLUMN IF NOT EXISTS fx_transfer_id UUID;`
  4. `ALTER TABLE cash_ledger_entries ADD CONSTRAINT IF NOT EXISTS ck_fx_transfer_id_entry_type CHECK (fx_transfer_id IS NULL OR entry_type IN ('FX_TRANSFER_OUT','FX_TRANSFER_IN','REVERSAL'));` (use `DO $$` constraint guard since `IF NOT EXISTS` on `ADD CONSTRAINT` isn't supported on all in-scope Postgres versions).
  5. `CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_ledger_fx_transfer_leg_originals ON cash_ledger_entries (fx_transfer_id, entry_type) WHERE fx_transfer_id IS NOT NULL AND reversal_of_cash_ledger_entry_id IS NULL;`
- [ ] Extend `apps/api/test/integration/postgres-migrations.integration.test.ts` with assertions for: new entry_type values accepted; `fx_transfer_id` column + CHECK present; partial UNIQUE present and enforces invariant.

### Phase 2 — Persistence layer

- [ ] Add `'FX_TRANSFER_OUT' | 'FX_TRANSFER_IN'` to `CashLedgerEntryType` union in `apps/api/src/types/store.ts`.
- [ ] Add `fxTransferId?: string | null` to `CashLedgerEntry` row type and `CashLedgerEntryForWalletReplay` shape in `apps/api/src/persistence/types.ts`.
- [ ] Update `MemoryPersistence` and `PostgresPersistence` insert/select paths for `cash_ledger_entries` to round-trip `fx_transfer_id`. Audit all 5+ INSERT and 2+ SELECT sites (similar to KZO-166 Phase 2's `fx_rate_to_usd` round-trip).
- [ ] Add `getFxTransferById(userId: string, fxTransferId: string): Promise<{ legs: CashLedgerEntry[]; reversed: boolean } | null>` to the `Persistence` interface. Used by PATCH and reverse handlers.
- [ ] Add `getAccountAvailableBalance(accountId: string, currency: string): Promise<number>` to the `Persistence` interface — live `SUM(amount)` aggregation with KZO-166 D7 reversal-pair filter applied. Used by D7 pre-check + D14 estimate endpoint.
- [ ] Extend the cash-ledger query that returns `EnrichedCashLedgerEntry` to LEFT JOIN on `fx_transfer_id` (filtering out reversal counterparts) and populate `fxTransferDetail`. Memory persistence mirrors with an in-memory paired-leg lookup.

### Phase 3 — Service module: `fxTransferService.ts`

- [ ] Create `apps/api/src/services/fxTransferService.ts`. Public API:
  ```ts
  export async function createFxTransfer(persistence: Persistence, userId: string, input: CreateFxTransferInput): Promise<{ fxTransferId: string; legOutId: string; legInId: string }>;
  export async function updateFxTransfer(persistence: Persistence, userId: string, fxTransferId: string, patch: UpdateFxTransferInput): Promise<{ fxTransferId: string; legOutId: string; legInId: string }>;
  export async function reverseFxTransfer(persistence: Persistence, userId: string, fxTransferId: string, opts: { reason?: string }): Promise<{ reversalLegOutId: string; reversalLegInId: string; fxTransferIdReversed: string }>;
  export async function estimateFxTransfer(persistence: Persistence, userId: string, input: CreateFxTransferInput): Promise<EstimateResult>;
  ```
- [ ] Validation helpers (pure, unit-testable):
  - `validateAccountPair(fromAccount, toAccount)` — same-account, same-currency, ownership.
  - `validateAmountRateEpsilon(fromAmount, toAmount, effectiveRate)` — `< 0.01` epsilon.
  - `validateMidRateTolerance(effectiveRate, midRate)` — returns `{ tolerancePct, state: "safe" | "warn" | "block" }`.
  - `deriveFxRateToUsdForLeg(legCurrency, legAmount, otherLegCurrency, otherLegAmount, midUsdPerOtherCurrency)` — D5 generalized formula. Returns `1.0` for USD legs by short-circuit.
- [ ] Service flow (`createFxTransfer`):
  1. Zod-validate input (amounts > 0, dates ISO, etc.).
  2. Read both accounts; assert ownership + different currencies + different ids; same user.
  3. Read live balance for from-account/from-currency; assert `available >= fromAmount`.
  4. Compute `midDirectRate = getFxRate(fromCurrency, toCurrency, entryDate)` (may be null); compute tolerance; if state = "block", reject with `400 fx_transfer_rate_out_of_tolerance`.
  5. Compute USD-bridge mid-rates (`midUsdPerSource`, `midUsdPerDest`) for non-USD legs; if any required bridge missing, reject with `400 fx_rate_unavailable` from typed `MissingFxRateError`.
  6. Generate `fxTransferId` (UUID) and `outLegId`, `inLegId` (UUIDs).
  7. Stamp `fx_rate_to_usd` per leg via `deriveFxRateToUsdForLeg`.
  8. In a single DB transaction: insert OUT leg → insert IN leg → write `audit_log` row (D15).
  9. Trigger `regenerateCurrencyWalletSnapshots(userId)` (per-user full-replace, KZO-166 path).
  10. Publish `recompute_complete` SSE event with both wallet deltas.
  11. Return `{ fxTransferId, legOutId, legInId }`.
- [ ] Service flow (`updateFxTransfer`): re-run all validation steps with patched fields; if reversed, reject `409 fx_transfer_already_reversed`; UPDATE both legs in tx; write audit_log diff; regenerate snapshots; publish SSE.
- [ ] Service flow (`reverseFxTransfer`): assert not already reversed; INSERT two REVERSAL rows in tx (each carries `reversal_of_cash_ledger_entry_id` pointing at original; both inherit `fx_transfer_id`); write audit_log; regenerate snapshots; publish SSE.
- [ ] Service flow (`estimateFxTransfer`): same validation as create but no inserts. Returns the preview shape (D14).
- [ ] All errors via `routeError(status, code, message)` per `service-error-pattern.md`. Typed `MissingFxRateError` / `InsufficientWalletBalanceError` (already in KZO-166) caught at route boundary and mapped.

### Phase 4 — WAC engine semantic change (D3)

- [ ] In `apps/api/src/services/currencyWalletAccounting.ts`, in `applyEntryToWalletState` Case C, ahead of the existing `prev.wacFxToUsd === null` throw, insert:
  ```ts
  if (prev.wacFxToUsd === null && prev.balance + amount > 0) {
    return {
      balance: roundToDecimal(prev.balance + amount, 2),
      wacFxToUsd: fxRateToUsd,           // seed for future outflows
      realizedFxPnlLifetime: prev.realizedFxPnlLifetime,
    };
  }
  ```
- [ ] **Update existing tests** in `apps/api/test/unit/currencyWalletAccounting.test.ts` and `apps/api/test/integration/currency-wallet-wac.integration.test.ts`. Audit:
  - Every assertion that `WAC=null + outflow → throws` must distinguish `balance + amount < 0` (still throws) from `balance + amount > 0` (now seeds).
  - Add new test cases for the seeding branch (first transfer establishes WAC, second transfer realizes against seeded WAC).
- [ ] Add a JSDoc note on the modified Case C explaining the KZO-168-introduced branch and the rationale (first-FX-outflow seeding).

### Phase 5 — Routes

- [ ] Register routes in `apps/api/src/routes/registerRoutes.ts`:
  - `POST /fx-transfers` → `createFxTransfer`.
  - `POST /fx-transfers/estimate` → `estimateFxTransfer`. Read-only; same auth gate.
  - `PATCH /fx-transfers/:id` → `updateFxTransfer`.
  - `POST /fx-transfers/:id/reverse` → `reverseFxTransfer`.
- [ ] Auth: `requireSession` / dev_bypass-aware (matches existing trade-event routes). All routes scope to caller's user.
- [ ] Zod schemas at the route boundary (delegated to a shared `fxTransferSchemas.ts` so estimate + create share validation).
- [ ] `/__e2e/seed-fx-rates` endpoint (D17) — gated by `assertE2ESeedEnabled()`.

### Phase 6 — Frontend service + hooks

- [ ] `apps/web/features/fx-transfer/services/fxTransferService.ts` — `createFxTransfer`, `estimateFxTransfer`, `updateFxTransfer`, `reverseFxTransfer` thin fetch wrappers.
- [ ] `apps/web/features/fx-transfer/hooks/useFxTransferEstimate.ts` — debounced `POST /fx-transfers/estimate` on rate / amount / entryDate / account changes; returns `{ estimate, loading, error }`.
- [ ] Extend `apps/web/features/accounts/services/accountsService.ts` to support `?includeBalances=true` flag; new shape includes `liveBalance: { currency: string; amount: number }[]` per account.

### Phase 7 — Frontend modal: `RecordFxTransferDialog`

- [ ] `apps/web/components/fx-transfer/RecordFxTransferDialog.tsx` — Radix `Dialog.Root` + glass-panel; mirrors `RecordTransactionDialog`. Title + subtitle from i18n.
- [ ] `apps/web/components/fx-transfer/AddFxTransferCard.tsx` — form body with three sections (From, To, Exchange Rate). Each section's account dropdown shows `{name} (balance: {liveBalance} {currency})`.
- [ ] `apps/web/components/fx-transfer/FxRateGauge.tsx` — static SVG gauge with React-driven animated marker; color zones via Tailwind classes; tooltip via existing `TooltipInfo` or equivalent.
- [ ] `apps/web/components/fx-transfer/FxTransferSummaryBox.tsx` — bottom panel showing effective rate, destination amount, realized FX impact (consumes `useFxTransferEstimate` output). Direction-branched copy for "deferred" vs concrete value.
- [ ] Mid-rate prefill: derive from `useFxTransferEstimate.midRate` (returned by estimate endpoint). If `midRateAvailable === false` AND non-direct-USD pair, synthesize via secondary `getFxRate` calls (or extend estimate endpoint to surface `midRateSynthesized: boolean` + `synthesizedFromUsdBridge: boolean` flags). Show "★ derived rate" badge.
- [ ] Per `nextjs-i18n-serialization.md`: any helper that branches on direction (e.g. `formatRealizedImpactCopy`) lives outside the i18n dictionary as a pure helper; dictionary holds string templates with `{placeholder}` tokens.

### Phase 8 — Cash ledger view enrichment

- [ ] `apps/web/features/cash-ledger/types.ts` — add `'FX_TRANSFER_OUT' | 'FX_TRANSFER_IN'` to entry-type union; add `fxTransferDetail?: FxTransferDetail` to `EnrichedCashLedgerEntry`.
- [ ] `apps/web/features/cash-ledger/CashLedgerClient.tsx` — render FX badge + paired-leg secondary line for the new entry types. Add "FX Transfer" filter chip (toggles both _OUT and _IN values in the entryType filter array).
- [ ] Add "..." menu on each FX_TRANSFER_* row with "Edit transfer" (opens `RecordFxTransferDialog` in edit mode) and "Reverse transfer" (confirm dialog → POST). Greyed out / hidden if reversed.
- [ ] i18n entries for badge labels, paired-leg secondary line template, rate template, filter chip label, menu items.

### Phase 9 — Tests

- [ ] **Unit** — `apps/api/test/unit/fxTransferService.test.ts` covering all D7 validations + D6 tolerance branches + D5 derivation + D9 edit gating + D10 reverse gating.
- [ ] **Unit** — extend `apps/api/test/unit/currencyWalletAccounting.test.ts` per Phase 4.
- [ ] **Integration** — `apps/api/test/integration/fxTransferRoutes.integration.test.ts` Postgres-backed via `PostgresPersistence` direct (per `integration-test-persistence-direct.md`). Seed FX rates via raw INSERT with deterministic ids per `integration-test-persistence-direct.md` retention-cron pattern. Cover: D2 partial UNIQUE enforcement; CHECK constraint rejects `fx_transfer_id` on disallowed entry types; reversal pairs share `fx_transfer_id`; balance pre-check rejects sync.
- [ ] **HTTP/AAA** — `apps/api/test/http/specs/fx-transfer-aaa.http.spec.ts` + `apps/api/test/http/endpoints/FxTransferEndpoint.ts` + `apps/api/test/http/assistants/FxTransferAssistant.ts` + register in `libs/test-api/src/config/mapper.ts` (per `test-api-mapper-registration.md`). Cover all four endpoints + audit_log writes + estimate preview shape.
- [ ] **E2E** — `apps/web/tests/e2e/specs/fx-transfer-aaa.spec.ts`. Scenarios:
  1. TWD→USD create: form opens, rate prefilled, gauge green, summary shows "deferred", submit, cash ledger updates with paired rows.
  2. 3-step round-trip (re-stated AC2): TWD→USD #1, USD→TWD, TWD→USD #2. Assert realized FX P&L lifetime accumulates correctly (visible on dashboard or fetched via API).
  3. Mid-rate gauge color states: 1.5% (green), 3% (amber + warning banner), 12% (red + submit disabled).
  4. Edit flow: create → edit fromAmount → assert wallet balance updates via SSE.
  5. Reverse flow: create → reverse → assert REVERSAL pair appears in ledger, original greyed.
  6. TWD↔AUD with synthesized direct rate: form shows "★ derived rate" badge; tolerance band informational.
- [ ] FX-rate fixture seeding via `/__e2e/seed-fx-rates` (D17). Reserve dates `2026-04-01..2026-04-10` for FX-transfer specs; document in top-of-file comment.

### Phase 10 — i18n + docs

- [ ] Add new dictionary entries for: form title/subtitle, section labels, button labels, error messages, gauge tooltip, summary box copy (direction-branched templates), badge labels, filter chip label, audit-log notification copy.
- [ ] Update `docs/001-architecture/backend-db-api.md` with FX_TRANSFER lifecycle: create → snapshot regeneration → SSE; PATCH and reverse paths.
- [ ] Add transition note `docs/004-notes/kzo-168/transition-{datetime}-fx-transfer.md` summarizing the WAC engine semantic change (D3) and the producer-side activation of `fx_rate_to_usd` for downstream readers.
- [ ] PR description draft per `pr-bound-docs-review-compliance.md`: `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block listing all 8 suite results), `## Risk/Rollback` sections.

### Phase 11 — Pre-PR gates

- [ ] Run `/code-reviewer` per `code-review-before-pr.md` (this ticket touches well over 5 files).
- [ ] Run full test suite: `npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`. All 8 suites green.
- [ ] Verify migration applies cleanly to a fresh dev DB and to the existing dev DB (idempotent).
- [ ] Confirm no orphan dev-server processes per `validator-process-hygiene.md`.
- [ ] Verify `git log --oneline` follows `commit-format.md` (`type(scope): KZO-168: subject`).

## Open Items

(none — scope locked cleanly without Phase 2 debate)

## References

- **Linear:** KZO-168 — https://linear.app/kzokv/issue/KZO-168/fx-transfer-transaction-type-form
- **Companion tickets**: KZO-166 (WAC engine — producer activates here), KZO-167 (account default_currency — prerequisite), KZO-180 (reporting currency — read-time consumer), KZO-176 (Dashboard Pattern C — downstream consumer of realized FX P&L).
- **Mockup**: `docs/004-notes/kzo-168/mockup-202604291700-fx-transfer-form.html` (generated alongside this scope-todo)
- **Project**: International Markets — US & AU Expansion — https://linear.app/kzokv/project/international-markets-us-and-au-expansion-1665772947f0
