---
name: agent_team_pattern
description: User prefers multi-agent teams with TDD implementation (Opus), test runner, resolver, and refactoring reviewer
type: feedback
---

When tackling complex implementation tasks, user wants a structured agent team:

1. **TDD Implementation** (Opus) — writes tests first, implements until green
2. **Test Runner** (Sonnet) — runs all tests, reports failures without fixing
3. **Resolver** (Sonnet) — fixes issues the test runner reports, re-runs to confirm
4. **Refactoring Reviewer** (Sonnet, background) — reviews code quality, produces findings report
5. **Follow-up Fixer** (Opus) — addresses review findings, runs all tests, iterates until clean

**Why:** User values separation of concerns between writing, validating, and reviewing. Opus for complex implementation, Sonnet for validation/review.

**How to apply:** Use this pattern when the user says "create a team" or "spawn agents". Launch independent agents in parallel where possible. Sequential agents (test runner → resolver) wait for dependencies.
