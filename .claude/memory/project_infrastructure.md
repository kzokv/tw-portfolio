---
name: project_infrastructure
description: Deployment target (QNAP via Cloudflare WARP+SSH), 3 Docker compose environments, CI Docker validation, AUTH_MODE constraint
type: project
---

## Deployment Target

Deploys to QNAP NAS at 192.168.2.10. GitHub Actions reaches it via Cloudflare WARP + SSH.

## Docker Compose Environments

| Environment | File | Container prefix | Host ports |
|-------------|------|-----------------|------------|
| local | `docker-compose.local.yml` | `twp-local-*` | web 3300, api 4300, postgres 5732, redis 6679 |
| dev | `docker-compose.dev.yml` | `twp-dev-*` | postgres 5454, redis 6363 (web/api via cloudflared) |
| production | `docker-compose.prod.yml` | `twp-prod-*` | (via cloudflared) |

## CI/CD Flow

1. GitHub Actions builds and tests on hosted runner (host-level, no Docker)
2. Docker build validation job builds images to catch Dockerfile drift
3. On merge to `main`, CI SSHes into QNAP via Cloudflare WARP and runs `docker compose up --build -d`

## Local Docker Validation

Use `docker-compose.local.yml` via `npm run dev:docker:validate`. Catches Dockerfile dependency drift that host builds miss (e.g., missing packages in COPY stages).

## AUTH_MODE Constraint

Local Docker runs `NODE_ENV=production` to match prod behavior. `validatePortConflicts()` enforces `dev_bypass` only when `NODE_ENV=development`. Local Docker defaults to `AUTH_MODE=oauth`, `SESSION_COOKIE_NAME=g_auth_session` (no `__Host-` prefix, HTTP), `GOOGLE_REDIRECT_URI` must use host port 4300.

**How to apply:** When touching Docker configs, CI pipeline, or env setup. Verify env var combinations against runtime startup validation, not just the schema.
