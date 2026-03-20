---
name: feedback_agent_team_validator_gate
description: Architect must explicitly gate the validator with a "[GO]" message; validator must not self-activate when tasks complete
type: feedback
---

The Architect must send an explicit `[GO] Run validation now` message to the validator only after ALL blocking tasks are confirmed complete. The validator must NOT self-activate based on task completion events alone.

**Why:** In KZO-74, the validator ran the pipeline after Task #1 completed but before Task #2 (senior-qa's E2E test updates) finished. This produced 3 "expected" failures mixed with real regressions, wasting a full validation cycle and sending mixed signals to the Fixer. The task dependency system is advisory, not enforced.

**How to apply:**
- Architect: before sending `[GO]` to the validator, verify each blocking task is marked `completed` in the task list
- Validator: treat any incoming message other than an explicit `[GO]` from the Architect as informational; do NOT start pipeline runs autonomously
- If in doubt, validator should message Architect: "Ready to run — confirm all blocking tasks are done?"
