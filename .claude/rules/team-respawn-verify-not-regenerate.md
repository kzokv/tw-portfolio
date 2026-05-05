# Team Agent Respawn: Verify-Not-Regenerate

When an agent goes silent mid-task, the Architect must inventory what is actually on disk before deciding whether to respawn. The default respawn brief is "VERIFY what is on disk, then proceed — do NOT regenerate what already exists."

## The failure mode to avoid

Agent goes silent after ~8 hours of overnight work. Architect assumes nothing landed and spawns a "regenerate from scratch" brief. The agent regenerates ~1870 LOC already on disk, wasting compute and potentially creating divergent code artifacts from the original implementation (since LLM regeneration is not deterministic).

## The verification-first protocol

When an agent has been silent past the timeout threshold:

1. **Inventory the disk state** — Architect runs `git status` + `git diff --stat` (or equivalent) to determine what files exist and how much code is already on disk.
2. **Classify the gap** — compare disk state against the task's scope:
   - **Substantially complete**: respawn with "VERIFY only — do NOT regenerate; read what's on disk, run the narrow missing steps, report done."
   - **Partially complete**: respawn with "READ what exists, implement only the missing pieces listed below; do NOT duplicate what's on disk."
   - **Empty/nothing landed**: respawn with a full implementation brief.
3. **Name what already exists in the respawn brief** — list the specific files + approximate LOC counts observed on disk. This prevents the respawn agent from assuming it needs to create what already exists.
4. **Name what is missing** — list the specific steps/files that are absent. This prevents the respawn agent from re-implementing complete files.

## Canonical brief shape for substantially-complete respawn

```
[RESPAWN: VERIFY-NOT-REGENERATE]

Work is substantially complete on disk (~1870 LOC observed). Your task is:
1. READ each file listed below and confirm it matches the scope-todo spec.
2. Run the minimal missing step(s): [specific list].
3. DO NOT regenerate anything that already exists.

Files confirmed on disk:
- apps/api/src/services/market-data/providers/yahooFinanceAu.ts (334 LOC)
- apps/api/src/services/market-data/providers/mockYahooFinanceAu.ts (233 LOC)
- [... etc]

Missing (implement only these):
- [specific step N from scope-todo]
```

## Why "VERIFY only" is safer than "regenerate"

- Regeneration produces divergent code — LLM outputs are not deterministic; a re-implementation will differ from the original in subtle ways that may conflict with tests QA has already written against the original implementation.
- Regeneration burns context — at 1870+ LOC, a full re-implementation consumes substantial context budget and may lose detail from the original that the QA tests depend on.
- Disk state is authoritative — if `git diff` shows the file exists, it exists. The agent can and should read it, not recreate it.

## Pre-respawn hygiene

Before sending the respawn brief, confirm:
- `lsof -i :4000 -i :3333 -i :4445 -i :4099` — no orphan processes from the silent agent's last test run
- `git status` — confirm files are actually on disk (not just in the Architect's prior context window)
- The scope-todo phase markers — identify exactly which phase/step the silent agent was last on, so the respawn brief names only the remaining gap

## Why this is a rule

KZO-172 — Backend Implementer went silent after overnight work. Architect ran `git status` + `git diff --stat` and found ~1870 LOC across 10+ files already on disk (provider class, mock, route, rate-limit lib, env vars, stubs, etc.). All pre-work was correct and aligned with the scope-todo. The respawn brief was written as "VERIFY only — proceed from the gap" rather than "implement from scratch." The respawn agent completed the remaining steps (task #6 missing endpoint) and reported `[DONE:CLEAN]` in one pass — zero duplicated work.

A separate incident (QA went silent overnight) self-resolved before respawn was issued. The disk-inventory step confirmed QA's work was also on disk; no respawn was needed.

## How to apply

- **When any teammate exceeds the 8-minute unresponsive threshold and has been working for >30 minutes**: run the disk inventory before writing the respawn brief. Never assume "nothing landed."
- **The respawn brief subject line**: always include `[RESPAWN: VERIFY-NOT-REGENERATE]` or `[RESPAWN: PARTIAL]` so the respawned agent immediately knows its context.
- **Tier applies**: all tiers (Tier 1 Architect self-inventory, Tier 2-3 Dispatcher + Architect collaboration on triage).
