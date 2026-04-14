# Agent Team Workflow (/team skill)

The user's preferred multi-agent implementation pattern is the `/team` skill. These are the load-bearing design decisions — follow them when running `/team` or orchestrating multi-agent work manually.

## Tiers

Three tiers exist; Claude recommends based on task complexity and the user approves:

- **Solo** — 4 agents (smallest scope, tight feedback loop)
- **Squad** — 6 agents
- **Full Team** — 8 agents (includes dedicated Memory Curator wrap-up)

Pick the smallest tier that fits. Over-tiering small tasks wastes coordination overhead; under-tiering large ones produces thin coverage.

## Roles and ownership

- **Architect is the team lead** — trust-but-escalate model. Other agents report to the Architect, not to Claude directly.
- **Implementer** writes source code and updates implementation-coupled tests that break due to source changes (see `implementer-qa-test-ownership.md`).
- **QA writes test scripts at all tiers**, but the full two-phase QA ceremony (plan → execute) runs only at Tier 3.
- **Fixer** addresses review/validation findings and test failures — single merged role (no separate Resolver).
- **Code Reviewer** runs inside the convergence loop, in parallel with the Validator during Phase 3.
- **Memory** — Architect owns memory updates at Tier 1-2; dedicated Memory Curator wrap-up at Tier 3.

## Convergence loop

- Default: **3 iterations**. The Architect may extend to 5 before hard-escalating to the user.
- **Architect self-check:** if the same area fails two consecutive iterations, re-evaluate the design before the Fixer runs again. Same-area repeated failure is a design-level signal, not a fix-level one.

## Validator gating (incident-learned — KZO-74)

The Validator runs **only** after the Architect sends an explicit `[GO]` signal, confirming all blocking tasks are complete. The Validator **must NOT self-activate** based on task completion events.

**Why:** In KZO-74, the Validator ran after Task #1 completed but before Task #2 finished. It produced mixed pass/fail results that wasted a full validation cycle and polluted the state file. The `[GO]` gate was added so the Architect — the only agent with full visibility across blocking dependencies — makes the decision.

## State tracking

`.worklog/team/state.json` is the single source of truth for loop control and phase tracking. Agents read and write this file; Claude uses it to drive scheduling. Do not treat agent-chat transcripts as state.

**How to apply:** Use the `/team` skill, which handles tier recommendation, agent spawning, state tracking, and tier scaling. When orchestrating multi-agent work manually, honor the validator `[GO]` gate and the convergence-loop bounds even without the skill wrapper.
