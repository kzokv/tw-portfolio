---
name: agent_team_pattern
description: User's multi-agent team workflow evolved into /team skill with 3 tiers, convergence loop, Architect-as-lead, and state file tracking
type: feedback
---

User's agent team pattern has been formalized as the `/team` skill at `.codex/skills/team/`. This supersedes the original 7-agent flat pattern.

Key design decisions (2026-03-20):
1. **Resolver + Findings Fixer merged** into single Fixer agent
2. **Architect is team lead** with trust-but-escalate model
3. **3 tiers:** Solo (4 agents), Squad (6), Full Team (8) — Claude recommends, user approves
4. **QA writes test scripts at all tiers** — full two-phase ceremony only at Tier 3
5. **Convergence loop:** 3 default iterations, Architect can extend to 5, then hard escalate
6. **Architect self-check:** if same area fails 2 consecutive iterations, re-evaluate design
7. **Memory:** Architect owns at Tier 1-2, dedicated Memory Curator wrap-up at Tier 3
8. **State file:** `.team/state.json` with `.team/state.lock` for concurrent write safety
9. **Code Reviewer runs inside the loop**, parallel with Validator in Phase 3

**Why:** User values separation of writing/validating/reviewing, wants bounded iteration with escape hatches, and needs tier scaling to avoid over-engineering small tasks.

**How to apply:** Use `/team` skill instead of manually spawning agents. The skill handles tier recommendation, agent spawning, state tracking, and scaling.
