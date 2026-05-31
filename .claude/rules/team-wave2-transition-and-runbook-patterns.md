# /team Wave 2 — Transition Note + Runbook Patterns

Two durable patterns for `/team` Wave 2 Technical Writer output. Both are recurring (observed across KZO-172, -177, -194, -195, -196) and routinely missed when the brief is written ad-hoc.

## Transition note must include a process-notes section

Every transition note for a multi-agent team run includes a `## Process notes` section (lettered if numbered subsections are already in use) covering:

1. **Validator self-activation incidents** — if the Validator activated without a proper `[ARCHITECT:GO]`, record the trigger phrase, the discarded output, and the Architect's mitigation. Companion: `.claude/rules/validator-activation-gate.md` documents the activation contract; process notes preserve the per-run incident.
2. **Scope-todo doc-drift findings** — if QA or Implementer discovered path/name discrepancies between scope-todo and actual repo conventions, record the adjudicated resolution. Without this, the next ticket-author re-discovers the same drift.
3. **Code Reviewer Informational tier** — transcribe all Informational items from the CR doc into the transition note as deferred design-decision bullets. The CR doc may live in `.worklog/` (ephemeral, gitignored); the transition note is frozen in `docs/004-notes/` and survives cleanup.
4. **Original-agent-revival outcomes** — if the team triggered a respawn under `team-respawn-verify-not-regenerate.md`, record whether the original revived, whether outputs converged, and how the parking decision played out.

**Why:** KZO-172 — without process notes, the `[ARCHITECT:GO]` preamble convention and a test-file path discrepancy (`providers/yahooFinanceAu.test.ts` in scope-todo vs `test/unit/yahooFinanceAuProvider.test.ts` actual) would have been lost after `.worklog/` cleanup. KZO-196 — the park-don't-kill respawn outcome (original revived, converged with respawn agent) is now a load-bearing precedent that lives in the transition note's process section.

## Runbook: new market data provider section

When a new market data provider ships with its own env vars, ToS constraint, and observability signals, append a dedicated numbered section `## N. KZO-XXX deploy notes — {market} market data ingestion` to `docs/002-operations/runbook.md` immediately after the previous provider's section.

The section must cover:

- **Env var table** — `var | default | purpose` rows
- **Startup warning semantics** — what logs fire on boot, what they mean
- **Catalog shape** — bounded vs exhaustive, first-deploy behavior
- **History start** — earliest backfill date the provider supports
- **Job-queue observability SQL** — `pgboss.job` query snippets for runbook operators
- **Endpoint-specific log signals** — what to grep for during incident triage

**Why:** KZO-172 — the runbook previously ended at §18 (KZO-164 FX). Without §19, an operator deploying KZO-172 would have no guidance on `AU_PROVIDER_MOCK`, `YAHOO_AU_RATE_LIMIT_PER_MINUTE`, or the `yahoo_finance_tos_notice` boot log. Companion rule `doc-stale-forward-notes.md` covers REPLACING stale "future candidate" notes in-place; this rule covers ADDING new provider sections where none existed.

**How to apply:** Wave 2 Technical Writer task description must enumerate both requirements:

```
- Add `## Process notes` section to docs/004-notes/{slug}/transition-{datetime}.md covering:
  1. Validator self-activation incidents (none / [verbatim])
  2. Scope-todo doc-drift adjudications
  3. CR Informational items (transcribed verbatim)
  4. Original-agent respawn outcomes (if respawn ran)

- If new market data provider in scope: append `## N. KZO-XXX deploy notes — {market} ingestion`
  section to docs/002-operations/runbook.md with env-var table, startup logs, catalog shape,
  history start, pgboss observability SQL, log grep signals.
```

Whenever a new market data provider ticket ships with operator-facing env vars, check the runbook for any stale "future candidate" note for that provider first; replace in-place per `doc-stale-forward-notes.md`. If no stale note exists, append a new numbered section per this rule. Pair both bullets in the same Wave 2 task description so the Code Reviewer has a concrete acceptance checklist.

Companion rules: `pr-bound-docs-review-compliance.md` (PR-body structural compliance — different scope, applies to `.worklog/team/pr-description-draft.md`); `doc-management.md` (frozen vs evergreen lifecycle for `docs/`).
