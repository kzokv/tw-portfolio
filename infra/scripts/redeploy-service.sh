#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="${0##*/}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

ENVIRONMENT=""
WITH_DEPS=false
SERVICE=""

COMPOSE_FILE=""
COMPOSE_PROJECT=""
ENV_FILE=""
STACK_PREFIX=""
FULL_SERVICE=""

PHASE_START_EPOCH=""

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

print_help() {
  cat <<EOF
Description:
  Rebuild and restart a single service in the specified environment.

Usage: ${SCRIPT_PATH} -e <environment> [OPTIONS] <service>

Services:
  api                    API server
  web                    Web frontend

Environments:
  local                  Local Docker stack (docker-compose.local.yml)
  dev                    Dev deployment (docker-compose.dev.yml)
  production             Production deployment (docker-compose.prod.yml)

Options:
  -h, --help             Show this help message and exit
  -e, --environment ENV  Target environment (required)
  --with-deps            Also restart dependent services (default: no-deps)

Examples:
  ${SCRIPT_PATH} -e local web
  ${SCRIPT_PATH} -e dev --with-deps api
  ${SCRIPT_PATH} -e production api

Exit codes:
  0  Service redeployed and healthy
  1  Build, restart, or health check failure
EOF
}

error_and_help() {
  echo "ERROR: $1" >&2
  echo >&2
  print_help >&2
  exit 1
}

configure_environment() {
  case "$ENVIRONMENT" in
    local)
      COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.local.yml"
      ENV_FILE="$REPO_ROOT/infra/docker/.env.local"
      STACK_PREFIX="twp-local"
      COMPOSE_PROJECT="twp-local"
      ;;
    dev)
      COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.dev.yml"
      ENV_FILE="$REPO_ROOT/infra/docker/.env.dev"
      STACK_PREFIX="twp-dev"
      COMPOSE_PROJECT="twp-dev"
      ;;
    production)
      COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.prod.yml"
      ENV_FILE="$REPO_ROOT/infra/docker/.env.prod"
      STACK_PREFIX="twp-prod"
      COMPOSE_PROJECT="twp-prod"
      ;;
    *)
      error_and_help "Unsupported environment: $ENVIRONMENT"
      ;;
  esac
}

resolve_service_name() {
  local short_name="$1"

  case "$short_name" in
    api)
      FULL_SERVICE="${STACK_PREFIX}-api"
      ;;
    web)
      FULL_SERVICE="${STACK_PREFIX}-web"
      ;;
    *)
      error_and_help "Unknown service: $short_name (valid: api, web)"
      ;;
  esac
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

collect_service_diagnostics() {
  local container="$1"

  log ""
  log "=== Diagnostics for $container ==="
  if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
    log "--- Last 50 log lines ---"
    docker logs "$container" --tail 50 2>&1 || true
    log "--- Health state ---"
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true
  else
    log "Container $container not found"
  fi

  log ""
  log "=== Recovery suggestions ==="
  log "  View full logs:   docker logs $container"
  log "  Restart service:  $SCRIPT_PATH -e $ENVIRONMENT $SERVICE"
  log "  Restart w/ deps:  $SCRIPT_PATH -e $ENVIRONMENT --with-deps $SERVICE"
  log "  Full stack down:  docker compose --project-name $COMPOSE_PROJECT -f $COMPOSE_FILE --env-file $ENV_FILE down"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h|--help)
        print_help
        exit 0
        ;;
      -e|--environment)
        if [ "${2-}" = "" ] || [[ "$2" == -* ]]; then
          error_and_help "--environment requires a value"
        fi
        ENVIRONMENT="$2"
        shift 2
        ;;
      --environment=*)
        ENVIRONMENT="${1#*=}"
        if [ -z "$ENVIRONMENT" ]; then
          error_and_help "--environment requires a value"
        fi
        shift 1
        ;;
      --with-deps)
        WITH_DEPS=true
        shift 1
        ;;
      -*)
        error_and_help "Unknown flag: $1"
        ;;
      *)
        if [ -z "$SERVICE" ]; then
          SERVICE="$1"
          shift 1
        else
          error_and_help "Unexpected argument: $1"
        fi
        ;;
    esac
  done

  if [ -z "$ENVIRONMENT" ]; then
    error_and_help "--environment is required"
  fi
  if [ -z "$SERVICE" ]; then
    error_and_help "Service name is required (api or web)"
  fi
}

parse_args "$@"
configure_environment
resolve_service_name "$SERVICE"

log "Redeploying $SERVICE ($FULL_SERVICE) in $ENVIRONMENT"
log "Compose file: $COMPOSE_FILE"
log "Env file:     $ENV_FILE"
log "With deps:    $WITH_DEPS"

# ── Preflight ─────────────────────────────────────────────────────────
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Env file not found: $ENV_FILE" >&2
  exit 1
fi

# ── Phase 1: Build target ────────────────────────────────────────────
phase_start "Phase 1: Build $FULL_SERVICE"

if ! dc build "$FULL_SERVICE"; then
  echo "ERROR: Build failed for $FULL_SERVICE" >&2
  exit 1
fi

phase_done

# ── Phase 2: Restart ─────────────────────────────────────────────────
phase_start "Phase 2: Restart $FULL_SERVICE"

if [ "$WITH_DEPS" = true ]; then
  log "Restarting with dependencies..."
  if ! dc up -d "$FULL_SERVICE"; then
    echo "ERROR: Restart with deps failed for $FULL_SERVICE" >&2
    collect_service_diagnostics "$FULL_SERVICE"
    exit 1
  fi
else
  log "Restarting without dependencies (--no-deps)..."
  if ! dc up -d --no-deps "$FULL_SERVICE"; then
    echo "ERROR: Restart failed for $FULL_SERVICE" >&2
    collect_service_diagnostics "$FULL_SERVICE"
    exit 1
  fi
fi

phase_done

# ── Phase 3: Health check ────────────────────────────────────────────
phase_start "Phase 3: Health check $FULL_SERVICE"

HEALTH_OK=false

case "$SERVICE" in
  api)
    if wait_for_healthcheck "$FULL_SERVICE" "http://127.0.0.1:4000/health/live" 30 "wget -qO-"; then
      HEALTH_OK=true
    fi
    ;;
  web)
    if wait_for_healthcheck "$FULL_SERVICE" "http://127.0.0.1:3000/" 20 "wget -qO-"; then
      HEALTH_OK=true
    fi
    ;;
esac

if [ "$HEALTH_OK" = false ]; then
  log "ERROR: $FULL_SERVICE failed health check"
  collect_service_diagnostics "$FULL_SERVICE"
  exit 1
fi

phase_done

log ""
log "Redeploy complete: $FULL_SERVICE is healthy"
