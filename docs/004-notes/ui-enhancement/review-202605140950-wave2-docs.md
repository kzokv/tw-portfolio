# Code Review — Wave 2 Docs (ui-enhancement)

**Date**: 2026-05-14T09:50:00Z  
**Reviewer**: Code Reviewer (Tier 3, Claude Sonnet)  
**Branch**: `worktree-ui-enhancement`  
**Activation**: Explicit `[ARCHITECT:GO]` envelope from architect-2  
**Scope**: Wave 2 structural compliance — PR description draft + transition note  
**Artifacts**:
- `.worklog/team/pr-description-draft.md`
- `docs/004-notes/ui-enhancement/transition-202605131830-soft-delete-and-form-fixes.md`

---

## Verdict: FIX-REQUIRED

**1 MEDIUM pre-merge correction.** 12 of 13 checklist items CLEAN. One item requires in-place correction before PR is opened.

---

## PR Description Draft — Structural Compliance Checklist

### Item 1 — `## Summary` section present

✓ Line 5. One-paragraph TL;DR covering all four shipped items: soft-delete, fee/tax gate fix, ALL chip removal, `account_hard_purge_days` Tier-B constant.

**CLEAN.** ✓

---

### Item 2 — `## Problem` section present and separate from Summary

✓ Line 11. Three numbered gaps (no delete UX, stale render gate, ALL chip pollution). Correctly structured as a standalone section, not folded into Summary.

**CLEAN.** ✓

---

### Item 3 — `## Solution` section present and separate from Summary/Problem

✓ Line 23. Three numbered solutions with implementation details. Line 34 names **9 read paths** (consistent with iter-5 holistic audit). All technical specifics match the implementation.

**CLEAN.** ✓

---

### Item 4 — `## Testing` section with `Evidence:` block

✓ Line 61. Uses the required heading `## Testing` (not `## Test Coverage`). `Evidence:` block at lines 64–74.

**CLEAN.** ✓

---

### Item 5 — Suite 5 count = 699 passed (CRITICAL)

✓ Line 68: `Suite 5 (Integration:full:host): 699 passed, 1 skipped, 73 files, 289s`

**CLEAN.** ✓

---

### Item 6 — All 8 suite results present in `Evidence:` block

Verified all 8 suites listed (lines 65–74):
- Suite 1 (ESLint): clean, 0 warnings ✓
- Suite 2 (Typecheck): clean ✓
- Suite 3 (Web unit): 402 passed ✓
- Suite 4 (API unit+mem): 1285 passed, 392 skipped ✓
- Suite 5 (Integration:full:host): 699 passed, 1 skipped, 73 files, 289s ✓
- Suite 6 (E2E bypass:mem): 203 passed ✓
- Suite 7 (E2E oauth:mem): 125 passed (1 flake ruled pre-existing) ✓
- Suite 8 (HTTP API): 276 passed, 2 skipped ✓

**CLEAN.** ✓

---

### Item 7 — `## Risk/Rollback` section present

✓ Line 94. Five monitoring signals (audit_log spikes, cron health query, silent `soft_deleted`-without-`hard_purged`, data-leak SQL check, getMonitoredSet / listDividendLedgerYears leak signals). Revert mechanism in 5 numbered steps including `UPDATE accounts SET deleted_at = NULL` force-restore note and partial-index rollback SQL.

**CLEAN.** ✓

---

### Item 8 — `## Behavioral deltas` present, labeled "intentional, not regressions"

✓ Line 112. Table with 8 rows covering all four shipped items. Preamble "The following user-visible changes are **intentional, not regressions**" present at line 114.

**CLEAN.** ✓

---

### Item 9 — `## Renamed types / classes` table present

✓ Lines 129–134. N/A table with "No types or classes renamed." Footer row correct.

**CLEAN.** ✓

---

### Item 10 — `## Waiver` section present with correct heading

✓ Line 139. Heading is exactly `## Waiver` (the `pr-gate.yml`-required literal heading).

**CLEAN.** ✓

---

### Item 11 — `## Waiver` schema: `Reason:` field

✓ Lines 141–143. `Reason:` paragraph present: "User explicitly opted to ship without a Linear ticket for this UI-enhancement run. Scope is locked at … All commit subjects and the PR title omit `KZO-XX:` because no Linear ticket exists."

**CLEAN.** ✓

---

### Item 12 — `## Waiver` schema: `Scope:` field

✓ Line 145. `Scope: both` — correct, because both PR title AND commit subjects omit the ticket segment. Matches the actual violation surface per `commit-format.md`.

**CLEAN.** ✓

---

### Item 13 — `## Waiver` schema: `Approved-by:` field

**MEDIUM (pre-merge in-place correction)**

Line 144: `Approved-by: @[github-handle-placeholder — user to fill in before PR open]`

Per `commit-format.md` waiver schema: *"`Approved-by: @<github-handle>` (the approver must have write/maintain/admin on the repo)"*. The placeholder is not a real GitHub handle and `pr-gate.yml` parses this field by value. A PR opened with this placeholder fails the gate — it is structurally equivalent to having a malformed `Approved-by:` line.

**Remediation (pre-merge, in-place):** Replace the placeholder with the repository owner's real GitHub handle before opening the PR. Per `doc-management.md` pre-merge correction window, this is a trivial 1-word in-place correction on a not-yet-merged artifact — no new review cycle required.

---

## Transition Note — Content Compliance Checklist

**File**: `docs/004-notes/ui-enhancement/transition-202605131830-soft-delete-and-form-fixes.md`

---

### Item A — `## Follow-up: CTE-centralized soft-delete filter` section present

✓ Line 120. Section present with explanation: "active-account filter via an `active_account_ids` CTE (or a view `active_accounts AS SELECT * FROM accounts WHERE deleted_at IS NULL`)", deferred as structural cleanup (not a bug), rationale for not backporting into this PR documented.

**CLEAN.** ✓

---

### Item B — Correct filter counts (9 sites, 37-match audit)

✓ Line 122: "9 read paths in `apps/api/src/persistence/postgres.ts` (2 directed in iter 4 + 7 from the holistic 37-match audit in iter 5)"

✓ Line 122: "all 37 matches were either patched (9 sites), not-account-scoped (24 sites), or write/delete paths where the filter is inapplicable (4 sites)" — 9 + 24 + 4 = 37. Sums correctly.

Both numbers are current with the iter-5 expanded scope (not the pre-iter-5 count of 3 directed sites).

**CLEAN.** ✓

---

### Item C — Cross-references to iter-4 and iter-5 review docs

✓ Line 128: "Reference: `docs/004-notes/ui-enhancement/review-202605140745-phase3-iter4.md` and `review-202605140900-phase3-iter5.md` document the audit trail and per-site classification."

Both review doc filenames match the actual files on disk.

**CLEAN.** ✓

---

### Item D — Evidence block matches PR draft counts

✓ Lines 94–106. Evidence block in transition note:
- Suite 5: 699 passed ✓ (matches PR draft)
- Suite 7 flake note: `dashboard-timeframe-aaa.spec.ts:192, ruled pre-existing per exit-check-non-regression-checklist.md` — present and consistent ✓

**CLEAN.** ✓

---

## Summary

| Item | Artifact | Status |
|------|----------|--------|
| 1 — `## Summary` present | PR draft | CLEAN |
| 2 — `## Problem` separate from Summary | PR draft | CLEAN |
| 3 — `## Solution` separate; 9 read paths named | PR draft | CLEAN |
| 4 — `## Testing` with `Evidence:` block | PR draft | CLEAN |
| 5 — Suite 5 = 699 passed | PR draft | CLEAN |
| 6 — All 8 suite results | PR draft | CLEAN |
| 7 — `## Risk/Rollback` present | PR draft | CLEAN |
| 8 — `## Behavioral deltas` labeled "intentional" | PR draft | CLEAN |
| 9 — Renamed-types N/A table | PR draft | CLEAN |
| 10 — `## Waiver` heading present | PR draft | CLEAN |
| 11 — `Reason:` field | PR draft | CLEAN |
| 12 — `Scope: both` | PR draft | CLEAN |
| 13 — `Approved-by:` real GitHub handle | PR draft | **MEDIUM** — placeholder; replace before opening PR |
| A — Follow-up CTE section | Transition note | CLEAN |
| B — 9 sites / 37 audit matches; sums correct | Transition note | CLEAN |
| C — Cross-refs iter-4 + iter-5 review docs | Transition note | CLEAN |
| D — Evidence block counts match PR draft | Transition note | CLEAN |

**Total findings: 1.**

**Required action (user):** Before running `gh pr create`, replace the `Approved-by:` placeholder on line 144 of `.worklog/team/pr-description-draft.md` with the repository owner's real GitHub handle. All other items are structurally compliant and require no changes.
