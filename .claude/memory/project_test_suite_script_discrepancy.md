---
name: full-test-suite-script-discrepancy
description: "full-test-suite.md rule references test:integration:full:host which doesn't exist in package.json"
type: project
---

The `.claude/rules/full-test-suite.md` rule specifies `npm run test:integration:full:host` as the integration test command. This script does **not** exist in `apps/api/package.json`. The actual working script is `npm run test:integration:full --prefix apps/api`.

Similarly, `npm run test:unit --prefix apps/web` does not exist — the actual script is `npm run test --prefix apps/web`.

**Why:** Discovered during KZO-109 and KZO-113 validation. The Validator couldn't run the commands verbatim and had to fall back to alternatives.

**How to apply:** When running tests, use the actual package.json scripts. The rule file should be updated to match. Until corrected, treat `test:integration:full:host` as an alias intent for `test:integration:full`.
