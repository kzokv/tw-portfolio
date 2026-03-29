# E2E AAA Guardrails

For Playwright E2E in this repo, keep Phase 5d-style parallel execution at 2 workers but avoid same-file `fullyParallel` fan-out. Prefer deterministic route-ready markers, route prewarming, and probe-based waits over fixed sleeps, especially for client-hydrated ticker and auth flows.

**How to apply:** When writing or reviewing E2E test configurations and parallel execution settings.
