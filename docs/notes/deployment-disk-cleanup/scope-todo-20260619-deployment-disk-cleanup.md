---
slug: deployment-disk-cleanup
source: scope-grill
created: 2026-06-19
tickets: []
required_reading:
  - infra/scripts/deploy.sh
  - infra/scripts/backup-postgres.sh
  - infra/scripts/redeploy-service.sh
  - .github/workflows/_deploy-reusable.yml
  - docs/002-operations/runbook.md
  - docs/002-operations/ci-cd.md
superseded_by: null
---

# Todo: Deployment Disk Cleanup

> For agents starting a fresh session: this todo is the locked scope from the scope-grill session. Read the referenced scripts and docs before implementation.

## Implementation Steps

- [x] Move the pre-migration Postgres backup phase in `infra/scripts/deploy.sh` so it runs before Docker image builds.
- [x] Add backup-safe Postgres readiness before backup: `pg_isready` plus `SELECT NOT pg_is_in_recovery()`, with `DEPLOY_POSTGRES_BACKUP_READY_TIMEOUT_SECONDS` defaulting to `120`.
- [x] Update `infra/scripts/backup-postgres.sh` to write dumps atomically via a temporary file and rename only after `pg_dump | gzip` succeeds.
- [x] Add environment-aware backup retention to `infra/scripts/backup-postgres.sh`: production defaults to `30` days and `60` files; dev defaults to `7` days and `20` files.
- [x] Preserve `RETAIN_DAYS` as a backward-compatible alias while adding `BACKUP_RETAIN_DAYS` and `BACKUP_RETAIN_MAX_FILES`.
- [x] Prune old backup files only after the new backup succeeds.
- [x] Add a small shared Docker disk helper, likely `infra/scripts/lib/docker-disk.sh`, for disk diagnostics, threshold checks, and bounded cleanup.
- [x] Add hard Docker disk preflight before builds using configurable defaults: `DEPLOY_MIN_DOCKER_FREE_GB=25`, `DEPLOY_MIN_DOCKER_FREE_PERCENT=15`, and `DEPLOY_BUILDER_KEEP_STORAGE=20GB`.
- [x] Wire `infra/scripts/deploy.sh` into the shared Docker disk helper before image builds and in the exit trap.
- [x] Run bounded cleanup on every `deploy.sh` exit: `docker container prune -f`, `docker image prune -f`, and `docker builder prune -f --keep-storage "$DEPLOY_BUILDER_KEEP_STORAGE"`.
- [x] Keep app-image cleanup success-only; do not run tagged app-image cleanup on failed deploys.
- [x] Wire `infra/scripts/redeploy-service.sh` into the shared Docker disk helper for build preflight and bounded exit cleanup.
- [x] Add remote Docker disk diagnostics to `.github/workflows/_deploy-reusable.yml` before deploy, after deploy when practical, and in failure diagnostics; do not run workflow-level cleanup.
- [x] Add or update focused infra tests under `infra/scripts/__tests__/` for backup retention defaults, retention overrides, and helper logic where practical.
- [x] Update `docs/002-operations/runbook.md` and `docs/002-operations/ci-cd.md` to document backup-before-build ordering, backup readiness, Docker disk guardrails, cleanup behavior, diagnostics, and backup retention; update the CI/CD phase diagram and phase table that currently show build before backup.
- [x] Validate changed shell scripts with `bash -n infra/scripts/deploy.sh infra/scripts/backup-postgres.sh infra/scripts/redeploy-service.sh infra/scripts/lib/docker-disk.sh`.
- [x] Validate dev/prod compose config rendering with `docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/fixtures/env.prod.ci config >/dev/null` and `docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/fixtures/env.dev.ci config >/dev/null`.
- [x] Run focused infra/script tests with `npx vitest run infra/scripts/__tests__`.
- [ ] Use the Linear waiver path for PR metadata: label `waiver:linear-ticket` and include `## Waiver` with `Reason:`, `Approved-by: @handle`, and `Scope: title|commits|both`.

## Open Items

- [ ] Fill in the PR waiver fields when preparing the PR.

## References

- Validation evidence: `docs/notes/deployment-disk-cleanup/validation-evidence-20260620.md`
- Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/codex/deployment-disk-cleanup`
- Branch: `codex/deployment-disk-cleanup`
- Main deploy script: `infra/scripts/deploy.sh`
- Backup script: `infra/scripts/backup-postgres.sh`
- Service redeploy script: `infra/scripts/redeploy-service.sh`
- Reusable deploy workflow: `.github/workflows/_deploy-reusable.yml`
- Operations runbook: `docs/002-operations/runbook.md`
- CI/CD docs: `docs/002-operations/ci-cd.md`
