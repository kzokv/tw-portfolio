# ADR: Docker Validation Strategy (KZO-103 + KZO-104)

**Date:** 2026-03-18
**Status:** Active (frozen reference snapshot)
**Related Tickets:** KZO-103 (env-setup), KZO-104 (Docker validation)

## Problem

CI only performs host-level builds (npm/tsc), so Dockerfile drift goes undetected until deploy time. The web Dockerfile was missing `@tw-portfolio/config` in its COPY/install steps, causing failures when deployed to QNAP. This was discovered too late — after merging to main.

## Solution: Three-Layer Validation

### Layer 1: Local Docker Validation Stack

**File:** `docker-compose.local.yml`
**Naming:** `twp-local-*` containers
**Command:** `npm run dev:docker:validate`

Runs full application stack locally:
- Builds all Docker images
- Runs database migrations
- Starts web, API, Postgres, Redis
- Performs health checks
- Can be torn down with `npm run dev:docker:validate:teardown`

**Benefits:**
- Detects Dockerfile dependency drift before push
- Tests migrations against real Postgres
- Validates full application startup
- Prevents "works locally" surprises

### Layer 2: CI Docker Build Validation Job

**Trigger:** Every PR/push to any branch
**Action:** GitHub Actions builds Docker images (no run)
**Cost:** ~2-3 minutes per job

Catches:
- Missing packages in COPY stages
- Typos in Dockerfile commands
- Base image incompatibilities
- Permission/user setup issues

Does NOT run the application (skips health checks, migrations).

### Layer 3: Host-Level Builds (Existing)

**Trigger:** Every PR/push
**Duration:** ~5 minutes (npm/tsc)
**Coverage:** TypeScript, ESLint, unit/integration tests

Fast catch for code issues, but misses Dockerfile problems.

## Implementation Details

### Local Validation Tooling

```bash
# Full validation (build, migrate, start, healthcheck)
npm run dev:docker:validate

# Cleanup
npm run dev:docker:validate:teardown

# Targeted service rebuild (with sourced env)
infra/scripts/redeploy-service.sh -e docker:local api
```

### CI Job Structure

GitHub Actions job:
```yaml
- Build web Dockerfile
- Build API Dockerfile
- (No docker-compose up — just build validation)
```

### AUTH_MODE Constraint in Local Stack

Local Docker defaults to `AUTH_MODE=oauth` (not dev_bypass) because:

| Setting | Reason |
|---|---|
| `NODE_ENV=production` | Matches production behavior (not development) |
| `AUTH_MODE=oauth` | Tests OAuth plumbing against real startup validation |
| `validatePortConflicts()` | Rejects dev_bypass in production mode |
| `GOOGLE_REDIRECT_URI` | Uses `localhost:4300` (host port, not container port) |
| `SESSION_COOKIE_NAME` | No `__Host-` prefix (HTTP, not HTTPS) |

This means the local stack exercises real OAuth session logic, not the dev_bypass shortcut.

## Key Lessons Learned

1. **Build-time dependencies must be explicitly listed** — Any package used by `npm run build` needs to be in the COPY stage that feeds `npm install`, not just in node_modules.

2. **Host builds don't validate Docker** — TypeScript and npm tests pass, but Dockerfile can be broken. Need separate validation.

3. **Validate env var combinations at runtime** — `AUTH_MODE=dev_bypass` + `NODE_ENV=production` passes schema validation but crashes server startup.

4. **Local validation stack pays for itself** — One pre-push run catches issues before CI, saving iterations.

## Migration Path

This strategy is stable. Maintain:
1. Local Docker validation stack as first-pass check
2. CI Docker build job as safety net before merge
3. Host-level builds for fast feedback on code changes
4. Clear documentation that local validation is best practice before push
