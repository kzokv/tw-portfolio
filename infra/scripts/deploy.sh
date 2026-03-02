#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="${0##*/}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-postgres.sh"
PREVIOUS_BRANCH=""
PREVIOUS_SHA=""

ENVIRONMENT="production"
BRANCH_NAME="main"
BRANCH_REMOTE="origin"
DEPLOY_SHA=""
IMAGE_TAG_EXPLICIT=""
BRANCH_SPECIFIED=false
SELECT_BRANCH=false
FORCE=false

DEPLOY_TS="$(date +%Y%m%d_%H%M%S)"
DEPLOY_START_EPOCH=""
PHASE_START_EPOCH=""
IMAGE_TAG=""

COMPOSE_FILE=""
COMPOSE_PROJECT=""
ENV_FILE=""
STACK_PREFIX=""
POSTGRES_CONTAINER=""
REDIS_CONTAINER=""
MIGRATE_SERVICE=""
API_CONTAINER=""
WEB_CONTAINER=""
CLOUDFLARED_CONTAINER=""
CONTAINER_NAMES=""
STATE_BASE_DIR=""
BACKUP_DIR=""
DEPLOY_LOG_DIR=""
LEGACY_BACKUP_DIR="${LEGACY_BACKUP_DIR:-/data/backups/tw-portfolio}"
DEPLOY_LOG_FILE=""
CONTAINER_LOG_DIR=""

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
  Deploy tw-portfolio services with Docker Compose, including migration, health checks, and rollback.

Usage: ${SCRIPT_PATH} [OPTIONS] [DEPLOY_SHA]

Options:
  -h, --help                   Show this help message and exit (optional)
  -e, --environment ENV        Deploy environment: production or dev (optional, default: production)
  -b, --branch BRANCH          Deploy from this branch (optional, default: main)
  -s, --select-branch          Select deploy branch from numbered local/remote list (optional)
  -t, --image-tag TAG          Use this tag for all app images in the selected environment (optional, default: short deployed SHA)
  -f, --force                  Allow deploy with uncommitted changes (optional)
  DEPLOY_SHA                   CI-tested commit SHA to deploy from the target branch (optional)

Requirements:
  - Clean git working tree in the tw-portfolio repo (unless --force is used)
  - Docker and docker compose available on PATH
  - Configured env file for the selected environment

Exit codes:
  0  Successful deployment
  1  Validation or deployment failure (including rollback)
EOF
}

error_and_help() {
  echo "ERROR: $1" >&2
  echo >&2
  print_help >&2
  exit 1
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
      -b|--branch)
        if [ "${2-}" = "" ] || [[ "$2" == -* ]]; then
          error_and_help "--branch requires a value"
        fi
        BRANCH_NAME="$2"
        BRANCH_SPECIFIED=true
        shift 2
        ;;
      --branch=*)
        BRANCH_NAME="${1#*=}"
        if [ -z "$BRANCH_NAME" ]; then
          error_and_help "--branch requires a value"
        fi
        BRANCH_SPECIFIED=true
        shift 1
        ;;
      -s|--select-branch)
        SELECT_BRANCH=true
        shift 1
        ;;
      -t|--image-tag)
        if [ "${2-}" = "" ] || [[ "$2" == -* ]]; then
          error_and_help "--image-tag requires a value"
        fi
        IMAGE_TAG_EXPLICIT="$2"
        shift 2
        ;;
      --image-tag=*)
        IMAGE_TAG_EXPLICIT="${1#*=}"
        if [ -z "$IMAGE_TAG_EXPLICIT" ]; then
          error_and_help "--image-tag requires a value"
        fi
        shift 1
        ;;
      -f|--force)
        FORCE=true
        shift 1
        ;;
      -*)
        error_and_help "Unknown flag: $1"
        ;;
      *)
        if [ -z "$DEPLOY_SHA" ]; then
          DEPLOY_SHA="$1"
          shift 1
        else
          error_and_help "Unexpected argument: $1"
        fi
        ;;
    esac
  done
}

configure_environment() {
  case "$ENVIRONMENT" in
    production)
      COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.prod.yml"
      ENV_FILE="$REPO_ROOT/infra/docker/.env.prod"
      STACK_PREFIX="twp-prod"
      COMPOSE_PROJECT="twp-prod"
      POSTGRES_CONTAINER="twp-prod-postgres"
      REDIS_CONTAINER="twp-prod-redis"
      MIGRATE_SERVICE="twp-prod-migrate"
      API_CONTAINER="twp-prod-api"
      WEB_CONTAINER="twp-prod-web"
      CLOUDFLARED_CONTAINER="twp-prod-cloudflared"
      ;;
    dev)
      COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.dev.yml"
      ENV_FILE="$REPO_ROOT/infra/docker/.env.dev"
      STACK_PREFIX="twp-dev"
      COMPOSE_PROJECT="twp-dev"
      POSTGRES_CONTAINER="twp-dev-postgres"
      REDIS_CONTAINER="twp-dev-redis"
      MIGRATE_SERVICE="twp-dev-migrate"
      API_CONTAINER="twp-dev-api"
      WEB_CONTAINER="twp-dev-web"
      CLOUDFLARED_CONTAINER="twp-dev-cloudflared"
      ;;
    *)
      error_and_help "Unsupported environment: $ENVIRONMENT"
      ;;
  esac

  CONTAINER_NAMES="$API_CONTAINER $WEB_CONTAINER $POSTGRES_CONTAINER $REDIS_CONTAINER $CLOUDFLARED_CONTAINER"
}

select_deploy_branch() {
  if [ ! -t 0 ]; then
    error_and_help "--select-branch requires an interactive terminal"
  fi

  local line normalized remote_ref remote_name branch_name branch_number upstream_ref
  local -a options=()
  local -a branch_names=()
  local -a branch_remotes=()

  while IFS= read -r line; do
    normalized="$(echo "$line" | sed -E 's/^[*[:space:]]+//')"
    [ -z "$normalized" ] && continue
    [[ "$normalized" == *" -> "* ]] && continue

    if [[ "$normalized" == remotes/*/* ]]; then
      remote_ref="${normalized#remotes/}"
      remote_name="${remote_ref%%/*}"
      branch_name="${remote_ref#*/}"
      [ -z "$branch_name" ] && continue
      options+=("[remote] ${remote_name}/${branch_name}")
      branch_names+=("$branch_name")
      branch_remotes+=("$remote_name")
      continue
    fi

    options+=("[local]  ${normalized}")
    branch_names+=("$normalized")
    branch_remotes+=("")
  done < <(git branch -a)

  if [ "${#options[@]}" -eq 0 ]; then
    error_and_help "No branches found via git branch -a"
  fi

  echo "==> Select deploy branch (local + remote):"
  for i in "${!options[@]}"; do
    echo "  $((i + 1))) ${options[$i]}"
  done

  read -r -p "Enter branch number [1-${#options[@]}]: " branch_number
  if ! [[ "$branch_number" =~ ^[0-9]+$ ]] || [ "$branch_number" -lt 1 ] || [ "$branch_number" -gt "${#options[@]}" ]; then
    error_and_help "Invalid branch selection: $branch_number"
  fi

  BRANCH_NAME="${branch_names[$((branch_number - 1))]}"
  if [ -n "${branch_remotes[$((branch_number - 1))]}" ]; then
    BRANCH_REMOTE="${branch_remotes[$((branch_number - 1))]}"
    echo "  Selected remote branch: ${BRANCH_REMOTE}/${BRANCH_NAME}"
  else
    upstream_ref="$(git rev-parse --abbrev-ref "${BRANCH_NAME}@{upstream}" 2>/dev/null || true)"
    if [ -n "$upstream_ref" ] && [[ "$upstream_ref" == */* ]]; then
      BRANCH_REMOTE="${upstream_ref%%/*}"
    else
      BRANCH_REMOTE="origin"
    fi
    echo "  Selected local branch: $BRANCH_NAME (pull remote: $BRANCH_REMOTE)"
  fi
}

setup_state_dirs() {
  local default_home="${HOME:-$REPO_ROOT}"
  local configured_root="${TWP_STATE_DIR:-$default_home/.local/state/tw-portfolio/$ENVIRONMENT}"
  STATE_BASE_DIR="$configured_root"
  BACKUP_DIR="${BACKUP_DIR:-$STATE_BASE_DIR/backups}"
  DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-$STATE_BASE_DIR/logs/deploy}"
  export TWP_STATE_DIR="$STATE_BASE_DIR" BACKUP_DIR DEPLOY_LOG_DIR
}

setup_deploy_log() {
  if ! mkdir -p "$DEPLOY_LOG_DIR"; then
    echo "ERROR: Cannot create DEPLOY_LOG_DIR at '$DEPLOY_LOG_DIR'" >&2
    echo "Set DEPLOY_LOG_DIR or TWP_STATE_DIR to a writable path." >&2
    exit 1
  fi
  DEPLOY_LOG_FILE="$DEPLOY_LOG_DIR/deploy_${DEPLOY_TS}.log"
  CONTAINER_LOG_DIR="$DEPLOY_LOG_DIR/deploy_${DEPLOY_TS}_containers"
  exec > >(tee -a "$DEPLOY_LOG_FILE") 2>&1
  log "Deploy log: $DEPLOY_LOG_FILE"
  find "$DEPLOY_LOG_DIR" -maxdepth 1 -name "deploy_*.log" -mtime +30 -delete 2>/dev/null || true
  find "$DEPLOY_LOG_DIR" -maxdepth 1 -name "deploy_*_containers" -type d -mtime +30 -exec rm -rf {} + 2>/dev/null || true
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Required command not found on PATH: $cmd" >&2
    exit 1
  fi
}

validate_env_file_keys() {
  local required_keys=(
    POSTGRES_PASSWORD
    REDIS_PASSWORD
    CLOUDFLARE_TUNNEL_TOKEN
    PUBLIC_DOMAIN_WEB
    PUBLIC_DOMAIN_API
    AUTH_MODE
    PERSISTENCE_BACKEND
  )
  local key value

  for key in "${required_keys[@]}"; do
    value="${!key-}"
    if [ -z "$value" ]; then
      echo "ERROR: Required env var '$key' is missing in $ENV_FILE" >&2
      exit 1
    fi
  done

  if [ "${AUTH_MODE:-}" = "oauth" ] && [ -z "${AUTH_USER_ID:-}" ]; then
    echo "ERROR: AUTH_USER_ID is required in $ENV_FILE when AUTH_MODE=oauth" >&2
    exit 1
  fi
}

validate_preflight() {
  require_command docker
  require_command git

  if [ ! -f "$COMPOSE_FILE" ]; then
    echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
    exit 1
  fi

  if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: Env file not found: $ENV_FILE" >&2
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: docker compose is not available on PATH" >&2
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a

  validate_env_file_keys
  setup_state_dirs

  if ! docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config >/dev/null; then
    echo "ERROR: docker compose config validation failed for $COMPOSE_FILE" >&2
    exit 1
  fi
}

checkout_deploy_ref() {
  local branch="$1"
  local sha="$2"
  local remote="$3"

  log "Pulling latest for '$branch' (remote: $remote)..."
  git fetch "$remote" "$branch"

  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git checkout "$branch"
  elif git show-ref --verify --quiet "refs/remotes/$remote/$branch"; then
    log "Local branch '$branch' missing; creating from $remote/$branch"
    git checkout -b "$branch" "$remote/$branch"
  else
    log "ERROR: Branch '$branch' not found locally or on $remote."
    exit 1
  fi

  if [ -n "$sha" ]; then
    log "Validating $sha is reachable from $remote/$branch..."
    if ! git merge-base --is-ancestor "$sha" "$remote/$branch"; then
      log "ERROR: SHA $sha is not an ancestor of $remote/$branch"
      exit 1
    fi
    log "Advancing $branch to CI-tested SHA: $sha"
    git reset --hard "$sha"
  else
    git pull --ff-only "$remote" "$branch"
  fi
}

collect_container_logs() {
  mkdir -p "$CONTAINER_LOG_DIR"
  local c
  for c in $CONTAINER_NAMES; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${c}$"; then
      docker logs "$c" --tail 200 > "$CONTAINER_LOG_DIR/${c}.log" 2>&1 || true
    fi
  done
  log "Container logs: $CONTAINER_LOG_DIR/"
}

collect_compose_failure_diagnostics() {
  local reason="$1"
  local diag_dir="$DEPLOY_LOG_DIR/deploy_${DEPLOY_TS}_compose_failure"
  local svc

  mkdir -p "$diag_dir"
  log "Collecting compose diagnostics (${reason})..."

  dc ps > "$diag_dir/compose_ps.txt" 2>&1 || true
  dc ps -a > "$diag_dir/compose_ps_a.txt" 2>&1 || true

  for svc in $POSTGRES_CONTAINER $REDIS_CONTAINER $MIGRATE_SERVICE $API_CONTAINER $WEB_CONTAINER $CLOUDFLARED_CONTAINER; do
    if ! docker ps -a --format '{{.Names}}' | grep -q "^${svc}$"; then
      continue
    fi

    docker inspect "$svc" > "$diag_dir/${svc}.inspect.json" 2>&1 || true
    state="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}} {{.State.ExitCode}} {{.State.Error}}' "$svc" 2>/dev/null || true)"
    echo "$state" > "$diag_dir/${svc}.state.txt"

    if [[ "$state" != running* ]] || [[ "$state" == *"unhealthy"* ]] || [[ "$state" == exited* ]]; then
      docker logs "$svc" --tail 500 > "$diag_dir/${svc}.log" 2>&1 || true
    fi
  done

  log "Compose diagnostics: $diag_dir/"
}

restore_database_if_possible() {
  local latest_backup=""
  if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
    latest_backup="$(ls -t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | head -1 || true)"
    if [ -z "$latest_backup" ] && [ "$ENVIRONMENT" = "production" ]; then
      latest_backup="$(ls -t "${LEGACY_BACKUP_DIR}"/*.sql.gz 2>/dev/null | head -1 || true)"
    fi

    if [ -n "$latest_backup" ]; then
      log "Restoring database from $latest_backup..."
      gunzip -c "$latest_backup" | docker exec -i "$POSTGRES_CONTAINER" psql -U "${POSTGRES_USER:-twp}" -d "${POSTGRES_DB:-tw_portfolio}" 2>/dev/null || \
        log "WARNING: DB restore failed; manual restore may be needed"
    else
      log "WARNING: No backup found for DB restore; schema may be inconsistent"
    fi
  fi
}

rollback() {
  log_phase "ROLLBACK: restoring previous state (branch: ${PREVIOUS_BRANCH:-detached}, sha: ${PREVIOUS_SHA:-unknown})"
  set +e

  if [ -n "$PREVIOUS_BRANCH" ]; then
    git checkout "$PREVIOUS_BRANCH"
  fi
  git reset --hard "$PREVIOUS_SHA"

  dc --profile migrate build
  restore_database_if_possible
  dc up -d --remove-orphans

  set -e
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

cleanup_old_images() {
  docker images --format '{{.Repository}}:{{.Tag}}' | grep "^${STACK_PREFIX}-" | grep -v ":${IMAGE_TAG}$" | xargs -r docker rmi >/dev/null 2>&1 || true
}

parse_args "$@"
configure_environment

cd "$REPO_ROOT"

if [ "$SELECT_BRANCH" = true ] && [ "$BRANCH_SPECIFIED" = true ]; then
  error_and_help "Use either --branch or --select-branch, not both"
fi

if [ "$FORCE" != true ] && [ -n "$(git status --porcelain)" ]; then
  error_and_help "Working tree is not clean; commit, stash, or rerun with --force to proceed (uncommitted changes may be lost)"
fi

validate_preflight
setup_deploy_log
DEPLOY_START_EPOCH=$(date +%s)

if [ "$SELECT_BRANCH" = true ]; then
  select_deploy_branch
fi

log "Deploy started by $(whoami)@$(hostname)"
log "Environment: $ENVIRONMENT"
log "Branch: $BRANCH_NAME | Remote: $BRANCH_REMOTE | SHA arg: ${DEPLOY_SHA:-HEAD}"

PREVIOUS_BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
PREVIOUS_SHA="$(git rev-parse HEAD)"

phase_start "Checkout"
checkout_deploy_ref "$BRANCH_NAME" "$DEPLOY_SHA" "$BRANCH_REMOTE"
if [ -n "$IMAGE_TAG_EXPLICIT" ]; then
  IMAGE_TAG="$IMAGE_TAG_EXPLICIT"
  log "Using explicit image tag: $IMAGE_TAG"
else
  IMAGE_TAG="$(git rev-parse --short HEAD)"
  log "Deploy SHA: $(git rev-parse HEAD) (tag: $IMAGE_TAG)"
fi
export IMAGE_TAG ENV_FILE ENVIRONMENT
phase_done

phase_start "Build images (tag: $IMAGE_TAG)"
dc --profile migrate build
phase_done

phase_start "Pre-migration database backup"
if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  bash "$BACKUP_SCRIPT" --environment "$ENVIRONMENT"
else
  log "Postgres not running; skipping pre-migration backup"
fi
phase_done

phase_start "Database migrations"
if ! dc --profile migrate run --rm "$MIGRATE_SERVICE"; then
  log "ERROR: Migration failed; triggering rollback"
  collect_container_logs
  rollback
  exit 1
fi
phase_done

phase_start "Deploy services"
if ! dc up -d --remove-orphans; then
  log "ERROR: docker compose up failed; collecting diagnostics and rolling back"
  collect_compose_failure_diagnostics "compose up failed"
  collect_container_logs
  rollback
  exit 1
fi
phase_done

phase_start "Health checks"
API_HEALTHY=false
WEB_HEALTHY=false

if wait_for_healthcheck "$API_CONTAINER" "http://127.0.0.1:4000/health/live" 30 "wget -qO-"; then
  if docker exec "$API_CONTAINER" wget -qO- http://127.0.0.1:4000/health/live 2>/dev/null | grep -q '"ok"'; then
    API_HEALTHY=true
  fi
fi
if [ "$API_HEALTHY" = false ]; then
  log "ERROR: API failed health check after 30s"
  dc logs --tail 50 "$API_CONTAINER" || true
fi

if wait_for_healthcheck "$WEB_CONTAINER" "http://127.0.0.1:3000/" 20 "wget -qO-"; then
  WEB_HEALTHY=true
fi
if [ "$WEB_HEALTHY" = false ]; then
  log "ERROR: Web failed health check after 20s"
  dc logs --tail 50 "$WEB_CONTAINER" || true
fi
phase_done

collect_container_logs

if [ "$API_HEALTHY" = false ] || [ "$WEB_HEALTHY" = false ]; then
  rollback
  exit 1
fi

phase_start "Cleanup"
cleanup_old_images
phase_done

DEPLOY_ELAPSED=$(( $(date +%s) - DEPLOY_START_EPOCH ))
log_phase "Deploy complete"
log "Environment: $ENVIRONMENT"
log "Tag:         $IMAGE_TAG"
log "Branch:      $BRANCH_NAME"
log "SHA:         $(git rev-parse HEAD)"
log "Duration:    ${DEPLOY_ELAPSED}s"
log "Log:         $DEPLOY_LOG_FILE"
echo ""
dc ps
