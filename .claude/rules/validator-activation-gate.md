# Validator Activation Gate — Explicit [GO] Required, Enumerated Negations

The Validator MUST NOT self-activate under any circumstances. Activation is authorized ONLY by receipt of an explicit `[GO]` envelope from the Architect, addressed to the Validator by name, within the current conversation turn.

## Authoritative activation criteria (one required)

- An Architect-issued `[GO]` or `[ARCHITECT:GO]` message addressed explicitly to the Validator by name in this conversation turn.

## Exhaustive negation list — NONE of these authorize activation

- Task list status flips (other teammates' tasks completing)
- `state.json` `phase` field changes
- `[TRIAGE]` envelopes routed to backend-implementer, QA, or other non-Validator teammates
- Dispatcher poll-cycle messages or heartbeats
- Completion notifications from other teammates
- Time elapsed since a prior run
- User-typed input ("resume", "continue", "go ahead") unless that text is forwarded by the Architect in an explicit `[GO]` envelope addressed to the Validator
- The Validator's own internal sense of "I should check"

## Preamble requirement for [GO] envelopes

All `[GO]` or `[ARCHITECT:GO]` messages to the Validator MUST include this language (or equivalent) to make activation criteria unambiguous:

> Authorization is bound STRICTLY to receipt of this exact `[GO]` envelope addressed to you by name. NONE of the following authorize you to run suites: task list flips, state.json changes, [TRIAGE] envelopes to other teammates, dispatcher poll messages, completion notifications, time elapsed, or your own internal sense that you should check. If you find yourself running suites WITHOUT having received an Architect-issued `[GO]` envelope in this conversation turn, STOP IMMEDIATELY and discard results.

## Handling unauthorized results

If the Validator runs suites without receiving an explicit `[GO]`:
- Results are DIRECTIONAL ONLY — they may inform mid-phase progress sensing but never substitute for a legitimate Phase 3/5 gate
- Architect must explicitly note "this is unauthorized data — Phase [N] [GO] still required" when relaying to the team
- Architect should issue `[FORCE_STOP]` if the Validator has not already gone idle
- Run `lsof -i :4000 -i :3333 -i :4445 -i :4099` before the next legitimate `[GO]` — suites 6+7 spawn webServer processes that may still be running

## Dispatcher SOP (Tier 2-3)

When relaying Architect `[TRIAGE]` envelopes to Phase 4 teammates, do NOT forward or broadcast them to the Validator. The Validator should see only the explicit Phase 5 `[GO]` envelope, not intermediate phase-transition messages.

## Why this is a standalone rule

Two distinct self-activation incidents in KZO-172, both before a legitimate Phase 3/5 [GO]:

1. **Occurrence 1** — Validator interpreted user-typed "resume" (directed at the Dispatcher's polling loop) as a [GO] signal. Ran suites 1-4 + 6-7 against incomplete source (Phase 1 still in_progress). `[FORCE_STOP]` issued; results discarded; lsof sweep required before the legitimate run.

2. **Occurrence 2** — Validator self-activated on ambient activity (likely the Architect's [TRIAGE] envelope to other teammates, or state.json phase changes). Ran the full 8-suite gate mid-Phase-4 without authorization. No [FORCE_STOP] needed (idled after reporting); results were directional only but could have been mistaken for Phase 5 results.

**Operational cost:** each unauthorized run burns 8–12 minutes of compute and risks producing data that looks authoritative but reflects incomplete source state. KZO-74 (first recorded instance) and KZO-172 (two additional instances) establish this as a recurring pattern, not a one-off.

The `[GO]` gate is also documented in `agent-team-workflow.md` ("Validator gating") but without the enumerated negation list. This rule adds the negation list and the preamble template — the parts that directly addressed occurrences 1 and 2.

## How to apply

- **Validator spawn prompt**: include the full activation-criteria section above verbatim.
- **Architect [GO] message**: include the preamble template above.
- **Dispatcher spawn prompt (Tier 2-3)**: include the "do NOT forward [TRIAGE] to Validator" SOP above.
- **Post-incident pre-[GO] check**: `lsof -i :4000 -i :3333 -i :4445 -i :4099` — kill any orphan PIDs before the legitimate gate run.
- **Companion**: `validator-process-hygiene.md` covers spawned-process cleanup; this rule covers activation authorization.
