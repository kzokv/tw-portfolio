# CI/CD

GitHub Actions pipelines, deploy workflows, and validation scripts.

---

## Pipeline Overview

```mermaid
flowchart LR
  subgraph CI["CI Pipeline (every push/PR)"]
    LINT[lint]
    BUILD[build-and-typecheck]
    UNIT[unit-tests]
    INT[integration-tests]
    DEPLOY_VAL[deploy-config-validation]
    DOCKER_VAL[docker-build-validation]
  end

  subgraph DEPLOY["Deploy Workflows"]
    DEV_DEPLOY[deploy-dev.yml]
    PROD_DEPLOY[deploy.yml]
  end

  CI -->|CI passes on dev| DEV_DEPLOY
  CI -->|CI passes on main| PROD_DEPLOY
```

---

## CI Pipeline

| Job | What it does | Depends on |
|-----|-------------|------------|
| `lint` | `npx eslint .` — full project lint | — |
| `build-and-typecheck` | Builds workspace libs, API, web; runs typecheck | — |
| `unit-tests` | `npm run test:unit --prefix apps/web` (vitest) | `build-and-typecheck` |
| `integration-tests` | `npm run test:integration:full:host --prefix apps/api` with isolated Postgres/Redis | `build-and-typecheck` |
| `deploy-config-validation` | Validates all compose files render with fixture env | `build-and-typecheck` |
| `docker-build-validation` | Builds all Docker images including migrate (`--profile migrate`) | `deploy-config-validation` |

### PR gate checks

| Check | Required? | Description |
|-------|-----------|-------------|
| `lint` | Yes | No ESLint errors |
| `build-and-typecheck` | Yes | All packages build and typecheck cleanly |
| `unit-tests` | Yes | All vitest unit tests pass |
| `integration-tests` | Yes | API integration tests pass with real Postgres/Redis |
| `deploy-config-validation` | Yes | Compose files render without errors |
| `docker-build-validation` | Yes | All Docker images build successfully |

---

## Deploy Workflows

### Branch-to-environment mapping

| Branch | Workflow | GitHub Environment | Trigger |
|--------|---------|-------------------|---------|
| `dev` | `deploy-dev.yml` | `dev` | Manual (`workflow_dispatch`) |
| `main` | `deploy.yml` | `production` | Automatic after CI passes (`workflow_run`) |

### Promotion flow

```mermaid
flowchart LR
  A[Feature branch] -->|PR + merge| B[dev branch]
  B -->|CI passes| C{Manual trigger}
  C -->|deploy-dev.yml| D[Dev environment]
  D -->|Validate| E[Merge dev → main]
  E -->|CI passes| F[Auto deploy]
  F --> G[Production environment]
```

### Reusable deploy workflow

Both workflows use the same hardened pattern:

1. Wait for CI to succeed on the matching branch
2. Install Cloudflare WARP client on the GitHub-hosted runner
3. Enroll runner into Zero Trust using a service token
4. Install SSH deploy key and pinned `known_hosts`
5. Verify remote deploy script, compose file, and env file exist
6. Capture remote Docker disk diagnostics before deploy
7. Run `deploy.sh` with the exact CI-tested commit SHA
8. Capture remote Docker disk diagnostics after deploy when the deploy succeeds
9. On failure, collect runner-side WARP status plus remote Docker disk diagnostics when SSH is still available

---

## Deploy Script

### Phases

```mermaid
flowchart TD
  A[deploy.sh] --> B["[1] Preflight"]
  B --> C["[2] Checkout"]
  C --> D["[3] Backup"]
  D --> E["[4] Build"]
  E --> F["[5] Migrate"]
  F -->|Fail| R[ROLLBACK]
  F --> G["[6] Deploy"]
  G -->|Fail| R
  G --> H["[7] Health Check"]
  H -->|Fail| R
  H --> I["[8] Cleanup"]
  I --> J[SUCCESS exit 0]
  R --> K[exit 1]
```

| Phase | Action |
|-------|--------|
| Preflight | Validate git, docker, env file, compose config |
| Checkout | `git fetch` + checkout + reset to target SHA |
| Backup | Wait for backup-safe Postgres (`pg_isready` + `SELECT NOT pg_is_in_recovery()`), then run atomic `pg_dump \| gzip` backup before any image builds |
| Build | Enforce Docker disk preflight (`DEPLOY_MIN_DOCKER_FREE_GB=25`, `DEPLOY_MIN_DOCKER_FREE_PERCENT=15` by default), then `docker compose --profile migrate build` |
| Migrate | `docker compose run --rm migrate` + post-migration verification |
| Deploy | `docker compose up -d --remove-orphans` |
| Health Check | API `/health/live` (30s) + Web `/` (20s) |
| Cleanup | Success-only tagged app-image cleanup, plus bounded exit cleanup (`docker container prune`, `docker image prune`, `docker builder prune --keep-storage`) on every exit |

**Rollback**: Restores previous branch/SHA, rebuilds images, restores DB from backup, `docker compose up -d`.

### Backup and disk guardrails

- `DEPLOY_POSTGRES_BACKUP_READY_TIMEOUT_SECONDS` defaults to `120` seconds for the backup-safe readiness gate.
- `infra/scripts/backup-postgres.sh` writes dumps atomically via a temporary file and renames only after `pg_dump | gzip` succeeds.
- Backup retention defaults are environment-aware: production keeps `30` days / `60` files; dev keeps `7` days / `20` files.
- Retention overrides use `BACKUP_RETAIN_DAYS` and `BACKUP_RETAIN_MAX_FILES`; legacy `RETAIN_DAYS` remains a supported alias for the day-based retention value.
- `deploy.sh` and `redeploy-service.sh` both run the shared Docker disk helper before builds and perform bounded exit cleanup, but the GitHub workflow itself does not run any remote cleanup commands.

### Options

| Option | Description |
|--------|-------------|
| `-e`, `--environment ENV` | `production` or `dev` (default: `production`) |
| `-b`, `--branch BRANCH` | Deploy from this branch (default: `main`) |
| `-s`, `--select-branch` | Interactively choose branch (requires TTY) |
| `-t`, `--image-tag TAG` | Image tag for app images (default: short SHA) |
| `-f`, `--force` | Allow deploy with uncommitted changes |
| `DEPLOY_SHA` | Commit SHA to deploy (must be reachable from branch) |

### Logging

Each deploy writes a timestamped log and per-container log snapshots to `~/.local/state/vakwen/<environment>/logs/deploy/`. Logs older than 30 days are pruned automatically. Remote workflow runs also emit Docker disk diagnostics before deploy, after successful deploys, and again in failure handling when the runner can still reach the host.

---

## Validation Script

`infra/scripts/validate-local.sh` validates the local Docker stack end-to-end:

1. Preflight — check docker, compose file, env file
2. Build — `docker compose --profile migrate build`
3. Start infra — postgres + redis, wait for healthy (60s)
4. Migrate — run migrate container
5. Start apps — api + web containers
6. Health check — API `/health/live` (30s), Web `/` (20s)
7. Summary — `docker compose ps`

Pass `--teardown` to tear down after validation. Accessible via `npm run dev:docker:validate` (or `:teardown`).

---

## Service Redeploy

`infra/scripts/redeploy-service.sh` rebuilds and restarts a single service. It uses the same Docker disk preflight and bounded exit cleanup helper as the full deploy path:

```bash
bash infra/scripts/redeploy-service.sh -e local web
bash infra/scripts/redeploy-service.sh -e dev api
bash infra/scripts/redeploy-service.sh -e production --with-deps web
```

Options: `-e ENV` (required), `--with-deps` (restart dependents), service name (`api` or `web`).

---

## GitHub Environment Secrets

| Name | Type | Purpose |
|------|------|---------|
| `CF_ACCESS_CLIENT_ID` | Secret | Cloudflare WARP service token Client ID |
| `CF_ACCESS_CLIENT_SECRET` | Secret | Cloudflare WARP service token Client Secret |
| `CF_TEAM_NAME` | Secret | Cloudflare Zero Trust team name |
| `DEPLOY_SSH_KEY` | Secret | Private SSH deploy key (OpenSSH format) |
| `DEPLOY_KNOWN_HOSTS` | Secret | Verified `known_hosts` entry for deploy host |
| `DEPLOY_HOST` | Secret/Variable | Private IP or hostname for SSH over WARP |
| `DEPLOY_USER` | Secret/Variable | SSH user for remote deploy |
| `DEPLOY_PATH` | Secret/Variable | Absolute repo path on deploy host (no `~`) |

Both `dev` and `production` environments use the same secret names with environment-specific values.

---

## Related Docs

- [Runbook](./runbook.md) — deploy flow details, rollback procedures, troubleshooting
- [System Architecture](../001-architecture/architecture.md) — deployment topology, container layout
- [Environment Variables](./environment-variables.md) — all env vars used by CI and deploy
