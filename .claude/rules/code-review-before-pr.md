# Code Review Before PR Creation

Run a structured code review as a formal phase before PR creation — not deferred to PR review.

Structured pre-PR review catches architectural drift, pattern violations, and cross-file consistency issues that are invisible in diff view. PR-time review only catches formatting and obvious bugs.

**Workflow step:** After completing a significant implementation phase, run `/code-reviewer` to produce a structured review doc at `docs/004-notes/{area}/review-{datetime}-{slug}.md`. Work through the fix list top-down with TDD validation before creating the PR.

**Why:** Phase 5d CR produced 23 items across 5 severity tiers (Critical, High, Medium, Low, Informational). It caught fixture duplication, app-specific logic in generic framework, and type-safety gaps that would have been harder to fix after merge. Reinforced in KZO-144 where Codex review found 4 P1 issues (hard-purge cascade ordering, TOCTOU race) after the team's own validation passed.

**How to apply:** Any time a ticket involves 5+ files or crosses 2+ layers. This is step 6 in the ticket-to-PR workflow.
