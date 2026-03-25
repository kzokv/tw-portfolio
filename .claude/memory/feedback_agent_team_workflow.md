---
name: feedback_agent_team_workflow
description: User's /team skill design decisions — 3 tiers, convergence loop, Architect-as-lead, validator gating
type: feedback
---

User's agent team pattern is formalized as the `/team` skill. Key design decisions (2026-03-20):

1. **Resolver + Findings Fixer merged** into single Fixer agent
2. **Architect is team lead** with trust-but-escalate model
3. **3 tiers:** Solo (4 agents), Squad (6), Full Team (8) — Claude recommends, user approves
4. **QA writes test scripts at all tiers** — full two-phase ceremony only at Tier 3
5. **Convergence loop:** 3 default iterations, Architect can extend to 5, then hard escalate
6. **Architect self-check:** if same area fails 2 consecutive iterations, re-evaluate design
7. **Memory:** Architect owns at Tier 1-2, dedicated Memory Curator wrap-up at Tier 3
8. **State file:** `.worklog/team/state.json` for loop control and phase tracking
9. **Code Reviewer runs inside the loop**, parallel with Validator in Phase 3

**Validator gating (KZO-74 incident):** Architect must send explicit `[GO]` to the Validator only after ALL blocking tasks are confirmed complete. Validator must NOT self-activate based on task completion events. In KZO-74, the validator ran after Task #1 completed but before Task #2 finished, producing mixed failures that wasted a full validation cycle.

**Why:** User values separation of writing/validating/reviewing, wants bounded iteration with escape hatches, and needs tier scaling to avoid over-engineering small tasks.

**How to apply:** Use `/team` skill. The skill handles tier recommendation, spawning, state tracking, and scaling.
