---
name: agent_team_pattern
description: User prefers multi-agent teams with TDD implementation (Opus), test runner, resolver, reviewer, technical writer, and memory curator
type: feedback
---

When tackling complex implementation tasks, user wants a structured agent team:

1. **TDD Implementer** (Opus) — writes failing tests first, then implements until green
2. **Test Validator** (Sonnet) — runs all tests after implementation, reports failures without fixing
3. **Resolver** (Sonnet) — fixes failures reported by the validator, re-runs to confirm
4. **Code Reviewer** (Sonnet, background) — reviews code quality and produces findings report
5. **Findings Fixer** (Opus) — addresses review findings, runs all tests, iterates until clean
6. **Technical Writer** (Sonnet) — updates docs (README, changelogs, inline comments) after implementation is stable
7. **Memory Curator** (Sonnet, background) — saves important facts and decisions to project memory

**Why:** User values separation of concerns between writing, validating, reviewing, and documenting. Opus for complex implementation and fix work, Sonnet for validation/review/docs.

**How to apply:** Use this pattern when the user says "create a team" or "spawn agents". Launch independent agents in parallel where possible (e.g., Code Reviewer and Memory Curator can run in the background while other agents proceed). Sequential agents (Test Validator → Resolver) wait for dependencies.
