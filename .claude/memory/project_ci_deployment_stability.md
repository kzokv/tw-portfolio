---
name: project_ci_deployment_stability
description: CI deployment stability issue — Dockerfile drift goes undetected; local Docker validation stack and CI Docker build job added to prevent deploy-time failures
type: project
---

## Problem

CI only does host-level builds (npm/tsc), so Dockerfile drift goes undetected until deploy time. The web Dockerfile was missing `@tw-portfolio/config` in its COPY/install steps, causing build failures when deployed to the QNAP server.

## Solution

Three additions close the gap:

1. **`docker-compose.local.yml`** — Local Docker validation stack (twp-local-* naming). Ports: web 3300, api 4300, postgres 5732, redis 6679. No cloudflared. Validate with `npm run dev:docker:validate` or `npm run dev:docker:validate:teardown`.

2. **CI Docker build validation job** — GitHub Actions job that builds Docker images (without running them) on every PR/push. Catches Dockerfile dependency drift before deploy.

3. **`docker:local` env-setup target** — `npm run env:setup -- --target docker:local` generates `infra/docker/.env.local`. Replaces the deleted `.env.local.example`.

Additional tooling:
- `infra/scripts/validate-local.sh` — full stack validation (build, migrate, up, healthcheck)
- `infra/scripts/redeploy-service.sh` — targeted service rebuild (`-e <env> <service>`)

## Local Docker stack: AUTH_MODE constraint

The local stack defaults to `AUTH_MODE=oauth` (not `dev_bypass`) because:
- `validatePortConflicts()` in `apps/api/src/server.ts` enforces dev_bypass is only allowed when `NODE_ENV=development`
- Local Docker runs `NODE_ENV=production` to match production behavior
- `GOOGLE_REDIRECT_URI` must use host port 4300 (not container port 4000) since Google redirects the browser
- `SESSION_COOKIE_NAME` uses `g_auth_session` (no `__Host-` prefix) because local Docker runs on HTTP

## Key lessons

1. If a package is used at build time in the Dockerfile, it must be explicitly included in the COPY stage that feeds `npm install`. Host builds don't validate this.
2. Verify env var combinations against runtime startup validation, not just the schema. `AUTH_MODE=dev_bypass` + `NODE_ENV=production` passes schema validation but crashes the API.
