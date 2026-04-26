---
slug: kzo-165
source: scope-grill
created: 2026-04-26
tickets: [KZO-165]
required_reading: []
superseded_by: null
---

# Todo: KZO-165 — Snapshot schema migration (per-currency + FX columns)

> **For agents starting a fresh session:** this file is the sole handoff artifact. Read this scope-todo plus the Linear ticket KZO-165 description (the `## Locked Scope` section appended via this session) before starting implementation. Companion files for context: `apps/api/src/services/snapshotGeneration.ts`, `apps/api/src/persistence/postgres.ts:2551-2710` (snapshot writers/readers), `apps/api/src/persistence/types.ts:335-404` (HoldingSnapshot + SnapshotTradeInput), `db/migrations/028_daily_holding_snapshots.sql`, `db/migrations/037_kzo164_fx_rates.sql`, `.claude/rules/replay-position-history-invariants.md`, `.claude/rules/migration-strategy.md`, `.claude/rules/integration-test-persistence-direct.md`, `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`.

## Context (one-paragraph framing)

This ticket adds the schema scaffolding for multi-currency snapshot reporting. It does NOT add WAC math, realized FX P&L crystallization, or read-side dashboard work — those live in KZO-166 (writer) and KZO-176 (reader). The intent is: ship a migration + minimal write-side stamp + minimal wallet-table writer so KZO-166 has a table to populate and KZO-176 has a column shape to read.

## Decisions (locked via scope-grill 2026-04-26)

- **D1.** `account_id` is `TEXT` (correcting ticket UUID typo).
- **D2.** Existing `daily_holding_snapshots.currency` column is promoted in-place to mean native currency. No separate `currency_native` column. Tighten to `CHAR(3)` + ISO CHECK; drop `DEFAULT 'TWD'`.
- **D3.** Snapshot-write update site is `apps/api/src/services/snapshotGeneration.ts` + persistence layers, NOT `replayPositionHistory.ts` (ticket misnamed the file; replay does not write snapshots).
- **D4.** `SnapshotTradeInput` gains `priceCurrency`. Walker derives row currency from `trades[0].priceCurrency` and fails fast on mixed-currency-per-(account, ticker).
- **D5.** `currency_wallet_snapshots` writer is a minimal aggregator stub in this ticket. Real WAC + FX writer is KZO-166.
- **D6.** Legacy `cost_basis` / `market_value` / `unrealized_pnl` columns are dual-written at native value. Drop scheduled for KZO-176.
- **D7.** `currency_wallet_snapshots` carries `user_id` + composite FK; PK remains `(account_id, currency, date)`.
- **D8.** Single secondary index `idx_currency_wallet_snapshots_user_date ON (user_id, date DESC)`.
- **D9.** Column precisions: `value_native NUMERIC(20, 4)`, `cost_basis_native` / `unrealized_pnl_native` / `balance_native` / `realized_fx_pnl_lifetime` `NUMERIC(20, 2)`, `wac_fx_to_usd NUMERIC(20, 8)`.
- **D10.** `provider_source` on holding snapshots denormalizes `daily_bars.source` for the bar that supplied `close_price`. NULL on provisional rows; backfill literal `'finmind'` for existing rows. NULL on wallet-stub rows.
- **D11.** Migration filename `038_kzo165_snapshot_multi_currency.sql`, idempotent.
- **D12.** Hard-purge cascade and `demoCleanup.ts` extended for `currency_wallet_snapshots`.
- **D13.** Tests: unit + Postgres-backed integration + migration walk. Pick a previously-unused ticker (grep-verify before writing).
- **D14.** Replay invariants preserved trivially by non-edit (replay file untouched).

## Implementation Steps

### Phase 1 — Migration

- [x] Create `db/migrations/038_kzo165_snapshot_multi_currency.sql` per scope §11. Use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `DO $$ ... END $$` for idempotency. Order:
  1. `ALTER TABLE daily_holding_snapshots ADD COLUMN ...` (value_native, cost_basis_native, unrealized_pnl_native, provider_source).
  2. `UPDATE daily_holding_snapshots SET value_native = COALESCE(market_value, 0), cost_basis_native = cost_basis, unrealized_pnl_native = unrealized_pnl, provider_source = 'finmind' WHERE provider_source IS NULL;` (idempotent guard).
  3. `ALTER TABLE daily_holding_snapshots ALTER COLUMN currency TYPE CHAR(3) USING UPPER(LEFT(currency, 3));`
  4. `ALTER TABLE daily_holding_snapshots ALTER COLUMN currency DROP DEFAULT;`
  5. `ALTER TABLE daily_holding_snapshots ADD CONSTRAINT IF NOT EXISTS ck_daily_holding_snapshots_currency_iso CHECK (currency ~ '^[A-Z]{3}$');`
  6. `CREATE TABLE IF NOT EXISTS currency_wallet_snapshots (...)` with composite FK to `accounts(id, user_id)` and ISO CHECK on `currency`.
  7. `CREATE INDEX IF NOT EXISTS idx_currency_wallet_snapshots_user_date ...`.
- [x] Verify migration walks cleanly in `apps/api/test/integration/postgres-migrations.integration.test.ts` (extend existing test pattern).

### Phase 2 — Persistence layer

- [x] `apps/api/src/persistence/types.ts`:
  - Extend `HoldingSnapshot` interface with `valueNative: number`, `costBasisNative: number`, `unrealizedPnlNative: number | null`, `providerSource: string | null`. Existing `currency: string` retained but documented as native.
  - Extend `SnapshotTradeInput` with `priceCurrency: string`.
  - Add `CurrencyWalletSnapshot` interface (`userId`, `accountId`, `currency`, `date`, `balanceNative`, `wacFxToUsd: number | null`, `realizedFxPnlLifetime: number`, `providerSource: string | null`).
  - Add `Persistence` interface methods: `bulkUpsertCurrencyWalletSnapshots(userId, snapshots[])`, `deleteAllCurrencyWalletSnapshots(userId)`, `getCurrencyWalletSnapshotsForAccount(userId, accountId, startDate, endDate)`.
- [x] `apps/api/src/persistence/postgres.ts`:
  - `getSnapshotGenerationInputs` SELECT projection: add `price_currency`. Map to camelCase in row builder.
  - `bulkUpsertHoldingSnapshots`: extend INSERT column list, UNNEST array list, ON CONFLICT DO UPDATE SET clause for the four new columns. Dual-write `cost_basis`/`market_value`/`unrealized_pnl` from the native source values per D6.
  - `getHoldingSnapshotsForTicker` SELECT projection: add new columns; map to camelCase.
  - `getAggregatedSnapshots` LEFT UNTOUCHED (D6 + KZO-176 owns this rewrite).
  - `hardPurgeUser` (line ~6210): add `DELETE FROM currency_wallet_snapshots WHERE account_id = ANY($1)` in the same transaction immediately after the daily_holding_snapshots delete.
  - Implement `bulkUpsertCurrencyWalletSnapshots`, `deleteAllCurrencyWalletSnapshots`, `getCurrencyWalletSnapshotsForAccount` (mirrors `bulkUpsertHoldingSnapshots` UNNEST pattern).
- [x] `apps/api/src/persistence/memory.ts`:
  - Mirror all above (in-memory store for `currencyWalletSnapshots: CurrencyWalletSnapshot[]`).
  - `getSnapshotGenerationInputs` builds `SnapshotTradeInput` from in-memory trade events; include `priceCurrency` from each `BookedTradeEvent`.
  - `_seedCurrencyWalletSnapshots` test helper (mirror `_seedHoldingSnapshots`).
- [x] `apps/api/src/services/demoCleanup.ts:29`: add `await client.query("DELETE FROM currency_wallet_snapshots WHERE user_id = ANY($1)", [userIds]);` after the existing daily_holding_snapshots delete.

### Phase 3 — Snapshot writer (`snapshotGeneration.ts`)

- [x] `walkPositionHistory`:
  - Validate single `priceCurrency` across all `trades`. Throw `routeError(500, "snapshot_mixed_currency", ...)` shape error if not (instrument should have one quote currency — mixed is an upstream data bug).
  - Replace `currency: "TWD"` hardcode with `currency: trades[0].priceCurrency`.
  - Compute `valueNative = roundToDecimal(closePrice * quantity, 4)` (using bar precision). NULL when `closePrice` is null.
  - Compute `costBasisNative = costBasis` (already accumulated in native via the existing walker).
  - Compute `unrealizedPnlNative = valueNative !== null ? roundToDecimal(valueNative - costBasisNative, 2) : null`.
  - Set `providerSource = bar?.source ?? null`.
  - Per D6: ALSO set the legacy fields `marketValue = valueNative`, `costBasis = costBasisNative`, `unrealizedPnl = unrealizedPnlNative` to the same values (no behavioral change for TWD-only data; sets the precedent for the dual-write rule).

### Phase 4 — Currency wallet stub writer (NEW file)

- [x] `apps/api/src/services/currencyWalletSnapshotGeneration.ts`:
  - Export `generateCurrencyWalletSnapshots(userId: string, persistence: Persistence): Promise<{ totalRows: number }>`.
  - Aggregator query (Postgres path delegated through persistence — do NOT inline raw SQL in the service):
    - Add `getCashLedgerEntriesForBalances(userId)` to persistence (returns trimmed shape: `{ accountId, currency, entryDate, amount }`).
    - Service walks entries grouped by `(accountId, currency)`, computes running balance, emits one row per `(accountId, currency, date-with-activity)`.
  - FX columns: `wacFxToUsd = null`, `realizedFxPnlLifetime = 0`, `providerSource = null` for every stub row.
  - Use a fresh `generationRunId` analogous to `generateHoldingSnapshots`.
  - Calls `deleteAllCurrencyWalletSnapshots(userId)` then `bulkUpsertCurrencyWalletSnapshots(userId, snapshots)`.
- [x] `apps/api/src/routes/registerRoutes.ts`: invoke `generateCurrencyWalletSnapshots` in the same handler bodies that already call `generateHoldingSnapshots` (~lines 3321 and 3413). Run sequentially after the holding snapshots write so failures are isolated and observable.

### Phase 5 — Tests

- [x] Pick a previously-unused ticker for new bar-seeding tests. Pre-flight grep:
  ```bash
  grep -rn '"<TICKER>"' apps/web/tests/e2e/specs/ apps/web/tests/e2e/specs-oauth/ apps/api/test/http/specs/ apps/api/test/integration/
  ```
  Currently reserved (avoid): 2330, 2454, 0050, 00919, 2317, 6770, 5880, 6669. Recommended candidate: `1101` or `2603` (verify before use).
- [x] Extend `apps/api/test/unit/snapshotGeneration.test.ts`:
  - Assert new `*_native` columns are populated correctly for a TWD-only setup.
  - Assert `providerSource` reflects `bar.source`.
  - New test: mixed-currency trades for the same `(account, ticker)` produce a thrown error from `walkPositionHistory`.
  - Assert dual-write rule: `valueNative === marketValue`, `costBasisNative === costBasis`, `unrealizedPnlNative === unrealizedPnl`.
- [x] New `apps/api/test/unit/currencyWalletSnapshotGeneration.test.ts`:
  - Seed two TWD `cashLedgerEntries` for one account on two dates; run aggregator; assert two `currency_wallet_snapshots` rows with correct running balance.
  - Two accounts, same currency: distinct wallet rows per account.
  - Same account, multiple currencies: distinct wallet rows per currency.
  - FX columns are `null/0/null` on every stub row.
- [x] New `apps/api/test/integration/snapshots-multi-currency.integration.test.ts` (Postgres-backed per `integration-test-persistence-direct.md`):
  - Apply migration 038 fresh.
  - Insert pre-migration-shape rows directly via SQL; apply the migration; assert backfill correctness (`value_native`, `cost_basis_native`, `unrealized_pnl_native`, `provider_source = 'finmind'`).
  - End-to-end through `bulkUpsertHoldingSnapshots` + `getHoldingSnapshotsForTicker`: round-trip new fields.
  - `hardPurgeUser` cascade: assert `currency_wallet_snapshots` rows are deleted when a user is hard-purged.
- [x] New `apps/api/test/integration/currency-wallet-snapshots.integration.test.ts`:
  - Seed real users, accounts, cash_ledger_entries via persistence API; run aggregator; assert wallet rows exist.
  - FK violation test: composite FK `(account_id, user_id)` rejects mismatched pairs (KZO-149 pattern — seed two users, attempt cross-user write).
  - ISO CHECK violation test: writing currency='abc' rejected.
- [x] Extend `apps/api/test/integration/postgres-migrations.integration.test.ts` to walk migration 038 cleanly without divergence.
- [x] Re-run all 8 suites locally per `.claude/rules/full-test-suite.md` before opening PR (`npx eslint . --max-warnings=0 && npm run typecheck && npm run test:all:full`).

### Phase 6 — Documentation & PR

- [x] Update `docs/market-data-platform.md` §4 ("Read Paths") and §10 (or new section) with a paragraph on `currency_wallet_snapshots` + the dual-write rule for legacy columns. Cross-reference KZO-166 and KZO-176 ownership.
- [ ] PR description must include explicitly:
  - "Replay code (`replayPositionHistory.ts`) is not modified. Replay invariants 1–5 are preserved trivially. KZO-166 will verify invariants under its own currency-aware modifications."
  - "Legacy `cost_basis` / `market_value` / `unrealized_pnl` columns dual-written at native value pending KZO-176 dashboard rewrite."
  - "`currency_wallet_snapshots` writer is a minimal aggregator stub. WAC math + realized FX P&L crystallization is owned by KZO-166."
  - Per `.claude/rules/pr-bound-docs-review-compliance.md`, structure with `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block listing each suite's pass count), `## Risk/Rollback`.
- [x] Tick checkboxes in this todo as items ship.

## Open Items

None — all gaps resolved at scope-lock time.

## Out of Scope (do NOT absorb into this ticket)

- WAC math + realized FX P&L crystallization → **KZO-166**
- Dashboard read-path rewrite + multi-currency aggregation + legacy column drop → **KZO-176**
- Historical FX backfill (pre-v1 dates) → **KZO-174**
- Holdings + transactions table multi-market UI → **KZO-175**
- `accounts.default_currency` schema → **KZO-167**
- FX_TRANSFER transaction type → **KZO-168**
- Per-provider health UI / stale-data badges → **KZO-177**

## References

- Linear ticket: https://linear.app/kzokv/issue/KZO-165/snapshot-schema-migration-per-currency-fx-columns
- Sibling tickets: KZO-166, KZO-167, KZO-174, KZO-175, KZO-176
- Architecture: `docs/market-data-platform.md`, `docs/001-architecture/canonical-accounting-model.md`
- Rules: `replay-position-history-invariants.md`, `migration-strategy.md`, `integration-test-persistence-direct.md`, `e2e-shared-memory-bars-ticker-hygiene.md`, `pr-bound-docs-review-compliance.md`, `service-error-pattern.md`, `interface-caller-verification.md`, `commit-format.md`, `full-test-suite.md`
- Precedent migration: `db/migrations/037_kzo164_fx_rates.sql`
