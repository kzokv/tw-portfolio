# Wave 2 Docs Code Review — ui-enhancement

**Reviewer:** code-reviewer (Sonnet, Tier 3)
**Date:** 2026-05-13T14:14 UTC
**Branch:** `worktree-ui-enhancement`
**Scope:** Wave 2 documentation deliverables (5 artifacts)
**Authorized by:** `[ARCHITECT:GO]` envelope (mechanical acceptance checklist — `pr-bound-docs-review-compliance.md`)

---

## Verdict: FIX-REQUIRED

**2 MEDIUM findings** (pre-merge corrections). All other checklist items CLEAN.

---

## MEDIUM-1 — Transition note: migration 055 wrong filename + placeholder description

**File:** `docs/004-notes/ui-enhancement/transition-202605131830-soft-delete-and-form-fixes.md`
**Line:** 51

**Current text (wrong):**
```
| `055_uie_account_hard_purge_integration.sql` | *(If present — see Backend Implementer's migration plan.)* Any additional index or constraint changes required by the integration. |
```

**Problems:**
1. **Wrong filename** — actual migration file is `055_uie_audit_log_account_actions.sql` (verified in `db/migrations/`).
2. **Placeholder description** — the italic `*(If present — see Backend Implementer's migration plan.)*` text is draft/placeholder language that was never replaced with actual content.
3. **Wrong description** — migration 055 extends the `audit_log_action_check` CHECK constraint (DROP + recreate) to include the 3 new account lifecycle action codes; it does NOT add indexes or perform "integration" changes.

**Required correction (exact replacement for the row):**
```
| `055_uie_audit_log_account_actions.sql` | Extends `audit_log_action_check` CHECK constraint to include `account_soft_deleted`, `account_restored`, `account_hard_purged` action codes. All 29 existing actions from migration 049 preserved. |
```

**Per `doc-management.md` pre-merge correction window:** this is a factual accuracy fix in a pre-merge frozen snapshot — correct in-place, no new file needed.

---

## MEDIUM-2 — Runbook §27: migration 055 absent from migration table

**File:** `docs/002-operations/runbook.md`
**Lines:** 2391–2396

**Current migration table:**
```markdown
| File | Change |
|---|---|
| `053_uie_accounts_deleted_at.sql` | Adds `accounts.deleted_at TIMESTAMPTZ NULL` ... |
| `054_uie_app_config_account_hard_purge_days.sql` | Adds `app_config.account_hard_purge_days INT NULL` ... |
```

**Problem:** Migration 055 (`055_uie_audit_log_account_actions.sql`) is entirely absent. An operator applying this PR to a production environment runs all 3 migrations in sequence. The runbook's migration table should enumerate all 3 so operators know what to expect (and can diagnose a constraint-conflict failure in migration 055).

**Required correction — append a third row to the table:**
```markdown
| `055_uie_audit_log_account_actions.sql` | Extends `audit_log_action_check` CHECK constraint to include `account_soft_deleted`, `account_restored`, `account_hard_purged` action codes. |
```

Also update the prose note below the table from:
```
Both migrations are additive (`ADD COLUMN IF NOT EXISTS`).
```
to:
```
Migrations 053 and 054 are additive (`ADD COLUMN IF NOT EXISTS`). Migration 055 uses a DROP + recreate pattern on the CHECK constraint (`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`) — the CHECK extension is idempotent across re-runs.
```

**Per `doc-management.md` pre-merge correction window:** correct in-place.

---

## Checklist Results (per Architect brief)

### A. PR description `.worklog/team/pr-description-draft.md`

| Item | Status |
|---|---|
| `## Problem` heading present (separate from Summary) | ✓ |
| `## Solution` heading present (separate from Summary) | ✓ |
| `## Testing` heading (NOT `## Test Coverage`) | ✓ |
| `Evidence:` block with all 8 Validator iter-2 suite results verbatim | ✓ (suites 1–8 match exactly) |
| `## Risk/Rollback` heading with monitor/revert content | ✓ |
| Behavioral deltas table (`## Behavioral deltas` heading) | ✓ (6 rows, ≥4 required) |
| Renamed-types table (`## Renamed types / classes`) | ✓ (N/A documented) |
| `## Waiver` heading (NOT `## Notes`) | ✓ |
| `Reason:` field | ✓ |
| `Approved-by: @...` field | ✓ (placeholder — user fills before PR open; structurally compliant) |
| `Scope: both` | ✓ |
| Top-of-file `waiver:linear-ticket` label reminder | ✓ (lines 1–3) |

All structural fields compliant with `pr-gate.yml` schema. ✓

**Note:** `Approved-by: @[github-handle-placeholder — user to fill in before PR open]` is a known intentional placeholder. Structurally the field is present; the user must replace it with their actual `@handle` before running `gh pr create`. Not a structural finding.

---

### B. Transition note `docs/004-notes/ui-enhancement/transition-202605131830-soft-delete-and-form-fixes.md`

| Item | Status |
|---|---|
| Datetime naming format `transition-{YYYYMMDDHHmm}-{short-desc}.md` | ✓ |
| `## Behavioral deltas` table | ✓ (10 rows) |
| Migration notes — 053 | ✓ |
| Migration notes — 054 | ✓ |
| Migration notes — 055 | ❌ **MEDIUM-1** (wrong filename + placeholder desc) |
| Env/app_config additions table | ✓ |
| SSE event additions table | ✓ |
| Cascade safety section with `Evidence:` block | ✓ |
| Out-of-scope section | ✓ |
| No prose contradictions vs architect-design.md §5 cascade | ✓ (architecture doc cascade table verified against `postgres.ts:7740+` — 15-row order matches source) |

---

### C. Runbook `docs/002-operations/runbook.md` §27

| Item | Status |
|---|---|
| No stale "future candidate" / account-purge language | ✓ (`grep -niE "future candidate..."` — 0 matches related to account purge) |
| Cron schedule `0 4 * * *` | ✓ (line 2411, 2434) |
| Admin override path (`app_config.account_hard_purge_days`, bounds [1, 365]) | ✓ (lines 2437–2453) |
| Audit_log codes to monitor (`account_soft_deleted`, `account_restored`, `account_hard_purged`) | ✓ (lines 2459–2463, monitoring queries at lines 2483–2488) |
| Restore window + "Permanently delete now" UX note | ✓ (lines 2417–2426) |
| Migration 053 in migration table | ✓ |
| Migration 054 in migration table | ✓ |
| Migration 055 in migration table | ❌ **MEDIUM-2** (absent) |

---

### D. Architecture note `docs/001-architecture/backend-db-api.md`

| Item | Status |
|---|---|
| Inserted BEFORE `## API` | ✓ (§ at line 1105; `## API` at line 1171) |
| `deleted_at` semantics | ✓ |
| Partial unique index `ux_accounts_user_id_name_active` | ✓ |
| Read-path filter contract | ✓ (6 read paths listed) |
| Snapshot policy (filter-on-read, no recompute) | ✓ |
| Restore-window invariant | ✓ |
| 15-row cascade table in FK-dependency order | ✓ (verified against `postgres.ts:7740+` — matches source exactly) |

Cascade table cross-verification against `hardPurgeAccount` source (lines 7740–7837):
- Steps 1–10: audit INSERT → `daily_holding_snapshots` → `currency_wallet_snapshots` → `cash_ledger_entries` → `lot_allocations` → `lots` → `dividend_deduction_entries` → `dividend_ledger_entries` → `corporate_actions` → `trade_events` — all match source order. ✓
- Steps 11–15: `trade_fee_policy_snapshots` (left), `account_fee_profile_overrides` / `fee_profiles` / `tax_rules` CASCADE via final `accounts` DELETE — matches source comment at line 7826–7827. ✓

---

### E. `e2e-shared-memory-bars-ticker-hygiene.md` ACCDEL block

| Item | Status |
|---|---|
| Block follows KZO-197 AUWARM template format | ✓ |
| Date header `As of 2026-05-13 (ui-enhancement — ...)` | ✓ |
| Per-ticker spec file names (ACCDEL01-03, 04, 05) | ✓ |
| Pre-PR grep recipe | ✓ (`grep -rn '"ACCDEL0[1-5]"' apps/web/tests apps/api/test`) |
| "Do not reuse for any non-ui-enhancement spec" language | ✓ |

---

## Finding Count by Severity

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 2 |
| LOW | 0 |
| Informational | 1 (Approved-by placeholder — user must fill before PR open) |

---

## Routing

Both MEDIUM findings are **pre-merge corrections** per `doc-management.md` (detected before merge on a pre-merge frozen snapshot — correct in-place, no errata file needed). Both are 1-2 line edits:

- **MEDIUM-1** (`transition-202605131830-*` line 51): replace wrong filename + placeholder text with correct filename + accurate description.
- **MEDIUM-2** (`runbook.md` §27, lines 2391–2396): add missing migration 055 row to the migration table + update the additive-only prose note.

Technical writer can address both in a single fix-up pass.
