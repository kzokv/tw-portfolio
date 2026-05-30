# Phase 3 Triage: Route Planned-Wave-2 Findings to Wave 2, Not Phase 4

When the Code Reviewer flags a finding during Phase 3 that maps directly to work already scoped for Wave 2 (typically scope-todo docs steps like "update runbook.md" or "add architecture paragraph"), the Architect must route it to Wave 2 rather than queuing it in Phase 4.

## The rule

During Phase 3 → Phase 4 triage, cross-reference each finding against the scope-todo's Wave 2 items. For each finding:

1. **Is it already planned for Wave 2?** → defer to Wave 2. Note in the `[TRIAGE]` message to the Dispatcher: `<finding> → deferred to Wave 2 (<scope-todo step N>)`.
2. **Is it net-new work?** → assign to the appropriate domain owner in Phase 4 (Implementer for code, QA for tests, etc.).

The exit check can still close with `findings_addressed=true` — deferral to a planned Wave 2 item is a resolution, not an ignore. Track the deferred items explicitly in `state.json` under the Wave 2 queue.

## What counts as "planned Wave 2"

Typically the Technical Writer wave:
- Architecture doc updates (`docs/001-architecture/**`)
- Runbook updates (`docs/002-operations/**`)
- Transition guides (`docs/004-notes/{slug}/`)
- Stale "future candidate" / "follow-up" notes that the current ticket fulfills

Implementation fixes, test gaps, and code-review blockers (HIGH findings) are NEVER deferrable — those are always Phase 4 work even if they live in docs-adjacent files.

## Why

**KZO-152 precedent.** Iteration 1 Code Reviewer findings:
- MEDIUM-1: `runbook.md` stale "future candidate" sentence
- MEDIUM-2: `sharing.md` missing "Purge and Retention" subsection
- LOW-1: `err` → `error` log-key rename in worker

All three were routed correctly:
- MEDIUM-1 + MEDIUM-2 → Wave 2 (scope-todo Step 9 — always slated for Technical Writer)
- LOW-1 → Phase 4 fullstack-implementer (net-new code fix)

Routing MEDIUMs to Phase 4 would have either (a) bloated the Implementer's queue with out-of-domain docs work, or (b) duplicated the work in Wave 2. The deferral kept Phase 4 laser-focused (single LOW fix) and Wave 2 substantive (docs landed clean, no re-review findings).

## How to apply

During Phase 3 → Phase 4 triage (Architect's primary decision point):

1. Read each finding.
2. Open the scope-todo; check Wave 2 scope.
3. If finding maps to planned Wave 2 → defer; note in triage message.
4. If net-new → assign to domain owner in Phase 4.

Companion rules: `agent-team-workflow.md` (verification gates are contracts), `doc-management.md` (Wave 2 is where docs get touched).
