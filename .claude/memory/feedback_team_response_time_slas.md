---
name: team-response-time-slas
description: Architect [TRIAGE] response-time gaps and Validator long-suite false-alarms — process refinements for /team runs
type: feedback
---

Two `/team` orchestration patterns surfaced in KZO-185 that aren't enforceable rules but shape how the next run should be wired. Worth carrying forward as Architect/Dispatcher prompt deltas.

## Architect [TRIAGE] response-time gap

**Observation (KZO-185 iter 1):** the Architect was non-responsive to the Dispatcher's `[TRIAGE]` prompt for ~20 minutes after Phase 3 completed. The Dispatcher correctly auto-escalated to the team-lead, who nudged the Architect; triage then arrived in <1 min.

**Why this is fragile:** the auto-escalation works, but it adds a coordination round-trip that the team-lead shouldn't have to handle. Every additional escalation also burns a context-switch on the human. In a busier orchestration where the team-lead is offline, the team would stall.

**How to apply:** when authoring Architect spawn prompts (`/team` skill or manual), include an explicit response-SLA line:

> Respond to `[TRIAGE]` and `[DECISION_NEEDED]` prompts within 5 minutes. If you genuinely need longer (deep design re-evaluation, large diff to read), reply with `[HEARTBEAT-DEFER: ~Nm]` so the dispatcher knows to wait. Silent gaps over 8 minutes will trigger dispatcher auto-escalation to the team-lead.

The protocol is symmetric: Architect commits to a cadence; Dispatcher commits to not auto-escalating below that cadence. Worth baking into the `team` skill's role-definitions for the Architect.

## Validator long-suite [HEARTBEAT] gap

**Observation (KZO-185 phase 3):** the Validator was flagged `unresponsive` after the Dispatcher's 8-min stale + 2-min grace window during a legitimate Suites 6+7 run. Resolved 15 min later when the validator naturally completed and reported. False alarm.

**Root cause:** the canonical pre-push gate (`npm run test:all:full`) routinely takes 8–12 minutes, and Suites 6+7 (E2E bypass + oauth) dominate at 5–10 minutes apiece. The default per-role stale threshold doesn't model this. Dispatcher escalating during legitimate work is wasted attention.

**How to apply (two compatible knobs — pick either or both):**

1. **Validator-side `[HEARTBEAT]` ping**: when the Validator spawns and starts a long suite run, emit `[HEARTBEAT] running suite N (ETA ~Mm)` every 5 min until the suite completes. The Dispatcher's stale-threshold counter resets on any inbound message.

2. **Dispatcher-side role-specific threshold**: extend the stale window for the validator role specifically — e.g. `staleThresholds.validator = 15min` instead of the default 8min — for the duration of an active validation run.

The cleaner shape is (1): the heartbeat is observable proof the validator is alive, and doesn't require the Dispatcher to know which role is in which phase. (2) is a fallback if heartbeating proves cumbersome.

## Source

Both observations from `.worklog/team/memory/consolidated.md` (KZO-185 team shutdown 2026-05-01). Full context: validator iter 2 escalation timeline, Architect iter 1 phase 3→4 transition gap.

## How to apply (summary)

- Architect role spec (`/team` skill or future custom prompts): add the 5-min SLA + `[HEARTBEAT-DEFER]` protocol line.
- Validator role spec: add a `[HEARTBEAT]` every 5 min during long suite runs.
- Dispatcher role spec: stale thresholds should be role-aware, not global; default 8min, validator 15min during active runs.
- These are NOT rules in `.claude/rules/` because they're process-tier refinements specific to the multi-agent skill, not codebase invariants. Live here until the `/team` skill is updated to bake them into role definitions, then this entry can be retired.
