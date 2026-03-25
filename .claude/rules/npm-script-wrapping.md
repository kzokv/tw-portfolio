# npm Script Wrapping

Do NOT wrap shell scripts that require positional arguments as npm scripts. Document direct invocation instead.

```json
// ✅ OK — no required args, simple flag variants
"dev:docker:validate": "bash infra/scripts/validate-local.sh",
"dev:docker:validate:teardown": "bash infra/scripts/validate-local.sh --teardown"

// ❌ Wrong — positional args make npm forwarding clunky
"redeploy": "bash infra/scripts/redeploy-service.sh"
// User has to type: npm run redeploy -- -e dev api
// Instead of:       bash infra/scripts/redeploy-service.sh -e dev api
```

**Why:** The `npm run -- ` forwarding syntax is clunkier than calling the script directly. User preference established during infra tooling setup.

**How to apply:** Only create npm script wrappers for scripts that take no required arguments or have simple fixed flag variants. For scripts with required positional args, document direct invocation in README or script header comments.
