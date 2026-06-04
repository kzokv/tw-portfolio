# Managed Postgres Integration Harness

When `npm run test:integration:full:host` fails before assertions with `connect ETIMEDOUT`, `Connection terminated due to connection timeout`, `timeout exceeded when trying to connect`, or Redis connect stalls, triage the managed test harness before changing product behavior.

## The Rule

For host-mode managed Postgres/Redis integration runs:

1. Keep Postgres and Redis connection timeouts bounded through config/env, not hardcoded sleeps.
2. Probe host-port reachability before running Vitest, and try the explicit host, `localhost`, Docker host aliases, and the VM default gateway before concluding the app code is broken.
3. Avoid eager Redis connection during Postgres persistence test bootstrap unless the test actually needs Redis-backed behavior; lazy connection keeps DB-only integration suites from hanging on Redis startup noise.
4. Keep managed-integration Vitest workers low enough for the CI container and host networking path. Do not treat pool exhaustion or connection-acquire timeout as a product regression until the harness has retried bounded acquisition.
5. Document new harness knobs in `docs/002-operations/runbook.md` when adding them to `libs/config`.

## Why

KZO-197 provider-console validation repeatedly failed `test:integration:full:host` with `connect ETIMEDOUT 192.168.64.1:15432` and `timeout exceeded when trying to connect` across unrelated old integration tests. The fix was harness-level: host-port polling, bounded Postgres/Redis connection timeouts, lazy Redis init for Postgres persistence tests, single-worker managed integration runs, and retrying transient pool acquisition. After that, the same suite passed locally with 79 files, 779 passing tests, and 1 skipped test.

## How To Apply

- If the failure happens before the test's domain assertion, inspect `scripts/test-integration-ci-lib.sh`, `apps/api/vitest.config.ts`, and integration setup files first.
- If the failure only appears in host mode, verify host resolution and port polling before touching persistence semantics.
- If a new dependency is added to Postgres persistence initialization, decide whether it must eagerly connect in `init()` or can connect lazily at first use.
