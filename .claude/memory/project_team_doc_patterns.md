---
name: team-doc-patterns
description: Durable patterns for /team Wave 2 Technical Writer output and operator runbook additions
type: project
---

## Transition note must include a process-notes section

When writing a transition note for a multi-agent team run, always include a `## (l) Process notes` section (or equivalent lettered section) covering:

1. **Validator self-activation incidents** — if the Validator activated without a proper `[GO]`, record the trigger phrase, discarded output, and Architect's mitigation.
2. **Scope-todo doc-drift findings** — if QA or Implementer discovered path/name discrepancies between scope-todo and actual repo conventions, record the adjudicated resolution.
3. **Code Reviewer Informational tier** — transcribe all Informational items from the CR doc into the transition note as deferred design-decision bullets. The CR doc may be in `.worklog/` (ephemeral); the transition note is frozen (durable).

**Why:** KZO-172 — without process notes, the `[ARCHITECT:GO]` preamble convention and the test-file path discrepancy (`providers/yahooFinanceAu.test.ts` in scope-todo vs `test/unit/yahooFinanceAuProvider.test.ts` actual) would have been lost after `.worklog/` cleanup.

## Runbook: new market data provider section

When a new market data provider ships with its own env vars, ToS constraint, and observability signals, append a dedicated numbered section `## N. KZO-XXX deploy notes — {market} market data ingestion` to `docs/002-operations/runbook.md` immediately after the previous provider's section.

The section must cover: env var table (var / default / purpose), startup warning semantics, catalog shape (bounded vs exhaustive, first-deploy behavior), history start, job-queue observability SQL, and endpoint-specific log signals.

**Why:** KZO-172 — the runbook previously ended at §18 (KZO-164 FX). Without §19, an operator deploying KZO-172 would have no guidance on `AU_PROVIDER_MOCK`, `YAHOO_AU_RATE_LIMIT_PER_MINUTE`, or the `yahoo_finance_tos_notice` boot log. The `doc-stale-forward-notes.md` rule covers REPLACING stale "future candidate" notes; this pattern covers ADDING new provider sections where none existed.

**How to apply:** whenever a new market data provider ticket ships with operator-facing env vars. Check the runbook for any stale "future candidate" note for that provider first; replace in-place per `doc-stale-forward-notes.md`. If no stale note exists, append a new numbered section.
