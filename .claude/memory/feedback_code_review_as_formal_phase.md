---
name: code review as a formal phase
description: Run structured code review before PR creation, not just as PR review — catches architectural drift early
type: feedback
---

Code review should be a formal phase in the workflow, run before PR creation — not deferred to PR review.

The Phase 5d CR produced 23 items across 5 severity tiers (Critical, High, Medium, Low, Informational). It caught architectural drift (fixture duplication, app-specific logic in generic framework, type-safety gaps) that would have been harder to fix after merge.

**Why:** PR-time review catches formatting and obvious bugs. Structured pre-PR review catches architectural drift, pattern violations, and cross-file consistency issues that are invisible in diff view.

**How to apply:** After completing a significant implementation phase, run `/code-reviewer` to produce a structured review doc at `docs/004-notes/{area}/review-{datetime}-{slug}.md`. Work through the fix list top-down with TDD validation before creating the PR. This is already part of the ticket-to-PR workflow (step 6).
