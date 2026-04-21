# Replacing Stale "Future Candidate" Notes in Operational Docs

When shipping a feature that fulfills a previously-documented "future candidate," "follow-up," or "not in this release" note, **replace the stale note in-place** rather than appending a separate entry.

## The rule

Before appending a new operational bullet in `docs/002-operations/runbook.md` (or any evergreen ops doc) for a feature that previously lived in a "future work" list, grep first:

```bash
# Before adding a new runbook entry for cron / retention / cleanup work:
grep -niE "future candidate|follow-up|not in this release|future cron|long-tail" docs/002-operations/runbook.md
```

Any match that describes the now-shipped feature must be **replaced** with the real implementation details (env var, cron schedule, observability hooks, ticket reference), not supplemented. Leaving both creates misleading "future" language next to the actual implementation.

## Why

KZO-147 runbook §16 contained the bullet "A long-tail cleanup cron is a future candidate; no immediate pressure." KZO-152 shipped exactly that cron. The Code Reviewer flagged the stale line as MEDIUM — replacing it in-place (vs appending) kept `docs/002-operations/runbook.md` canonical. Appending would have left a confusing duplication where the same section says both "future candidate" and "runs daily at 04:00 UTC."

## How to apply

- Applies to `docs/002-operations/runbook.md`, `docs/001-architecture/**`, and any long-lived operational doc.
- When the Architect writes the scope-todo docs step, quote the stale text being replaced AND the replacement text verbatim — not a prose summary. That gives the Code Reviewer a concrete acceptance checklist rather than judgment calls.
- Same principle for env-var documentation: if `.env.example` has a `#TODO: add X` comment and the ticket adds X, delete the TODO in the same PR.

---

## Related: docs-step scope-todo language

When writing a scope-todo docs step (Step 9 in KZO-152's pattern), enumerate the specific content elements the doc must contain as a bullet list — not prose. Example from KZO-152:

> Add a paragraph: retention-from-terminality semantics, 90d default via `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS` env var, daily 04:00 UTC cron, no audit entry.

Each comma-separated item becomes an acceptance checkbox for the Code Reviewer. Vague phrasing ("document the cron") forces the reviewer to invent criteria, which slows Wave 2 and increases churn.
