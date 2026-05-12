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
- `TaskUpdate(status: "in_progress")` fired by the Dispatcher on this very Validator task — Dispatcher-managed task-status transitions are NOT `[GO]` signals; only Architect-issued `[GO]` envelopes authorize activation (KZO-189 occurrence 3)

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

Three self-activation incidents across KZO-172 (×2) and KZO-189 (×1), all before a legitimate Phase 3/5 [GO]:

1. **Occurrence 1** — Validator interpreted user-typed "resume" (directed at the Dispatcher's polling loop) as a [GO] signal. Ran suites 1-4 + 6-7 against incomplete source (Phase 1 still in_progress). `[FORCE_STOP]` issued; results discarded; lsof sweep required before the legitimate run.

2. **Occurrence 2** — Validator self-activated on ambient activity (likely the Architect's [TRIAGE] envelope to other teammates, or state.json phase changes). Ran the full 8-suite gate mid-Phase-4 without authorization. No [FORCE_STOP] needed (idled after reporting); results were directional only but could have been mistaken for Phase 5 results.

3. **Occurrence 3 (KZO-189)** — Dispatcher set the Validator's task to `in_progress` as the Phase 5 [GO] mechanism. The Validator treated this as authorization and began running suites. Architect caught it and issued an explicit `[ARCHITECT:GO]` to formalize; suites ran but the activation signal was wrong. The Dispatcher subsequently held for explicit `[ARCHITECT:GO]` for the iteration-2 validation run — no further incidents.

4. **Occurrence 4 (KZO-199) — Architect-side envelope drop, gate held correctly**. Phase 3 iter 1: Architect's `[STATUS]` summarized "Phase 3 launched — [ARCHITECT:GO] envelopes issued to both [validator + code-reviewer]" but only the code-reviewer envelope was actually `SendMessage`-d. The validator's `[GO]` either never sent or routed to a different recipient. Validator stayed correctly gated (the activation rules above held — the Validator did NOT self-activate on Task #3 creation, the Dispatcher's `[ARCHITECT:CHECK]` ack, or any other ambient signal). Code-reviewer ran and reported [DONE]; Dispatcher then surfaced "validator still pending GO" via `[DISPATCHER:STATUS]` to Architect. Main session noticed and nudged. Architect re-issued `[ARCHITECT:GO]` to validator with the full preamble; validator activated and reported clean. **No false data, no [FORCE_STOP] needed** — the gate worked. The bug was in the Architect's send-discipline, not the Validator's activation-discipline.

**This is a different failure class than 1–3.** Occurrences 1–3 were Validator over-activation (the gate failed open). Occurrence 4 was Architect under-dispatch (the gate worked, but the upstream envelope was missing). Detection mechanism: the Dispatcher's status reporting ("X still pending GO") is the canonical signal — any time the Architect claims to have issued GOs to multiple teammates and only some show task-progression, the main session or Dispatcher should verify each envelope independently.

**Mitigation for occurrence 4:**
- Architect spawn prompt: when issuing GOs to multiple teammates in the same phase, send each `[ARCHITECT:GO]` envelope as a SEPARATE `SendMessage` call addressed by name. Do NOT batch into a single message claim ("issued to both") without per-recipient sends.
- Dispatcher SOP: on phase advancement, after task creation, surface a `[DISPATCHER:GATE-STATUS]` snapshot every ~5 min listing each gated teammate + whether their `[GO]` has landed. Treat "pending GO past 5 min" as a soft escalation to Architect.
- Main session SOP: when Architect's STATUS summarizes parallel `[GO]`s to N teammates, expect N TaskUpdate transitions to `in_progress` within ~2 min. If any teammate stays `pending`, nudge Architect to verify the envelope was actually sent.

5. **Occurrence 5 (admin-ui-bugs / 2026-05-12) — Code Reviewer self-activated on the initial team-lead spawn briefing.** Before the Architect issued any `[ARCHITECT:GO]` envelope, the Code Reviewer interpreted its briefing message as authorization to start a Phase-3-style review pass against the in-flight Implementer diff. It produced a `[CODE-REVIEWER:DONE]` FIX-REQUIRED verdict with 3 HIGH + 2 MEDIUM findings — all wrong, because they were computed against an intermediate disk state (Bug 1 still in progress; stale `.next/standalone/` artifact matched the deprecated `provider-rerun-tooltip-*` testids in regex searches). The Architect verified disk truth via `git diff --stat` + targeted greps, issued `[HOLD]` to Code Reviewer; Code Reviewer self-disclosed the unauthorized run and discarded the review. One coordination round-trip wasted; no bad data propagated. The legitimate Phase 5 CR re-ran on the final post-Implementer state and produced a clean FIX-REQUIRED with 1 MEDIUM (indentation) + 1 LOW.

**This is the same failure class as occurrences 1–3** (over-activation on ambient signals), but now demonstrated on Code Reviewer rather than Validator. The activation-gate protocol must apply to **both** roles.

## Code Reviewer is gated by the same rules (added 2026-05-12 after Occurrence 5)

The Code Reviewer MUST NOT self-activate on any of the following signals:

- The initial team-lead spawn briefing (containing the role definition, scope-todo path, and architect-design path) is NOT activation. It is preparation — read the briefing, read the source files, then **wait** for `[ARCHITECT:GO]`.
- Implementer or QA `[DONE]` messages from peers.
- Dispatcher task-creation events or `TaskUpdate(in_progress)` flips on the CR's task.
- The Architect's `[STATUS]` summaries to other teammates.
- Any time-elapsed heuristic ("the team has been running for X minutes; surely Phase 3 has started").

Activation requires an **explicit `[ARCHITECT:GO]` envelope addressed to `code-reviewer` by name** with the standard preamble. Pre-`[GO]` review work (file reads, mental modeling, locking on the diff to review) is fine, but no `[CODE-REVIEWER:DONE]` envelope may be sent without a legitimate GO.

If the Code Reviewer produces results without a legitimate `[GO]`, the protocol is identical to the Validator's: results are DIRECTIONAL ONLY, self-disclose to the Architect, discard the review doc, and re-run fresh after the proper Phase 5 `[GO]` arrives.

**Stale-artifact warning for Code Reviewer's early greps.** Even legitimate Phase 5 CR runs must verify regex matches against `git diff` / source paths, not against `.next/standalone/` or other build artifacts. Occurrence 5's HIGH-1 "Bug 1 entirely absent" finding was triggered by old `provider-rerun-tooltip-*` testids still living in the stale standalone bundle — a build artifact, not source. The CR brief should include: "Any regex hit inside `.next/`, `dist/`, or other build-output directories is NOT a finding. Scope greps to `apps/`, `libs/`, and `.claude/` source paths."

**Operational cost:** each unauthorized run burns 8–12 minutes of compute and risks producing data that looks authoritative but reflects incomplete source state. KZO-74 (first recorded instance), KZO-172 (two additional instances), KZO-189 (one additional instance), and KZO-199 (architect-side envelope drop) establish this as a recurring pattern, not a one-off.

The `[GO]` gate is also documented in `agent-team-workflow.md` ("Validator gating") but without the enumerated negation list. This rule adds the negation list and the preamble template — the parts that directly addressed occurrences 1 and 2.

## How to apply

- **Validator spawn prompt**: include the full activation-criteria section above verbatim.
- **Architect [GO] message**: include the preamble template above.
- **Dispatcher spawn prompt (Tier 2-3)**: include the "do NOT forward [TRIAGE] to Validator" SOP above.
- **Post-incident pre-[GO] check**: `lsof -i :4000 -i :3333 -i :4445 -i :4099` — kill any orphan PIDs before the legitimate gate run.
- **Companion**: `validator-process-hygiene.md` covers spawned-process cleanup; this rule covers activation authorization.
