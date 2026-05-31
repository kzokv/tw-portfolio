# Code Review — Phase 3 iter 3 (ui-enhancement)

**Date**: 2026-05-14T04:40:00Z (initial); delta re-review 2026-05-14 (second `[ARCHITECT:GO]`)  
**Reviewer**: Code Reviewer (Tier 3, Claude Sonnet)  
**Branch**: `worktree-ui-enhancement`  
**Activation**: Two explicit `[ARCHITECT:GO]` envelopes

---

## Scope

Iter-3 checklist (8 items, per Architect brief):

1. P1-1 — Route-guard membership (`WRITER_ROLE_ROUTE_KEYS` + `WRITE_CONTEXT_GUARD_ROUTE_KEYS`)
2. P1-2 — Hide-everywhere centralization: 9 account-scoped tables, all read paths filtered
3. P2-2 BE — `effectiveAccountHardPurgeDays` on both user-facing settings DTO endpoints
4. P2-1 FE — `useSettingsForm` draft prune behavior
5. P2-2 FE — `AccountsListSection` 45-day prop unit test
6. Role-guard HTTP spec — ≥8 403 cases, AAA discipline, `body.error` not `body.code`, mapper
7. `accountSoftDeleteReadFilter.integration.test.ts` — ≥7 read paths, `PostgresPersistence` direct
8. `seedAccountWithData` helper — real FeeProfile row, correct column names

---

## Verdict: FIX-REQUIRED

**2 HIGH findings, 1 MEDIUM finding** (delta re-review added HIGH-2 and MEDIUM-1). All other items CLEAN.

---

## HIGH Findings

### HIGH-1 — P1-2: `daily_holding_snapshots` soft-delete filter gap in dashboard performance path

**Severity**: HIGH  
**Files**:
- `apps/api/src/persistence/postgres.ts` lines 2752–2808 (`getSnapshotGenerationInputs`, no-scope path)  
- `apps/api/src/persistence/postgres.ts` lines 2972–3029 (`getAggregatedSnapshotsInReportingCurrency`)  
- `apps/api/src/services/snapshotGeneration.ts` lines 33–68 (`generateHoldingSnapshots`)

**Description**:

Two read paths in `postgres.ts` that underpin the `/dashboard/performance` route lack the `deleted_at IS NULL` filter that P1-2 mandates for all account-scoped tables.

**Path 1 — `getSnapshotGenerationInputs` (no-scope invocation)**

When called without a scope filter (i.e., `userId` only), the SQL reads:
```sql
FROM trade_events WHERE user_id = $1
```
There is no `AND account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)` guard. The dividend join also lacks `AND account.deleted_at IS NULL`. `generateHoldingSnapshots` in `snapshotGeneration.ts` calls this path directly (`persistence.getSnapshotGenerationInputs(userId)`), so snapshot regeneration includes soft-deleted account positions, and regenerated `daily_holding_snapshots` rows reflect soft-deleted account data.

**Path 2 — `getAggregatedSnapshotsInReportingCurrency`**

The SQL reads from `daily_holding_snapshots` with only:
```sql
WHERE s.user_id = $1 AND s.snapshot_date >= $2::date AND s.snapshot_date <= $3::date
```
No join to `accounts WHERE deleted_at IS NULL`. This method is called by `dashboardReportingCurrency.ts:301` (`translatePerformancePoints`) from the `GET /dashboard/performance` route handler.

**Impact**: During the 30/45-day grace period, the dashboard performance graph includes soft-deleted account holdings. This contradicts the PR description's invariant "Soft-deleted accounts hidden from all portfolio views."

**No justification comments** were found in lines 2900–3300 of `postgres.ts` explaining why these two paths intentionally omit the filter (in contrast to `loadStore`, which carries `[active-only filter ADDED]` comments throughout).

**Fix required**:

1. `getSnapshotGenerationInputs` (no-scope): add `AND te.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)` (or equivalent JOIN) to the trade events subquery; add `AND account.deleted_at IS NULL` to the dividend join.

2. `getAggregatedSnapshotsInReportingCurrency`: add `AND EXISTS (SELECT 1 FROM accounts WHERE id = s.account_id AND deleted_at IS NULL)` or equivalent to the `WHERE` clause.

3. **If these paths are intentionally unfiltered** (e.g. snapshot generation must include soft-deleted accounts for archival correctness): add a `-- ui-enhancement: intentionally unfiltered — snapshots include deleted accounts by design [P1-2 exception]` comment at both SQL sites and document the exception in the transition note.

---

### HIGH-2 — P1-2: `getCashLedgerEntriesForWalletReplay` memory/postgres divergence on soft-delete filter

**Severity**: HIGH  
**Files**:
- `apps/api/src/persistence/postgres.ts` lines 2709–2750 (`getCashLedgerEntriesForWalletReplay`)  
- `apps/api/src/persistence/memory.ts` lines 1718–1746 (`getCashLedgerEntriesForWalletReplay`)  
- `apps/api/src/services/currencyWalletSnapshotGeneration.ts` line 58 (caller)

**Description**:

`postgres.ts`'s `getCashLedgerEntriesForWalletReplay` reads:
```sql
FROM cash_ledger_entries c
WHERE user_id = $1
  AND reversal_of_cash_ledger_entry_id IS NULL
  AND NOT EXISTS (...)
```
There is no `AND c.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)` guard.

**Memory/Postgres divergence**: `memory.ts`'s implementation delegates to `loadStore(userId)` (line 1721), which after P1-2 actively filters `deleted_at IS NULL` accounts. Cash ledger entries belonging to soft-deleted accounts are therefore excluded in memory mode but included in Postgres mode.

**Impact**: `currencyWalletSnapshotGeneration.ts:58` calls `getCashLedgerEntriesForWalletReplay(userId)` to build currency wallet snapshots. In Postgres mode, soft-deleted accounts' cash entries feed into wallet balance calculations and resulting wallet snapshots — a portfolio-view path. This is the same class of violation as HIGH-1: a user-visible financial view that includes soft-deleted account data during the grace period.

**Fix required**: Add `AND c.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)` to the `WHERE` clause in `postgres.ts`'s `getCashLedgerEntriesForWalletReplay`.

---

### MEDIUM-1 — P1-1 (security): `POST /accounts/:id/purge` bypasses soft-delete requirement

**Severity**: MEDIUM  
**Files**:
- `apps/api/src/routes/registerRoutes.ts` lines 3109–3134  
- `apps/api/src/persistence/postgres.ts` line 7756 (`hardPurgeAccount` default: `mustBeSoftDeleted: true`)

**Description**:

`hardPurgeAccount`'s persistence-layer default is `mustBeSoftDeleted: true` (line 7756 — safe default). The user-facing `POST /accounts/:id/purge` route explicitly overrides this:

```ts
await app.persistence.hardPurgeAccount(
  params.id,
  userId,
  { actorUserId: userId, ipAddress: req.ip, metadata: {} },
  { mustBeSoftDeleted: false },   // ← bypasses grace period
);
```

The route comment documents this as intentional: "Accepts active OR soft-deleted accounts (mustBeSoftDeleted=false)." The UI only shows the purge button in the recently-deleted section, but the API has no enforcement. A user who knows their account name can call `POST /accounts/:id/purge` directly and permanently delete an active account, bypassing the entire soft-delete grace period.

**Assessment**: The route requires writer role (guarded via `WRITER_ROLE_ROUTE_KEYS`) and typed-name confirmation, so this is not a cross-user exploit. However, it allows account owners to irreversibly bypass a feature the PR explicitly introduces as a user safeguard. The PR description and scope-todo (§ "Account deletion flow") positions soft-delete as a mandatory first step before permanent deletion.

**Architect decision required**: Is `mustBeSoftDeleted: false` on the user-facing purge route intentional design (users can choose to skip the grace period) or should it be `mustBeSoftDeleted: true` (requiring the account to be soft-deleted first)?

If intentional — add a comment explaining why (e.g. "allows immediate purge for users who want to skip the grace period") and document in the transition note.

If unintentional — change to `mustBeSoftDeleted: true` (matching the cron path and the persistence-layer default).

---

## CLEAN Items

### Item 1 — P1-1: Route-guard membership

`WRITER_ROLE_ROUTE_KEYS` (line 429 of `registerRoutes.ts`): contains `"DELETE /accounts/:id"`, `"POST /accounts/:id/restore"`, `"POST /accounts/:id/purge"` (lines 461–463). `GET /accounts/deleted` correctly absent (read path — viewer access allowed).

`WRITE_CONTEXT_GUARD_ROUTE_KEYS` (line 475): same 3 mutation routes at lines 507–509. Lines 501–506 carry an explicit comment documenting why `GET /accounts/deleted` is excluded from this guard set.

**CLEAN.**

---

### Item 3 — P2-2 BE + FE: `effectiveAccountHardPurgeDays`

**Backend**: `getEffectiveAccountHardPurgeDays()` resolver in `apps/api/src/services/appConfig/accountLifecycle.ts` reads `getAppConfigCacheEntry()?.accountHardPurgeDays ?? Env.ACCOUNT_HARD_PURGE_DAYS`. Called at request-time inside both `GET /settings` and `PATCH /settings` route handlers (lines 2276, 2296 of `registerRoutes.ts`) — not captured at registration. Correct pattern.

**Frontend**: `AccountsListSection.tsx` — `effectiveAccountHardPurgeDays?: number` prop (line 98), default 30 (line 176). Countdown at line 480 uses `effectiveAccountHardPurgeDays * 24 * 60 * 60 * 1000`. Header string at line 1120 uses `.replace("{graceDays}", String(effectiveAccountHardPurgeDays))`.

**i18n**: `accountsRecentlyDeletedTitle: "Recently deleted ({count}) · auto-purged after {graceDays} days"` — string template with `{graceDays}` placeholder, no inline function. Compliant with `nextjs-i18n-serialization.md`. zh-TW translation also uses `{graceDays}`.

**CLEAN.**

---

### Item 4 — P2-1 FE: `useSettingsForm` draft prune

`useSettingsForm.ts` lines 144–225: `liveAccountIds` derived from `accounts` prop (line 152). Draft accounts pruned to `liveAccountIds` (line 173). Fee profiles pruned to `accountIdsAfterMerge` (line 182). Bindings pruned to `accountIdsAfterMerge` (line 197). `accountIdsAfterMerge` correctly includes newly-arrived server-confirmed accounts so new accounts are not pruned. All 3 draft layers pruned transitively.

Tests at `useSettingsForm.test.tsx` lines 374 and 426 cover: (1) soft-delete prune removes acc-b from all 3 layers; (2) simultaneous soft-delete + new-account scenario correctly prunes removed and preserves new.

**CLEAN.**

---

### Item 5 — P2-2 FE: 45-day prop unit test

`AccountsListSection.uiEnhancement.test.tsx` lines 406–429: uses `vi.useFakeTimers` / `vi.setSystemTime` for deterministic countdown; renders with `effectiveAccountHardPurgeDays=45`; asserts "45" appears in both `recently-deleted-time-remaining-acc-deleted-1` and `recently-deleted-header`; defensively asserts "30" NOT present in countdown text. Fallback test at lines 431–449 renders with `undefined` and asserts "30".

**CLEAN.**

---

### Item 6 — Role-guard HTTP spec

`account-lifecycle-role-guards-aaa.http.spec.ts`:
- 0 raw `expect()` calls — all assertions via `accountsApi.assert.statusIs(...)` helper. AAA discipline satisfied.
- 6 explicit `403` status assertions: viewer→DELETE (line 56), viewer→restore (line 74), viewer→purge (line 93); grantee→DELETE (line 163), grantee→restore (line 214), grantee→purge (line 257). Plus 2 `200` assertions for the allowed `GET /accounts/deleted` path.
- File header lines 24–25 document: "Read `body.error`, never `body.code`." Compliant with `service-error-pattern.md`.
- `AccountsEndpoint` registered in `libs/test-api/src/config/mapper.ts` at line 46. Per `test-api-mapper-registration.md` requirement.

**CLEAN.**

---

### Item 7 — `accountSoftDeleteReadFilter.integration.test.ts`

`PostgresPersistence` used directly (line 97, via `await import("../../src/persistence/postgres.js")`). No `buildApp` call. Correct pattern per `integration-test-persistence-direct.md`.

8 read paths tested (≥7 required):
1. `loadStore` accounts list excludes soft-deleted (line 115)
2. `getAccountIncludingDeleted` returns soft-deleted row (line 136)
3. `listSoftDeletedAccounts` ordering (line 158)
4. `loadStore.tradeEvents` excludes soft-deleted account's trades (line 284)
5. `loadStore.cashLedgerEntries` excludes soft-deleted account's cash entries (line 296)
6. `loadStore.lots` excludes soft-deleted account's lots (line 308)
7. `listCashLedgerEntries` excludes soft-deleted account's entries (line 320)
8. Negative regression guard: sibling account data survives soft-delete of another (line 354)

Real user seeded via `resolveOrCreateUser` (line 99) — FK-safe for `audit_log` per `integration-test-persistence-direct.md` guidance.

**CLEAN.**

---

### Item 8 — `seedAccountWithData` helper

Located at integration test lines 208–282.

- Real FeeProfile: `createDefaultFeeProfile(account.id, account.defaultCurrency, feeProfileId)` called via `pushAccountWithProfile` (line 44); trade event embeds `feeSnapshot: feeProfile` (line 248) — the actual FeeProfile object, satisfying `saveStore`'s FK write path. ✓
- CashLedgerEntry uses `entryType: "TRADE_SETTLEMENT_OUT"` (not `type`) at line 272. ✓
- CashLedgerEntry includes `userId`, `source`, `sourceReference` (lines 269, 277, 278). ✓
- Lot uses `openQuantity`, `totalCostAmount`, `costCurrency`, `openedAt`, `openedSequence` (lines 257–264). ✓
- Defensive invariant check at lines 223–226 throws if FeeProfile not found. ✓

**CLEAN.**

---

## Summary Table

| # | Item | Severity | Status |
|---|------|----------|--------|
| 1 | P1-1 route-guard membership (WRITER + WRITE_CONTEXT guard sets) | — | CLEAN |
| 1b | P1-1 security: purge route bypasses mustBeSoftDeleted | MEDIUM | **ARCHITECT DECISION** |
| 2a | P1-2 hide-everywhere: snapshot aggregation + getSnapshotGenerationInputs | HIGH | **FIX REQUIRED** |
| 2b | P1-2 hide-everywhere: getCashLedgerEntriesForWalletReplay postgres divergence | HIGH | **FIX REQUIRED** |
| 3 | P2-2 BE+FE effectiveAccountHardPurgeDays | — | CLEAN |
| 4 | P2-1 FE useSettingsForm draft prune | — | CLEAN |
| 5 | P2-2 FE 45-day prop unit test | — | CLEAN |
| 6 | Role-guard HTTP spec | — | CLEAN |
| 7 | Integration test (7 read paths) | — | CLEAN |
| 8 | seedAccountWithData helper | — | CLEAN |

**Total findings**: 2 HIGH, 1 MEDIUM, 0 LOW.

---

## Fix Guidance

### HIGH-1 + HIGH-2 fix pattern

The P1-2 subquery pattern used throughout `loadStore` (`[active-only filter ADDED]`):

```sql
-- getSnapshotGenerationInputs (no-scope path): add to trade_events WHERE clause
AND te.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)

-- Dividend join (no-scope path): add to WHERE
AND account.deleted_at IS NULL

-- getAggregatedSnapshotsInReportingCurrency: add to WHERE
AND s.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)

-- getCashLedgerEntriesForWalletReplay: add to WHERE
AND c.account_id IN (SELECT id FROM accounts WHERE user_id = $1 AND deleted_at IS NULL)
```

Alternatively for any of these: if the method is intentionally all-accounts (e.g. wallet replay needs complete history for accounting correctness): document with `-- ui-enhancement P1-2 exception: intentionally includes soft-deleted accounts — [rationale]` and update the transition note's invariant statement.

Note: HIGH-1 and HIGH-2 are at the persistence layer only — no route changes needed if the SQL is fixed.

### MEDIUM-1 fix (if non-intentional)

```ts
// registerRoutes.ts:3123 — change mustBeSoftDeleted: false to true
await app.persistence.hardPurgeAccount(
  params.id,
  userId,
  { actorUserId: userId, ipAddress: req.ip, metadata: {} },
  { mustBeSoftDeleted: true },   // enforce grace period first
);
```

The integration test in item 7 does NOT yet cover `getAggregatedSnapshotsInReportingCurrency` or `getCashLedgerEntriesForWalletReplay`. If the HIGH-1/2 fixes add filters, add smoke tests to `accountSoftDeleteReadFilter.integration.test.ts` for those paths.
