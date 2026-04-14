---
name: user_profile
description: Who the user is and how they work — role, expertise, working style
type: user
---

The user is a senior software engineer building **tw-portfolio** — a personal finance portfolio tracker for TWSE (Taiwan Stock Exchange) stocks. The app tracks transactions, dividends, lot allocations, and historical market data.

**Tech stack:** TypeScript monorepo, Next.js (web), Fastify (API), PostgreSQL, Playwright E2E, Vitest unit/integration, Docker on QNAP NAS.

**Working style:**
- Works on git worktrees (e.g., `kzo-115` branch → `.claude/worktrees/kzo-115/`)
- Uses `/scope-grill` to lock scope before writing code, then `/team` for agent-led implementation
- Post-implementation code review via `/code-reviewer` or explicit review pass, then fix-list TDD top-down
- Commits memory curation and other chore work to the active feature worktree branch, not to `dev` directly
- Commits frequently; each commit is independently compilable; prefers separate commits for off-scope changes rather than PR splits
- Runs `/si:review` and `/si:promote` to maintain durable memory
- Expects terse responses — no trailing summaries, no filler

**Expertise level:** Very high. Doesn't need explanation of TypeScript, SQL, or standard patterns. Frame feedback in terms of trade-offs and project conventions, not basics.
