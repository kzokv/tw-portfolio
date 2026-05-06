# Wave 2 Docs Review — PR-Bound Artifacts Must Pass `git-pr-flow.md` Compliance

When a Wave 2 docs review covers artifacts whose final consumer is a GitHub PR body or a PR-gating workflow, the review must explicitly verify structural compliance — not just factual accuracy.

A "lighter accuracy-only" review can close clean while the artifact is CI-broken on submission. The Code Reviewer's brief must name the compliance criteria upfront.

## What to verify (PR description draft / transition note that gets pulled into PR body)

Check that the artifact has each of these section headings, in order:

- `## Problem` — separate from `## Summary`. The Summary is a TL;DR; Problem describes the gap the change closes.
- `## Solution` — separate from `## Summary`. Lists the structural change.
- `## Testing` — NOT `## Test Coverage`. Must include an `Evidence:` block with concrete suite results (e.g. "Suite 4: 692 passed, 13 skipped").
- `## Risk/Rollback` — what could go wrong, what to monitor post-merge, how to revert.
- Behavioral deltas explicitly called out as "intentional, not a regression" (e.g. KZO-163's 503 + Retry-After path).
- Renamed types/classes table (per `process-refactor-rename-verification.md`).

The CI workflow `pr-gate.yml` enforces these section headings via body validation. A draft missing any of them fails CI on submission.

## Wave 2 pre-engagement artifact check (Architect gate)

Before routing Wave 2 docs to the Code Reviewer, the Architect must verify every required deliverable exists on disk:

```bash
ls .worklog/team/          # pr-description-draft.md must be present
ls docs/004-notes/<slug>/  # transition note must be present
```

Do NOT assume a teammate's `[DONE]` signal means all deliverables were written. Check file existence explicitly. If any required artifact is missing, send `[QUESTION]` to the Technical Writer and wait for the missing file before engaging the Code Reviewer.

If the PR description draft includes a truth table (any feature that is mode-dependent or condition-dependent), verify the table is included verbatim in the draft — not summarized in prose. The truth table is the acceptance signal the Code Reviewer and human use to verify behavioral correctness.

**Why:** KZO-189 Wave 2 — Technical Writer reported `[DONE]` after writing 3 of 4 deliverables. The PR description draft (`.worklog/team/pr-description-draft.md`) was absent. Architect caught this via the existence check before routing to Code Reviewer, avoided a Code Reviewer run against an incomplete artifact set. Without the check, the Code Reviewer would have reviewed 3 of 4 artifacts and declared clean — missing the PR body compliance review entirely (which is the one that fails CI).

## Brief the Code Reviewer explicitly

When the Architect routes Wave 2 docs to the Code Reviewer, include in the brief:

> "Verify `## Problem`, `## Solution`, `## Testing` (with `Evidence:` block), `## Risk/Rollback` per `docs/git-pr-flow.md §3-4`. CI gate `pr-gate.yml` enforces these — submitted as-is, the PR fails CI."

Pre-baking the structural-compliance criteria into the brief turns "PR draft passes `pr-gate.yml`" from a judgment call into a checklist step.

## Scope

- **Applies to:** PR description drafts (`.worklog/team/pr-description-draft.md`), transition notes that will be quoted/linked from the PR body.
- **Does NOT apply to:** updates to evergreen `runbook.md`, `docs/001-architecture/**`, or other docs that aren't PR-gated. Accuracy-only review is sufficient there.

**Why:** KZO-163 Wave 2 caught this as a real CI-blocking miss. Two parallel docs reviews ran on the same artifacts:
1. A lighter accuracy-only pass — caught a wrong type name, missed structural compliance, closed clean.
2. A formal compliance pass with explicit `git-pr-flow.md §3-4` and `pr-gate.yml` criteria — caught 3 MEDIUM CI-blocking issues (missing `## Problem`+`## Solution` split, `## Test Coverage` instead of `## Testing` with no `Evidence:` block, missing `## Risk/Rollback`).

The lighter pass closed "clean" from its own scope — it wasn't wrong, just incomplete. The team would have shut down thinking the PR was ready, only to have CI reject it on submission. Without the second formal review, the failure mode would have been silent.

**How to apply:**
- Architect briefs to docs Code Reviewer in Wave 2 must enumerate the `git-pr-flow.md` required sections, not just say "review the PR draft."
- The shutdown gate must include "PR draft passes `pr-gate.yml` body validation," not just "docs are accurate."
- Companion to `agent-team-workflow.md` — this is the specific compliance check the Architect should add to Wave 2 task descriptions whenever a PR draft is in scope.
