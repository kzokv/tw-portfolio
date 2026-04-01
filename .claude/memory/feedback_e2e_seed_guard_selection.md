---
name: E2E seed vs reset guard selection
description: assertE2ESeedEnabled (NODE_ENV only) for seed endpoints vs assertE2EResetEnabled (requires dev_bypass) for destructive reset endpoints
type: feedback
---

Use `assertE2ESeedEnabled()` for `/__e2e/seed-*` endpoints and `assertE2EResetEnabled()` for `/__e2e/reset-*` endpoints.

- `assertE2EResetEnabled()` requires `AUTH_MODE=dev_bypass` — appropriate for destructive reset operations
- `assertE2ESeedEnabled()` only checks `NODE_ENV` + `PERSISTENCE_BACKEND=memory` — appropriate for seed-only endpoints that must work in API HTTP tests (which run in `AUTH_MODE=oauth`)

**Why:** KZO-132 discovered that `/__e2e/seed-notification` was blocked in oauth mode because it used the reset guard. API HTTP tests (suite 7) run in oauth mode and need seed endpoints.

**How to apply:** When creating new `/__e2e/*` test-only endpoints, choose the guard based on whether the endpoint is destructive (reset) or additive (seed).
