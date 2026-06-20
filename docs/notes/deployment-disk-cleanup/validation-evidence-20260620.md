# Deployment Disk Cleanup Validation Evidence

Date: 2026-06-20
Branch: `codex/deployment-disk-cleanup`
Worktree: `/Users/lume/repos/tw-portfolio/.worktrees/codex/deployment-disk-cleanup`

## Scope Evidence

- `infra/scripts/deploy.sh` now runs pre-migration backup before Docker image builds.
- `infra/scripts/deploy.sh` waits for backup-safe Postgres using `pg_isready` plus `SELECT NOT pg_is_in_recovery()`.
- `infra/scripts/backup-postgres.sh` writes backups through a temporary file and renames only after `pg_dump | gzip` succeeds.
- `infra/scripts/backup-postgres.sh` applies environment-aware retention defaults:
  - production: `30` days / `60` files
  - dev: `7` days / `20` files
- `infra/scripts/lib/docker-disk.sh` centralizes Docker root diagnostics, threshold checks, cleanup, and build preflight.
- `deploy.sh` and `redeploy-service.sh` run Docker disk preflight before build paths and bounded cleanup on exit.
- `.github/workflows/_deploy-reusable.yml` records remote Docker disk diagnostics before deploy, after successful deploy, and in failure diagnostics.
- QNAP follow-up: Docker root diagnostics now fall back to the nearest inspectable parent filesystem when Container Station reports a private Docker root, and detailed `docker system df` is opt-in via `DEPLOY_DOCKER_SYSTEM_DF=1`.

## Review Follow-Up

The team reviewer found that the first implementation failed low-disk preflight without attempting bounded cleanup first.

Resolution:

- `docker_disk_preflight_build` now prints diagnostics, checks thresholds, runs bounded cleanup when thresholds fail, prints post-cleanup diagnostics, then checks thresholds again.
- `infra/scripts/__tests__/docker-disk-helper.test.ts` includes a regression test confirming low-disk preflight invokes container, image, and builder cache cleanup before returning failure.

Dev deployment follow-up:

- GitHub run `27857914437` failed before deployment in `Remote Docker disk diagnostics before deploy`.
- The failed step showed Docker root `/share/CACHEDEV1_DATA/Container/container-station-data/lib/docker`, but `df -h` could not inspect that path for the deploy user.
- Failure diagnostics showed `docker system df` took about five and a half minutes on QNAP, so workflow diagnostics now avoid that slow call by default.
- Local SSH against alias `qnap` confirmed the Docker root is on `/share/CACHEDEV1_DATA`, with about `130.3G` available at the time of inspection.
- Resolution: `infra/scripts/lib/docker-disk.sh` resolves QNAP Container Station's Docker binary when Docker is absent from PATH, falls back to an accessible parent filesystem for disk metrics, and leaves detailed Docker usage behind `DEPLOY_DOCKER_SYSTEM_DF=1`.

## Focused Validation

Evidence:

- Command/check: `bash -n infra/scripts/deploy.sh infra/scripts/backup-postgres.sh infra/scripts/redeploy-service.sh infra/scripts/lib/docker-disk.sh`
- Outcome: passed with exit code `0`.

- Command/check: `docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/fixtures/env.prod.ci config >/dev/null`
- Outcome: passed with exit code `0`.

- Command/check: `docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/fixtures/env.dev.ci config >/dev/null`
- Outcome: passed with exit code `0`.

- Command/check: `npx vitest run infra/scripts/__tests__`
- Outcome: passed. Initial run reported `3` test files passed and `11` tests passed.

- Command/check: `bash -n infra/scripts/deploy.sh infra/scripts/backup-postgres.sh infra/scripts/redeploy-service.sh infra/scripts/lib/docker-disk.sh`
- Outcome: passed with exit code `0` after the QNAP follow-up.

- Command/check: `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/_deploy-reusable.yml'); YAML.load_file('.github/workflows/deploy-dev.yml')"`
- Outcome: passed with exit code `0`.

- Command/check: `docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/fixtures/env.prod.ci config >/dev/null`
- Outcome: passed with exit code `0` after the QNAP follow-up.

- Command/check: `docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/fixtures/env.dev.ci config >/dev/null`
- Outcome: passed with exit code `0` after the QNAP follow-up.

- Command/check: `npx vitest run infra/scripts/__tests__`
- Outcome: passed after the QNAP follow-up. Vitest reported `3` test files passed and `13` tests passed.

- Command/check: `git diff --check`
- Outcome: passed with exit code `0`.

## Remaining Verification

- Pull request uses the repository Linear-ticket waiver path: PR #227 has label `waiver:linear-ticket` and a `## Waiver` body with `Reason:`, `Approved-by: @kzokv`, and `Scope: both`.
- CI passed on PR #227 before the QNAP follow-up commit: run `27857704918` plus PR Gate checks were green.
- CI must rerun on the QNAP follow-up commit and be monitored until green.
- Dev deployment must be tested via the GitHub `Deploy Dev via Cloudflare WARP` workflow against the dev environment.
