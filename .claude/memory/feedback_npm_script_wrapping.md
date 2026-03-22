---
name: feedback_npm_script_wrapping
description: CLI scripts with positional args should NOT be wrapped as npm scripts; direct invocation is preferred
type: feedback
---

Do NOT wrap shell scripts that require positional arguments as npm scripts.

**Why:** The `npm run -- ` forwarding syntax is clunkier than calling the script directly. User confirmed this when we decided not to wrap `redeploy-service.sh -e <env> <service>`.

**How to apply:** Only create npm script wrappers for scripts that take no required arguments or have simple fixed flag variants (e.g., `dev:docker:validate` wraps `validate-local.sh` with no args, `dev:docker:validate:teardown` wraps it with `--teardown`). For scripts with required positional args, document direct invocation instead.
