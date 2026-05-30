# Code Review — Phase 3 iter 5 (ui-enhancement)

**Date**: 2026-05-14T09:00:00Z  
**Reviewer**: Code Reviewer (Tier 3, Claude Sonnet)  
**Branch**: `worktree-ui-enhancement`  
**Activation**: Explicit `[ARCHITECT:GO]` envelope from architect-2  
**Scope**: Iter-5 delta ONLY — 9 new soft-delete filter sites + integration-test QA fixup + holistic grep audit spot-check

---

## Verdict: CLEAN

**0 findings.** All iter-5 delta items pass. Holistic audit confirms no residual unfiltered user-facing read paths.

---

## Delta Checklist — All CLEAN

### A. `postgres.ts` — Directed fixes (HIGH + MEDIUM from iter-4 holistic audit)

#### A1 — HIGH: `getMonitoredSet` positions CTE (line ~6855)

```sql
WHERE a.user_id = $1 AND a.deleted_at IS NULL AND l.open_quantity > 0
```

`[active-only filter ADDED]` comment at lines 6851–6854 citing the daily-refresh enqueue concern. Filter is on the `positions` CTE's WHERE clause — correctly gates the JOIN via `accounts a` on both `a.user_id = $1` AND `a.deleted_at IS NULL`. Manual-selection CTE (`user_monitored_tickers`) is unaffected (manually-pinned tickers are not account-scoped).

**CLEAN.** ✓

#### A2 — MEDIUM: `listDividendLedgerYears` (line ~4693)

```sql
WHERE account.user_id = $1
  -- ui-enhancement — exclude years derived solely from dividends on
  -- soft-deleted accounts. [active-only filter ADDED]
  AND account.deleted_at IS NULL
  AND event.payment_date IS NOT NULL
  AND dle.superseded_at IS NULL
  AND dle.reversal_of_dividend_ledger_entry_id IS NULL
  AND NOT EXISTS (...)
```

Filter correctly placed before the `ORDER BY 1 DESC`. The `AND NOT EXISTS` reversal guard and `AND dle.superseded_at IS NULL` are structurally orthogonal to the deleted_at filter — no interaction issues.

**CLEAN.** ✓

---

### B. `postgres.ts` — Defensive fixes (holistic audit — 7 sites)

#### B1 — `getAllMonitoredTickers` (line ~6910)

```sql
FROM lots l
JOIN accounts a ON a.id = l.account_id
-- ui-enhancement — exclude positions in soft-deleted accounts from
-- the global monitored set (daily-refresh cron input).
-- [active-only filter ADDED]
WHERE a.deleted_at IS NULL AND l.open_quantity > 0
```

System-internal cron function (no `userId` scope) — flagged INFORMATIONAL in iter-4. Defensive filter added anyway, which is correct hygiene: soft-deleted accounts' lots should not influence the global backfill enqueue. No caller-facing impact.

**CLEAN.** ✓

#### B2 — `getUsersMonitoringTicker` (line ~6957)

```sql
FROM lots l
JOIN accounts a ON a.id = l.account_id
-- ui-enhancement — hide soft-deleted accounts' positions from the
-- "who monitors this ticker?" fan-out used by backfill notifications.
-- [active-only filter ADDED]
WHERE l.ticker = $1 AND l.open_quantity > 0 AND a.deleted_at IS NULL
```

Fan-out for backfill notifications. Defensive filter prevents notifications reaching users about soft-deleted accounts' tickers.

**CLEAN.** ✓

#### B3–B7 — Five dividend-ledger ownership/recompute lookups

All five sites verified — each `JOIN accounts AS account` carries `AND account.deleted_at IS NULL`:

| Site | Line | Function | Guard present |
|------|------|----------|---------------|
| B3 | ~3781 | `replaceDividendSourceLinesForLedger` ownership check | `AND account.deleted_at IS NULL` ✓ |
| B4 | ~3842 | `findDividendLedgerEntryById` | `AND account.deleted_at IS NULL` ✓ |
| B5 | ~3942 | `updateReconciliationStatus` FOR UPDATE | `AND account.deleted_at IS NULL` ✓ |
| B6 | ~4007 | `updatePostedCashDividend` FOR UPDATE | `AND account.deleted_at IS NULL` ✓ |
| B7 | ~4231 | `applyDividendLedgerRecompute` FOR UPDATE | `AND account.deleted_at IS NULL` ✓ |

These are write-path ownership checks. Adding `deleted_at IS NULL` here is correct: mutation routes should reject writes targeting soft-deleted accounts. All sites call `FOR UPDATE OF dle` and throw `routeError(404, "dividend_ledger_entry_not_found")` when the ownership check returns 0 rows — the soft-delete filter effectively surfaces as a 404 for any mutation attempt on a soft-deleted account's dividend entry. This is the correct UX behavior.

**CLEAN.** ✓

#### B8 — `listDividendLedgerScopes` (line ~4195)

```sql
WHERE dle.superseded_at IS NULL
  AND dle.reversal_of_dividend_ledger_entry_id IS NULL
  -- ui-enhancement — startup recompute scope skips soft-deleted
  -- accounts. They will resume recompute on restore.
  -- [active-only filter ADDED]
  AND a.deleted_at IS NULL
```

Startup recompute scope — drives the dividend-ledger recompute walker at boot. Excluding soft-deleted accounts here is correct and desirable: no need to recompute expected values for accounts the user has retired (they'll be re-included on restore). Comment explains the design intent.

**CLEAN.** ✓

#### B9 — `listUserAccountIds` critical fix (line ~5242)

```ts
private async listUserAccountIds(client: PoolClient, userId: string): Promise<string[]> {
  // ui-enhancement: only ACTIVE accounts. saveAccountingStoreTx uses this
  // list to scope its DELETE-then-INSERT round-trip on dividend/lot tables.
  // Including soft-deleted IDs here would silently wipe their accounting
  // data on every recompute call (the active in-memory accounting.facts
  // doesn't carry rows for those accounts). [active-only filter ADDED]
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM accounts
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY id`,
    [userId],
  );
```

This is the most critical fix in iter-5. `saveAccountingStoreTx` uses `accountIds` (from this function) to scope its DELETE-then-INSERT pattern on `dividend_ledger_entries` and related tables:

```ts
await client.query(`DELETE FROM dividend_ledger_entries WHERE account_id = ANY($1)`, [accountIds]);
```

Without the `deleted_at IS NULL` filter, every `saveStore` call would pass soft-deleted account IDs to this DELETE, wiping their dividend and lot data. On the next saveStore, the in-memory `accounting.facts` (loaded from `loadStore` which IS filtered) would not re-insert those rows — permanent data loss. The fix correctly scopes the DELETE to active accounts only, leaving soft-deleted accounts' data intact. Comment explains the invariant clearly.

**CLEAN.** ✓

---

### C. Integration test — QA Task #14 + Backend Task #15

#### C1 — SQL assertion fix: `SELECT COUNT(*)::int` (line ~454)

```ts
const { rows: hiddenWalletRows } = await pool.query<{ count: number }>(
  "SELECT COUNT(*)::int AS count FROM currency_wallet_snapshots WHERE account_id = $1",
  ["acc-wallet-hidden"],
);
expect(hiddenWalletRows[0].count).toBe(0);
```

`currency_wallet_snapshots` has no `id` column — the prior `SELECT id` would have caused a Postgres column-not-found error at runtime. The `COUNT(*)::int AS count` form is correct and uses the `integration-test-persistence-direct.md` raw-pool assertion pattern. ✓

**CLEAN.** ✓

#### C2 — QA Guard: `getMonitoredSet` regression (lines 468–485)

Structure verified:
- Dual account seed: `"acc-mon-hidden"` ticker `"9351"`, `"acc-mon-active"` ticker `"9352"` ✓
- `softDeleteAccount("acc-mon-hidden", ...)` called with `actorUserId: ownerUserId` ✓
- `getMonitoredSet(ownerUserId)` called ✓
- `expect(tickers.has("9352")).toBe(true)` — active survivor survives ✓
- `expect(tickers.has("9351")).toBe(false)` — soft-deleted excluded ✓

The test correctly relies on the `positions` CTE (lot-derived tickers) not on `user_monitored_tickers` (manual). `seedAccountWithData` seeds lots but not manual selections, so the CTE is the load-bearing path. Dual-account pattern follows negative-regression-guard convention per `integration-test-persistence-direct.md`.

**CLEAN.** ✓

#### C3 — QA Guard: `listDividendLedgerYears` regression (lines 487–527)

Structure verified:
- Dual account seed: `"acc-div-hidden"` with `"evt-div-hidden"` (payment year 2024), `"acc-div-active"` with `"evt-div-active"` (payment year 2025) ✓
- `market_data.dividend_events` seeded via raw pool query with `ON CONFLICT DO NOTHING` — schema-qualified per `integration-test-persistence-direct.md` ✓
- `dividend_ledger_entries` seeded via raw pool query with `ON CONFLICT DO NOTHING` ✓
- `softDeleteAccount("acc-div-hidden", ...)` called — see C3a below
- `listDividendLedgerYears(ownerUserId)` called ✓
- `expect(years).toEqual([2025])` — exact match, ghost year 2024 absent, active year 2025 present ✓

**Note on `actorUserId: null` (lines 518–521):** This differs from all other `softDeleteAccount` calls in the file (which use `actorUserId: ownerUserId`). However, `appendAuditLogTx` resolves `input.actorUserId ?? null`, and `audit_log.actor_user_id` uses `ON DELETE SET NULL` FK semantics → the column IS nullable. The NULL value is Postgres-safe. Stylistic inconsistency only; no correctness issue.

**CLEAN.** ✓

#### C4 — Backend Task #15 fixup: sole test-fixture change

Verified that `softDeleteAccount("acc-div-hidden", ...)` at lines 517–522 is correctly positioned BETWEEN the dividend_ledger_entries seed (lines 506–515) and the `listDividendLedgerYears` call (line 524). Without this call, both years 2024 and 2025 would be returned and the assertion `toEqual([2025])` would fail.

Verified that **no other test-fixture changes** are present in the file. All pre-existing tests (lines 117–378, the iter-4 guards at lines 380–466) appear structurally unchanged.

**CLEAN.** ✓

---

## Holistic Audit Spot-Check

Ran `grep -n "FROM accounts|JOIN accounts"` against `apps/api/src/persistence/postgres.ts`. Found **37 matches** (Backend reported 32 — slight discrepancy likely due to grep flags or counting methodology; not concerning given all matches are accounted for).

Classification table:

| Line(s) | Function / path | Classification |
|---------|-----------------|----------------|
| 1744 | `loadStore` accounts batch 1 | Active-only: `WHERE user_id = $1 AND deleted_at IS NULL` ✓ |
| 1765 | `loadStore` fee_profiles JOIN | Active-only: `WHERE a.user_id = $1 AND a.deleted_at IS NULL` ✓ |
| 1787, 1796, 1812, 1823 | `loadStore` batch 2 subqueries | Active-only: `account_id IN (SELECT id FROM accounts ... AND deleted_at IS NULL)` ✓ |
| 2328, 2336 | `saveStore` DELETE paths | Write path — no read filter needed ✓ |
| 2377, 2384 | `saveStore` cleanup subqueries | Write path with active-only scope ✓ |
| 2733 | `getCashLedgerEntriesForWalletReplay` | Active-only: iter-4 HIGH-2 fix ✓ |
| 2769 | `getSnapshotGenerationInputs` tradeFilter | Active-only: iter-4 HIGH-1a fix ✓ |
| 2805 | `getSnapshotGenerationInputs` divFilter | Active-only: iter-4 HIGH-1a fix — uses `${divFilter}` = `"account.deleted_at IS NULL"` ✓ |
| 3041 | `getAggregatedSnapshotsInReportingCurrency` | Active-only: iter-4 HIGH-1b fix ✓ |
| 3777 | `replaceDividendSourceLinesForLedger` | Active-only: iter-5 B3 fix ✓ |
| 3836 | `findDividendLedgerEntryById` | Active-only: iter-5 B4 fix ✓ |
| 3936 | `updateReconciliationStatus` | Active-only: iter-5 B5 fix ✓ |
| 3999 | `updatePostedCashDividend` | Active-only: iter-5 B6 fix ✓ |
| 4186 | `listDividendLedgerScopes` | Active-only: iter-5 B8 fix ✓ |
| 4224 | `applyDividendLedgerRecompute` | Active-only: iter-5 B7 fix ✓ |
| 4367 | `listDividendLedgerEntries` | Active-only: iter-3 P1-2 fix, `AND account.deleted_at IS NULL` at line 4380 ✓ |
| 4601 | `listCashLedgerEntries` | Active-only: subquery ✓ |
| 4686 | `listDividendLedgerYears` | Active-only: iter-5 A2 fix ✓ |
| 5241 | `listUserAccountIds` | Active-only: iter-5 B9 critical fix ✓ |
| 6850 | `getMonitoredSet` positions CTE | Active-only: iter-5 A1 fix ✓ |
| 6906 | `getAllMonitoredTickers` | Active-only: iter-5 B1 fix ✓ |
| 6953 | `getUsersMonitoringTicker` | Active-only: iter-5 B2 fix ✓ |
| 7598 | `hardPurgeUser` cascade prep | Intentional: ALL accounts required for hard-purge cascade ✓ |
| 7628 | `hardPurgeUser` DELETE | Write path ✓ |
| 7678 | `softDeleteAccount` row lock | Targeted single-account by PK+userId, correct ✓ |
| 7740 | `restoreAccount` row lock | Targeted single-account by PK+userId, correct ✓ |
| 7757 | `restoreAccount` name collision check | Active-only: `AND deleted_at IS NULL` ✓ |
| 7821 | `hardPurgeAccount` row lock | Targeted single-account by PK+userId, correct ✓ |
| 7891 | `hardPurgeAccount` DELETE | Write path ✓ |
| 7915 | `listSoftDeletedAccounts` | Intentional: `WHERE deleted_at IS NOT NULL` — the recently-deleted UI endpoint ✓ |
| 7950 | `getAccountIncludingDeleted` | Intentional: retrieves any account regardless of deleted_at (typed-name check for purge route) ✓ |
| 7979 | `selectAccountsForHardPurge` | Intentional: `WHERE deleted_at IS NOT NULL` — cron picks soft-deleted past grace period ✓ |

**All 37 matches properly classified. No unfiltered user-facing read paths.**

---

## Summary

| Item | Status |
|------|--------|
| HIGH `getMonitoredSet` filter (A1) | CLEAN |
| MEDIUM `listDividendLedgerYears` filter (A2) | CLEAN |
| Defensive: `getAllMonitoredTickers` (B1) | CLEAN |
| Defensive: `getUsersMonitoringTicker` (B2) | CLEAN |
| Defensive: 5 dividend-ledger ownership/recompute (B3–B7) | CLEAN |
| Defensive: `listDividendLedgerScopes` (B8) | CLEAN |
| Critical: `listUserAccountIds` prevent data loss (B9) | CLEAN |
| Test SQL assertion fix `COUNT(*)` (C1) | CLEAN |
| QA Guard: `getMonitoredSet` regression (C2) | CLEAN |
| QA Guard: `listDividendLedgerYears` regression (C3) | CLEAN |
| Task #15 `softDeleteAccount` fixup, sole change (C4) | CLEAN |
| Holistic grep audit — 37 matches classified | CLEAN |

**Total findings: 0.**
