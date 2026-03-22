---
name: scripts_test_location
description: Test files for scripts/env-setup/ must live in libs/config/test/ because scripts/ is not a workspace
type: feedback
---

Test files for `scripts/env-setup/` must live in `libs/config/test/` (prefixed `env-setup-*`), NOT in `scripts/env-setup/`.

**Why:** `scripts/` is not an npm workspace. `npm run test --workspaces` (and `vitest` via workspace config) never discovers tests under `scripts/`. Tests placed there are orphaned — they pass locally but never run in CI.

**How to apply:** When writing tests for any module under `scripts/`, place the test file in `libs/config/test/` with a descriptive prefix (e.g., `env-setup-generator.test.ts`, `env-setup-targets.test.ts`). The import path is `../../scripts/env-setup/module.js`.
