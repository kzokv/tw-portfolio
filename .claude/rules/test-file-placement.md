# Test File Placement

Test files for `scripts/env-setup/` must live in `libs/config/test/` (prefixed `env-setup-*`), NOT in `scripts/env-setup/`. `scripts/` is not an npm workspace — `npm run test --workspaces` and vitest never discover tests placed there. When writing tests for any module under `scripts/`, place the test file in `libs/config/test/` with a descriptive prefix (e.g., `env-setup-generator.test.ts`). The import path is `../../scripts/env-setup/module.js`.

**How to apply:** When adding tests for any module under `scripts/`.
