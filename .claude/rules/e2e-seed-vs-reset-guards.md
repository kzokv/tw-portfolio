# E2E Seed vs Reset Guard Selection

Use `assertE2ESeedEnabled()` for `/__e2e/seed-*` endpoints and `assertE2EResetEnabled()` for `/__e2e/reset-*` endpoints.

- `assertE2EResetEnabled()` requires `AUTH_MODE=dev_bypass` — appropriate for destructive reset operations
- `assertE2ESeedEnabled()` only checks `NODE_ENV` + `PERSISTENCE_BACKEND=memory` — appropriate for seed-only endpoints that must work in API HTTP tests (which run in `AUTH_MODE=oauth`)

**Why:** KZO-132 discovered that `/__e2e/seed-notification` was blocked in oauth mode because it used the reset guard. API HTTP tests (suite 8) run in oauth mode and need seed endpoints.

**How to apply:** When creating new `/__e2e/*` test-only endpoints, choose the guard based on whether the endpoint is destructive (reset) or additive (seed). Also applies when extending existing `/__e2e/oauth-session` or similar endpoints for new test scenarios (e.g., KZO-144 multi-user admin tests).
