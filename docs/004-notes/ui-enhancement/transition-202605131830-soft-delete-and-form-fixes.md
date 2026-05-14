# Transition Note — Account soft-delete, form fixes, and market chip cleanup

> **Status:** frozen post-merge. See `docs/doc-management.md` for lifecycle rules.
> **Branch:** `worktree-ui-enhancement` (no Linear ticket — `waiver:linear-ticket` label applied at PR open)
> **Date:** 2026-05-13

---

## Summary

This PR delivers four UI-enhancement work items:

1. **Account deletion (two-stage)** — Users can now soft-delete accounts from Settings → Accounts. Soft-deleted accounts are hidden from all portfolio views and recoverable from a "Recently deleted" section for a 30-day grace window (admin-tunable). A "Permanently delete now" path with typed-name confirmation skips the grace window. A daily cron hard-purges expired soft-deleted accounts.

2. **Fee/tax render gate fix** — The commission and tax estimate sections in the Record Transaction form now render whenever the 4-tuple `(accountId, ticker, quantity > 0, unitPrice > 0)` is set, replacing the old `feeEstimate ?` gate. When the estimate is unavailable (e.g. price-mismatch race), the section shows "—" with an "estimate unavailable" sub-label instead of disappearing.

3. **"ALL" market chip removal** — The Record Transaction form no longer shows an "ALL" market chip. The chip now reflects the selected account's market and auto-syncs when the account changes; the ticker field clears on account change.

4. **App_config extension** — New Tier-B constant `account_hard_purge_days` (admin-tunable grace period). New env vars `ACCOUNT_HARD_PURGE_CRON` and `ACCOUNT_HARD_PURGE_DAYS`.

---

## Behavioral deltas

All changes listed below are **intentional**, not regressions.

| Area | Before | After |
|---|---|---|
| Settings → Accounts | No delete affordance | Per-account "Delete account" button |
| Soft-deleted accounts in portfolio views | N/A (no soft-delete existed) | Hidden from all account-scoped views (`WHERE deleted_at IS NULL` filter on all read paths) |
| Settings → Accounts (below active list) | Not present | "Recently deleted (N)" section with per-row Restore + "Permanently delete now" + time-remaining |
| Permanent deletion | Not available to users | `POST /accounts/:id/purge` with typed-name modal; immediately irreversible |
| Record Transaction → fee/tax section | Disappeared when estimate was null (e.g. right after typing ticker, during price-mismatch) | Always visible when 4-tuple `accountId + ticker + quantity + unitPrice` is set; shows "—" + "estimate unavailable" when estimate is null |
| Record Transaction → fee/tax override input | Only accessible when estimate was non-null | Always editable once section renders (preserves override across input changes) |
| Record Transaction → market chip | `TW / US / AU / ALL` | `TW / US / AU` only — ALL chip removed |
| Record Transaction → market chip on account change | Did not auto-sync | Auto-syncs to selected account's market |
| Record Transaction → ticker on account change | Not cleared | Cleared when account changes |
| Initial market chip (no account selected) | `null` (showed ALL) | `TW` fallback |
| Settings → Tickers → Catalog browser | `ALL` filter present | **Unchanged** — ALL market filter kept in the catalog browser (out of scope) |

---

## Migration notes

Three new sequential migrations (applied in order at deploy time):

| File | Change |
|---|---|
| `053_uie_accounts_deleted_at.sql` | Adds `accounts.deleted_at TIMESTAMPTZ NULL` column. Adds `idx_accounts_deleted_at` partial index (`WHERE deleted_at IS NOT NULL`). Replaces `ux_accounts_user_id_name` unique index with `ux_accounts_user_id_name_active` partial unique index (`WHERE deleted_at IS NULL`) to allow name reuse after soft-delete. |
| `054_uie_app_config_account_hard_purge_days.sql` | Adds `app_config.account_hard_purge_days INT NULL` Tier-B column with comment. |
| `055_uie_audit_log_account_actions.sql` | Extends `audit_log_action_check` CHECK constraint to include `account_soft_deleted`, `account_restored`, `account_hard_purged` action codes. All 29 existing actions from migration 049 preserved. |

All migrations are additive (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Rollback: see `docs/002-operations/runbook.md` §27 Rollback notes.

---

## Env / app_config additions

| Name | Type | Default | Notes |
|---|---|---|---|
| `ACCOUNT_HARD_PURGE_CRON` | Env var | `"0 4 * * *"` | Cron schedule for the daily hard-purge job. Restart-required. |
| `ACCOUNT_HARD_PURGE_DAYS` | Env var | `30` | Grace period fallback (days). Overridden by `app_config.account_hard_purge_days` without restart. |
| `app_config.account_hard_purge_days` | DB column (INT NULL) | NULL → uses `ACCOUNT_HARD_PURGE_DAYS` | Tier-B admin-tunable grace period. Bounds: [1, 365]. Live-tunable (takes effect on next cron tick). |

Both env vars have `.default(...)` — no env-setup wizard registration needed (per `env-setup-autogen-required-secrets.md` strict-scope clause).

---

## SSE event additions

Three new SSE event types added to `libs/shared-types/src/events.ts` and extended in the `SSEEvent` union:

| Event type | Trigger | Payload shape |
|---|---|---|
| `account_soft_deleted` | `DELETE /accounts/:id` | `{ accountId: string; deletedAt: string }` |
| `account_restored` | `POST /accounts/:id/restore` | `{ accountId: string; finalName: string }` |
| `account_hard_purged` | `POST /accounts/:id/purge` OR cron tick | `{ accountId: string }` |

Web consumers subscribe via `useEventStream` (always-on) and refetch `GET /accounts` + `GET /accounts/deleted` on receipt.

---

## Cascade safety

**Hard-purge cascade order** is documented in full at `docs/001-architecture/backend-db-api.md` §Account soft-delete lifecycle. All 12 account-scoped tables are handled in FK-dependency order in a single transaction. The user row and `daily_portfolio_snapshots` (user-scoped, no `account_id`) are not touched.

**Test evidence:** see `docs/002-operations/runbook.md` §27 and integration tests at `apps/api/test/integration/accountSoftDelete.integration.test.ts`:
- Cascade ordering verified: hard-purge leaves all other accounts + user intact; every account-scoped child table empty after purge.
- Restore-name-collision auto-rename (incl. `(restored 2)` recursive fallback) tested.
- Cron retention: raw `INSERT ... NOW() - INTERVAL '40 days'` candidate row purged; regression-guard row at `NOW() - INTERVAL '5 days'` preserved.
- Active-only filter for `getAccounts` + `listSoftDeletedAccounts` verified.
- Audit-log row with snapshot metadata present after hard-purge.

**Validator suite results (iter 5 — final, all green):**

```
Evidence:
Suite 1 (ESLint): clean, 0 warnings
Suite 2 (Typecheck): clean
Suite 3 (Web unit): 402 passed
Suite 4 (API unit+mem): 1285 passed, 392 skipped
Suite 5 (Integration:full:host): 699 passed, 1 skipped, 73 files, 289s
Suite 6 (E2E bypass:mem): 203 passed
Suite 7 (E2E oauth:mem): 125 passed (1 flake — dashboard-timeframe-aaa.spec.ts:192, ruled pre-existing per exit-check-non-regression-checklist.md)
Suite 8 (HTTP API): 276 passed, 2 skipped
```

---

## Renamed types / classes

None in this PR.

| Old name | New name | Notes |
|---|---|---|
| N/A | N/A | No types or classes renamed. |

---

## Follow-up: CTE-centralized soft-delete filter

The active-only filter (`AND a.deleted_at IS NULL`) was applied as inline predicates across **9 read paths** in `apps/api/src/persistence/postgres.ts` (2 directed in iter 4 + 7 from the holistic 37-match audit in iter 5). The holistic audit confirmed all 37 matches were either patched (9 sites), not-account-scoped (24 sites), or write/delete paths where the filter is inapplicable (4 sites).

A future cleanup ticket should centralize the active-account filter via an `active_account_ids` CTE (or a view `active_accounts AS SELECT * FROM accounts WHERE deleted_at IS NULL`) to prevent further leak-and-fix cycles as new account-scoped reads are added.

**This is a structural cleanup, not a bug** — the inline pattern is correct and fully audited. The deferral is intentional; backporting a CTE refactor into a feature PR would have broadened the risk surface unnecessarily.

**Reference:** `docs/004-notes/ui-enhancement/review-202605140745-phase3-iter4.md` and `review-202605140900-phase3-iter5.md` document the audit trail and per-site classification.

---

## Out of scope

The following was explicitly excluded and remains unchanged:

- **Settings → Tickers → Catalog browser** (`InstrumentCatalogSheet.tsx`) — the "ALL" market filter chip is preserved in the catalog browser. Only the Record Transaction form's market chip was changed.
- Cancellation of active pg-boss jobs (daily-refresh, backfill) on soft-delete — jobs continue to fire; the read-path filter makes them silent no-ops for deleted accounts.
- Cross-account purge reporting / admin visibility of individual user's deleted accounts.
