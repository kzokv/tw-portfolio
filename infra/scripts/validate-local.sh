#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="${0##*/}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.local.yml"
COMPOSE_PROJECT="twp-local"
ENV_FILE="$REPO_ROOT/infra/docker/.env.local"

TEARDOWN=false
PHASE_START_EPOCH=""
FAILED_PHASE=""

log() {
  echo "[$(date '+%H:%M:%S')] $*"
}

log_phase() {
  echo ""
  log "== $* =="
}

phase_start() {
  PHASE_START_EPOCH=$(date +%s)
  log_phase "$*"
}

phase_done() {
  local elapsed=$(( $(date +%s) - PHASE_START_EPOCH ))
  log "done (${elapsed}s)"
}

dc() {
  docker compose --project-name "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

wait_for_healthcheck() {
  local container="$1"
  local url="$2"
  local seconds="$3"
  local probe="$4"
  local i

  log "Waiting for ${container} health (up to ${seconds}s)..."
  for i in $(seq 1 "$seconds"); do
    if docker exec "$container" sh -lc "$probe '$url'" >/dev/null 2>&1; then
      log "  healthy after ${i}s"
      return 0
    fi
    sleep 1
  done
  return 1
}

collect_failure_logs() {
  local containers="twp-local-postgres twp-local-redis twp-local-api twp-local-web twp-local-migrate"
  local c

  log ""
  log "=== Container logs (last 50 lines) ==="
  for c in $containers; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${c}$"; then
      log "--- $c ---"
      docker logs "$c" --tail 50 2>&1 || true
    fi
  done
}

on_failure() {
  log ""
  log "FAILED at phase: ${FAILED_PHASE:-unknown}"
  collect_failure_logs
  if [ "$TEARDOWN" = true ]; then
    log "Tearing down stack..."
    dc down -v 2>/dev/null || true
  fi
  exit 1
}

print_help() {
  cat <<EOF
Description:
  Validate the local Docker stack by building images, starting services,
  running migrations, and performing health checks.

Usage: ${SCRIPT_PATH} [OPTIONS]

Options:
  -h, --help              Show this help message and exit
  --teardown              Tear down the stack after validation (default: leave running)
  --env-file PATH         Path to env file (default: infra/docker/.env.local)

Phases:
  1. Preflight          Validate compose file, env file, docker availability
  2. Build images       Build all service images including migrate
  3. Start infra        Start postgres and redis, wait for healthy
  4. Database migrate   Run database migrations
  5. Start apps         Start api and web services
  6. Health checks      Verify api and web respond to health probes
  7. Demo session       Validate demo sign-in flow (skipped if DEMO_MODE_ENABLED!=true)
  8. Summary            Report pass/fail and show service status

Exit codes:
  0  All phases passed
  1  Validation or health check failure
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h|--help)
        print_help
        exit 0
        ;;
      --teardown)
        TEARDOWN=true
        shift 1
        ;;
      --env-file)
        if [ "${2-}" = "" ] || [[ "$2" == -* ]]; then
          echo "ERROR: --env-file requires a value" >&2
          exit 1
        fi
        ENV_FILE="$2"
        shift 2
        ;;
      --env-file=*)
        ENV_FILE="${1#*=}"
        if [ -z "$ENV_FILE" ]; then
          echo "ERROR: --env-file requires a value" >&2
          exit 1
        fi
        shift 1
        ;;
      -*)
        echo "ERROR: Unknown flag: $1" >&2
        echo >&2
        print_help >&2
        exit 1
        ;;
      *)
        echo "ERROR: Unexpected argument: $1" >&2
        echo >&2
        print_help >&2
        exit 1
        ;;
    esac
  done
}

parse_args "$@"

# ── Phase 1: Preflight ───────────────────────────────────────────────
FAILED_PHASE="Preflight"
phase_start "Phase 1: Preflight"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not available on PATH" >&2
  on_failure
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose is not available" >&2
  on_failure
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
  on_failure
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Env file not found: $ENV_FILE" >&2
  echo "Generate it: npm run env:setup -- --target docker:local" >&2
  on_failure
fi

if ! dc config >/dev/null; then
  echo "ERROR: docker compose config validation failed" >&2
  on_failure
fi

log "Compose file: $COMPOSE_FILE"
log "Env file:     $ENV_FILE"
log "Teardown:     $TEARDOWN"
phase_done

# ── Phase 2: Build images ────────────────────────────────────────────
FAILED_PHASE="Build images"
phase_start "Phase 2: Build images"

if ! dc --profile migrate build; then
  echo "ERROR: Image build failed" >&2
  on_failure
fi

phase_done

# ── Phase 3: Start infrastructure ────────────────────────────────────
FAILED_PHASE="Start infrastructure"
phase_start "Phase 3: Start infrastructure"

if ! dc up -d twp-local-postgres twp-local-redis; then
  echo "ERROR: Failed to start infrastructure services" >&2
  on_failure
fi

# Wait for Docker's own healthcheck to report healthy
for i in $(seq 1 60); do
  pg_status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' twp-local-postgres 2>/dev/null || true)"
  redis_status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' twp-local-redis 2>/dev/null || true)"
  if [ "$pg_status" = "healthy" ] && [ "$redis_status" = "healthy" ]; then
    log "Postgres and Redis are healthy"
    break
  fi
  if [ "$i" -eq 60 ]; then
    log "ERROR: Infrastructure services did not become healthy within 60s"
    log "  postgres=$pg_status redis=$redis_status"
    on_failure
  fi
  sleep 1
done

phase_done

# ── Phase 4: Database migrations ─────────────────────────────────────
FAILED_PHASE="Database migrations"
phase_start "Phase 4: Database migrations"

if ! dc --profile migrate run --rm twp-local-migrate; then
  echo "ERROR: Database migration failed" >&2
  on_failure
fi

phase_done

# ── Phase 5: Start applications ──────────────────────────────────────
FAILED_PHASE="Start applications"
phase_start "Phase 5: Start applications"

if ! dc up -d twp-local-api twp-local-web; then
  echo "ERROR: Failed to start application services" >&2
  on_failure
fi

phase_done

# ── Phase 6: Health checks ───────────────────────────────────────────
FAILED_PHASE="Health checks"
phase_start "Phase 6: Health checks"

API_HEALTHY=false
WEB_HEALTHY=false

if wait_for_healthcheck "twp-local-api" "http://127.0.0.1:4000/health/live" 30 "wget -qO-"; then
  API_HEALTHY=true
fi
if [ "$API_HEALTHY" = false ]; then
  log "ERROR: API failed health check after 30s"
  dc logs --tail 50 twp-local-api || true
fi

if wait_for_healthcheck "twp-local-web" "http://127.0.0.1:3000/" 20 "wget -qO-"; then
  WEB_HEALTHY=true
fi
if [ "$WEB_HEALTHY" = false ]; then
  log "ERROR: Web failed health check after 20s"
  dc logs --tail 50 twp-local-web || true
fi

if [ "$API_HEALTHY" = false ] || [ "$WEB_HEALTHY" = false ]; then
  on_failure
fi

phase_done

# ── Phase 7: Demo session validation ────────────────────────────────
FAILED_PHASE="Demo session"
phase_start "Phase 7: Demo session validation"

# Check if demo mode is enabled in the API container's environment.
# The env var comes from .env.local via env_file in compose.
DEMO_ENABLED="$(docker exec twp-local-api sh -c 'echo ${DEMO_MODE_ENABLED:-false}' 2>/dev/null || true)"

if [ "$DEMO_ENABLED" != "true" ]; then
  log "DEMO_MODE_ENABLED is not 'true' (got: ${DEMO_ENABLED:-<unset>}). Skipping demo validation."
  log "To enable: set DEMO_MODE_ENABLED=true in .env.local"
else
  # 1. Start demo session via the API
  DEMO_RESPONSE="$(docker exec twp-local-api \
    wget -qO- --post-data='' http://127.0.0.1:4000/auth/demo/start 2>/dev/null || true)"

  if [ -z "$DEMO_RESPONSE" ]; then
    log "ERROR: POST /auth/demo/start returned empty response"
    dc logs --tail 20 twp-local-api || true
    on_failure
  fi

  # 2. Verify response contains expected fields
  DEMO_USER_ID=""
  DEMO_SESSION_TYPE=""
  if command -v jq >/dev/null 2>&1; then
    DEMO_USER_ID="$(echo "$DEMO_RESPONSE" | jq -r '.userId // empty')"
    DEMO_SESSION_TYPE="$(echo "$DEMO_RESPONSE" | jq -r '.sessionType // empty')"
  else
    # Fallback: grep for key fields in JSON
    DEMO_USER_ID="$(echo "$DEMO_RESPONSE" | grep -oE '"userId":"[^"]+"' | head -1 | cut -d'"' -f4)"
    DEMO_SESSION_TYPE="$(echo "$DEMO_RESPONSE" | grep -oE '"sessionType":"[^"]+"' | head -1 | cut -d'"' -f4)"
  fi

  if [ -z "$DEMO_USER_ID" ]; then
    log "ERROR: Demo session response missing userId"
    log "Response: $DEMO_RESPONSE"
    on_failure
  fi

  if [ "$DEMO_SESSION_TYPE" != "demo" ]; then
    log "ERROR: Demo session type is '${DEMO_SESSION_TYPE}', expected 'demo'"
    log "Response: $DEMO_RESPONSE"
    on_failure
  fi

  log "Demo session created: userId=$DEMO_USER_ID sessionType=$DEMO_SESSION_TYPE"

  # 3. Verify the session cookie grants access to a protected endpoint
  DEMO_COOKIE="$(docker exec twp-local-api \
    wget -qS --post-data='' http://127.0.0.1:4000/auth/demo/start 2>&1 \
    | grep -i 'set-cookie' | head -1 | sed 's/.*set-cookie: *//i' | cut -d';' -f1 || true)"

  if [ -n "$DEMO_COOKIE" ]; then
    SETTINGS_STATUS="$(docker exec twp-local-api \
      wget -qO- --header "Cookie: ${DEMO_COOKIE}" \
      http://127.0.0.1:4000/settings 2>/dev/null \
      | grep -c '"userId"' || true)"

    if [ "$SETTINGS_STATUS" -ge 1 ]; then
      log "Demo session cookie grants access to /settings"
    else
      log "WARNING: Demo session cookie did not authenticate /settings (non-blocking)"
    fi
  else
    log "WARNING: Could not extract demo session cookie (non-blocking)"
  fi
fi

phase_done

# ── Phase 8: Summary ─────────────────────────────────────────────────
FAILED_PHASE=""
phase_start "Phase 8: Summary"

log "All health checks passed"
echo ""
dc ps

phase_done

# ── Teardown (optional) ──────────────────────────────────────────────
if [ "$TEARDOWN" = true ]; then
  phase_start "Teardown"
  dc down -v
  phase_done
fi

log ""
log "Local stack validation: PASSED"
