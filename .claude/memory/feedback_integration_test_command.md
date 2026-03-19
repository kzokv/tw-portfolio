---
name: Integration test command for development
description: Use test:integration:ci:host instead of test:integration for development work in tw-portfolio
type: feedback
---

Always run `test:integration:ci:host` (not `test:integration`) for development work.

**Why:** User explicitly corrected this — `test:integration:ci:host` is the correct command for local dev integration testing.

**How to apply:** Any time integration tests need to be run in this project during development, use `pnpm --filter @tw-portfolio/api test:integration:ci:host` (or the workspace equivalent).
