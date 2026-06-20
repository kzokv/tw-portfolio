#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="${0##*/}"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup-postgres.sh"
DOCKER_DISK_LIB="$SCRIPT_DIR/lib/docker-disk.sh"
PREVIOUS_BRANCH=""
PREVIOUS_SHA=""
ROLLBACK_IMAGE_TAG=""

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
BUILD_FLAGS=""
ENABLE_EXIT_DOCKER_CLEANUP=false
DEPLOY_POSTGRES_BACKUP_READY_TIMEOUT_SECONDS="${DEPLOY_POSTGRES_BACKUP_READY_TIMEOUT_SECONDS:-120}"

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
LEGACY_BACKUP_DIR="${LEGACY_BACKUP_DIR:-/data/backups/vakwen}"
DEPLOY_LOG_FILE=""
CONTAINER_LOG_DIR=""

log() {
  echo "[$(date '+%H:%M:%S')] $*"
}

log_phase() {
  echo ""
  log "== $* =="
}

if [ ! -f "$DOCKER_DISK_LIB" ]; then
  echo "ERROR: Required Docker disk helper not found: $DOCKER_DISK_LIB" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$DOCKER_DISK_LIB"

phase_start() {
  PHASE_START_EPOCH=$(date +%s)
  log_phase "$*"
}

phase_done() {
  local elapsed=$(( $(date +%s) - PHASE_START_EPOCH ))
  log "done (${elapsed}s)"
}

cleanup_unused_images() {
  set +e
  local used_image_ids=""
  local candidate_refs=""
  local candidate_id=""
  local candidate_label=""
  local removed_any=false

  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi

  if ! docker info >/dev/null 2>&1; then
    log "WARNING: Skipping unused image cleanup because Docker is unavailable"
    return 0
  fi

  if [ -z "$(docker images -q 2>/dev/null)" ]; then
    log "No Docker images available for cleanup"
    return 0
  fi

  used_image_ids="$(docker ps -aq | xargs -r docker inspect --format '{{.Image}}' 2>/dev/null | sort -u)"
  candidate_refs="$(
    {
      docker images --no-trunc --format '{{.Repository}}:{{.Tag}} {{.ID}}' 2>/dev/null \
        | awk '
            $1 ~ /^vakwen-[^:]+:/ { print $0; next }
            $1 ~ /^(alpine|alpine\/[^:]+):/ { print $0; next }
            $1 ~ /:.*alpine/ { print $0 }
          '
      docker images --no-trunc --filter dangling=true --format '<dangling> {{.ID}}' 2>/dev/null
    } | awk '!seen[$2]++'
  )"

  if [ -z "$candidate_refs" ]; then
    log "No unused vakwen/alpine-related Docker images found for cleanup"
    return 0
  fi

  log "Removing unused vakwen/alpine-related Docker images..."
  while IFS= read -r image_ref; do
    [ -z "$image_ref" ] && continue
    candidate_label="${image_ref% *}"
    candidate_id="${image_ref##* }"

    if printf '%s\n' "$used_image_ids" | grep -Fxq "$candidate_id"; then
      continue
    fi

    if docker image rm "$candidate_id" >/dev/null 2>&1; then
      log "Removed unused image: ${candidate_label} (${candidate_id})"
      removed_any=true
    else
      log "WARNING: Failed to remove unused image: ${candidate_label} (${candidate_id})"
    fi
  done <<EOF
$candidate_refs
EOF

  if [ "$removed_any" = false ]; then
    log "No removable vakwen/alpine-related Docker images found"
  else
    log "Unused vakwen/alpine-related Docker image cleanup complete"
  fi
}

finalize_deploy() {
  local exit_code=$?
  trap - EXIT

  if [ "$ENABLE_EXIT_DOCKER_CLEANUP" = true ]; then
    docker_disk_bounded_cleanup "Deploy exit cleanup" || true
  fi

  # Only clean up unused images on successful deploy — on failure the
  # freshly built images aren't referenced by running containers yet
  # and would be incorrectly removed.
  if [ "$ENABLE_EXIT_DOCKER_CLEANUP" = true ] && [ "$exit_code" -eq 0 ]; then
    cleanup_unused_images
  fi

  exit "$exit_code"
}

trap finalize_deploy EXIT

dc() {
  docker compose --project-name "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

run_with_heartbeat() {
  local label="$1"
  shift

  local interval="${DEPLOY_HEARTBEAT_INTERVAL_SECONDS:-30}"
  local command_pid heartbeat_pid status

  "$@" &
  command_pid=$!

  (
    while true; do
      sleep "$interval"
      log "still running: $label"
    done
  ) &
  heartbeat_pid=$!

  if wait "$command_pid"; then
    status=0
  else
    status=$?
  fi

  kill "$heartbeat_pid" >/dev/null 2>&1 || true
  wait "$heartbeat_pid" 2>/dev/null || true

  return "$status"
}

print_help() {
  cat <<EOF
Description:
  Deploy vakwen services with Docker Compose, including migration, health checks, and rollback.

Usage: ${SCRIPT_PATH} [OPTIONS] [DEPLOY_SHA]

Options:
  -h, --help                   Show this help message and exit (optional)
  -e, --environment ENV        Deploy environment: production or dev (optional, default: production)
  -b, --branch BRANCH          Deploy from this branch; local branch is reset to remote tip when DEPLOY_SHA is omitted (optional, default: main)
  -s, --select-branch          Select deploy branch from numbered local/remote list (optional)
  -t, --image-tag TAG          Use this tag for all app images in the selected environment (optional, default: short deployed SHA)
  -f, --force                  Allow deploy with uncommitted changes (optional)
  DEPLOY_SHA                   CI-tested commit SHA to deploy from the target branch (optional)

Requirements:
  - Clean git working tree in the vakwen repo (unless --force is used)
  - Docker and docker compose available on PATH
  - Configured env file for the selected environment
  - Branch-based deploys follow the selected remote branch tip when DEPLOY_SHA is omitted

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
      STACK_PREFIX="vakwen-prod"
      COMPOSE_PROJECT="vakwen-prod"
      POSTGRES_CONTAINER="vakwen-prod-postgres"
      REDIS_CONTAINER="vakwen-prod-redis"
      MIGRATE_SERVICE="vakwen-prod-migrate"
      API_CONTAINER="vakwen-prod-api"
      WEB_CONTAINER="vakwen-prod-web"
      CLOUDFLARED_CONTAINER="vakwen-prod-cloudflared"
      ;;
    dev)
      COMPOSE_FILE="$REPO_ROOT/infra/docker/docker-compose.dev.yml"
      ENV_FILE="$REPO_ROOT/infra/docker/.env.dev"
      STACK_PREFIX="vakwen-dev"
      COMPOSE_PROJECT="vakwen-dev"
      POSTGRES_CONTAINER="vakwen-dev-postgres"
      REDIS_CONTAINER="vakwen-dev-redis"
      MIGRATE_SERVICE="vakwen-dev-migrate"
      API_CONTAINER="vakwen-dev-api"
      WEB_CONTAINER="vakwen-dev-web"
      CLOUDFLARED_CONTAINER="vakwen-dev-cloudflared"
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
  local configured_root="${VAKWEN_STATE_DIR:-$default_home/.local/state/vakwen/$ENVIRONMENT}"
  STATE_BASE_DIR="$configured_root"
  BACKUP_DIR="${BACKUP_DIR:-$STATE_BASE_DIR/backups}"
  DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-$STATE_BASE_DIR/logs/deploy}"
  export VAKWEN_STATE_DIR="$STATE_BASE_DIR" BACKUP_DIR DEPLOY_LOG_DIR
}

setup_deploy_log() {
  if ! mkdir -p "$DEPLOY_LOG_DIR"; then
    echo "ERROR: Cannot create DEPLOY_LOG_DIR at '$DEPLOY_LOG_DIR'" >&2
    echo "Set DEPLOY_LOG_DIR or VAKWEN_STATE_DIR to a writable path." >&2
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

  if [ "${AUTH_MODE:-}" = "oauth" ] && [ -n "${AUTH_USER_ID:-}" ]; then
    echo "ERROR: AUTH_USER_ID must not be set when AUTH_MODE=oauth (identity conflict)" >&2
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

# Rebrand cutover preflight (KZO-92): prevent the deploy from cutting over to
# an empty `vakwen-${env}_pgdata` Postgres volume while the live data still
# sits in `twp-${env}_pgdata`. Without this guard, an automated CI deploy
# after the rebrand merge would bring up a healthy-but-empty stack — see
# docs/004-notes/kzo-92/transition-202605141500-prod-cutover.md for the
# manual cutover sequence the operator must run before the first rebrand
# deploy, and the `.cutover-complete` sentinel that releases this gate.
cutover_preflight() {
  local env_suffix old_volume new_volume sentinel
  case "$ENVIRONMENT" in
    production) env_suffix="prod" ;;
    dev) env_suffix="dev" ;;
    *)
      log "cutover_preflight: skipping for environment '$ENVIRONMENT' (only production/dev are guarded)"
      return 0
      ;;
  esac

  old_volume="twp-${env_suffix}_pgdata"
  new_volume="${COMPOSE_PROJECT}_pgdata"
  sentinel="${STATE_BASE_DIR}/.cutover-complete"

  if ! docker volume inspect "$old_volume" >/dev/null 2>&1; then
    # No legacy volume — clean state, no risk of cutting over to empty pgdata.
    return 0
  fi

  if [ -f "$sentinel" ]; then
    log "cutover_preflight: legacy volume '$old_volume' still present; sentinel '$sentinel' confirms cutover complete."
    return 0
  fi

  if [ "${ALLOW_REBRAND_CUTOVER_BYPASS:-}" = "1" ]; then
    log "cutover_preflight: ALLOW_REBRAND_CUTOVER_BYPASS=1 set — proceeding despite missing sentinel (legacy volume: $old_volume)."
    return 0
  fi

  log "ERROR: rebrand cutover preflight failed."
  log "  Legacy Postgres volume present:  $old_volume"
  log "  New Postgres volume name:        $new_volume"
  log "  Required cutover sentinel file:  $sentinel  (MISSING)"
  log ""
  log "This deploy would bring up the rebranded $COMPOSE_PROJECT stack against"
  log "an empty '$new_volume' Postgres volume while the live data still resides"
  log "in '$old_volume'. The new stack can pass health checks while serving an"
  log "empty database — rollback semantics are unreliable from that state."
  log ""
  log "Resolution:"
  log "  1. Complete the rebrand cutover (see docs/004-notes/kzo-92/transition-"
  log "     202605141500-prod-cutover.md §3) and confirm '$new_volume' holds"
  log "     the migrated data."
  log "  2. Mark the cutover complete:"
  log "       mkdir -p \"$(dirname "$sentinel")\""
  log "       touch \"$sentinel\""
  log "  3. Re-run this deploy."
  log ""
  log "Emergency bypass (NOT recommended): ALLOW_REBRAND_CUTOVER_BYPASS=1 bash $0 ..."
  exit 2
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
    log "Aligning $branch to $remote/$branch"
    git reset --hard "$remote/$branch"
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
  local latest_backup="" dir
  if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
    # Search current → legacy → pre-rebrand. The pre-rebrand path
    # `/data/backups/tw-portfolio` is retained as a rollback artifact so a
    # failed first-rebrand deploy can still find the pre-cutover dump left
    # behind by docs/004-notes/kzo-92/transition-202605141500-prod-cutover.md
    # §3.3 (the dump file is moved to /data/backups/vakwen only after §3.9,
    # so both paths can be authoritative during the rebrand window).
    for dir in "${BACKUP_DIR}" "${LEGACY_BACKUP_DIR}" "/data/backups/tw-portfolio"; do
      [ -z "$dir" ] && continue
      [ -d "$dir" ] || continue
      latest_backup="$(ls -t "$dir"/*.sql.gz 2>/dev/null | head -1 || true)"
      if [ -n "$latest_backup" ]; then
        log "Selected backup for restore: $latest_backup"
        break
      fi
    done

    if [ -n "$latest_backup" ]; then
      log "Restoring database from $latest_backup..."
      gunzip -c "$latest_backup" | docker exec -i "$POSTGRES_CONTAINER" psql -U "${POSTGRES_USER:-vakwen}" -d "${POSTGRES_DB:-vakwen}" 2>/dev/null || \
        log "WARNING: DB restore failed; manual restore may be needed"
    else
      log "WARNING: No backup found for DB restore (searched BACKUP_DIR, LEGACY_BACKUP_DIR, /data/backups/tw-portfolio); schema may be inconsistent"
    fi
  fi
}

wait_for_backup_safe_postgres() {
  local timeout_seconds="${DEPLOY_POSTGRES_BACKUP_READY_TIMEOUT_SECONDS}"
  local primary_ready=""
  local i

  if ! [[ "$timeout_seconds" =~ ^[0-9]+$ ]] || [ "$timeout_seconds" -lt 1 ]; then
    log "ERROR: DEPLOY_POSTGRES_BACKUP_READY_TIMEOUT_SECONDS must be a positive integer (got '$timeout_seconds')"
    return 1
  fi

  log "Waiting for Postgres backup-safe readiness (up to ${timeout_seconds}s)..."
  for i in $(seq 1 "$timeout_seconds"); do
    if docker exec "$POSTGRES_CONTAINER" pg_isready -U "${POSTGRES_USER:-vakwen}" -d "${POSTGRES_DB:-vakwen}" -q >/dev/null 2>&1; then
      primary_ready="$(docker exec "$POSTGRES_CONTAINER" \
        psql -U "${POSTGRES_USER:-vakwen}" -d "${POSTGRES_DB:-vakwen}" -Atqc \
        'SELECT NOT pg_is_in_recovery()' 2>/dev/null || true)"
      if [ "$primary_ready" = "t" ]; then
        log "Postgres is ready for backup after ${i}s"
        return 0
      fi
    fi
    sleep 1
  done

  log "ERROR: Postgres did not become backup-safe within ${timeout_seconds}s"
  return 1
}

rollback() {
  log_phase "ROLLBACK: restoring previous state (branch: ${PREVIOUS_BRANCH:-detached}, sha: ${PREVIOUS_SHA:-unknown})"
  set +e

  if [ -n "$PREVIOUS_BRANCH" ]; then
    git checkout "$PREVIOUS_BRANCH"
  fi
  git reset --hard "$PREVIOUS_SHA"

  IMAGE_TAG="${ROLLBACK_IMAGE_TAG:-$(git rev-parse --short "$PREVIOUS_SHA")}"
  CACHE_BUST="$PREVIOUS_SHA"
  export IMAGE_TAG CACHE_BUST
  log "Rollback image tag: $IMAGE_TAG"

  if ! docker_disk_preflight_build "Rollback Docker build preflight"; then
    log "WARNING: Rollback Docker build preflight failed after cleanup; attempting rollback image build anyway"
  fi
  if ! run_with_heartbeat "rollback image build" dc --profile migrate build $BUILD_FLAGS; then
    log "WARNING: Rollback image build failed; attempting to restart preserved rollback images"
  fi
  dc down --remove-orphans --timeout 10 || true
  for stale_container in $CONTAINER_NAMES $MIGRATE_SERVICE; do
    if docker ps -a --format '{{.Names}}' | grep -q "^${stale_container}$"; then
      log "Removing stale container: $stale_container"
      docker rm -f "$stale_container" 2>/dev/null || true
    fi
  done
  dc up -d --remove-orphans

  # Wait for postgres health before attempting DB restore
  log "Waiting for postgres health (up to 30s)..."
  local pg_ok=false
  for _i in $(seq 1 30); do
    if docker exec "$POSTGRES_CONTAINER" pg_isready -U "${POSTGRES_USER:-vakwen}" -q 2>/dev/null; then
      pg_ok=true
      break
    fi
    sleep 1
  done

  if [ "$pg_ok" = true ]; then
    restore_database_if_possible
  else
    log "WARNING: Postgres not healthy after rollback; skipping DB restore"
  fi

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

preserve_rollback_images() {
  local image_tag="$1"
  local pair repo container image_id

  [ -n "$image_tag" ] || return 0

  for pair in \
    "${STACK_PREFIX}-api:${API_CONTAINER}" \
    "${STACK_PREFIX}-web:${WEB_CONTAINER}" \
    "${STACK_PREFIX}-migrate:${MIGRATE_SERVICE}"
  do
    repo="${pair%%:*}"
    container="${pair#*:}"

    if docker image inspect "${repo}:${image_tag}" >/dev/null 2>&1; then
      log "Rollback image already available: ${repo}:${image_tag}"
      continue
    fi

    image_id=""
    if docker ps -a --format '{{.Names}}' | grep -q "^${container}$"; then
      image_id="$(docker inspect --format '{{.Image}}' "$container" 2>/dev/null || true)"
    fi
    if [ -z "$image_id" ] && docker image inspect "${repo}:latest" >/dev/null 2>&1; then
      image_id="${repo}:latest"
    fi

    if [ -n "$image_id" ] && docker tag "$image_id" "${repo}:${image_tag}" >/dev/null 2>&1; then
      log "Preserved rollback image: ${repo}:${image_tag}"
    else
      log "WARNING: No rollback image source found for ${repo}:${image_tag}; rollback may need to rebuild it"
    fi
  done
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
ENABLE_EXIT_DOCKER_CLEANUP=true
DEPLOY_START_EPOCH=$(date +%s)

if [ "$SELECT_BRANCH" = true ]; then
  select_deploy_branch
fi

log "Deploy started by $(whoami)@$(hostname)"
log "Environment: $ENVIRONMENT"
log "Branch: $BRANCH_NAME | Remote: $BRANCH_REMOTE | SHA arg: ${DEPLOY_SHA:-HEAD}"

cutover_preflight

PREVIOUS_BRANCH="$(git symbolic-ref --quiet --short HEAD || true)"
PREVIOUS_SHA="$(git rev-parse HEAD)"
ROLLBACK_IMAGE_TAG="$(git rev-parse --short "$PREVIOUS_SHA")"
preserve_rollback_images "$ROLLBACK_IMAGE_TAG"

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
# CACHE_BUST invalidates Docker layers after npm ci so source code is
# never served from a stale build cache.  The value changes on every
# deploy because the SHA (or explicit tag) differs.
export CACHE_BUST="$(git rev-parse HEAD)"
phase_done

phase_start "Pre-migration database backup"
if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  if ! wait_for_backup_safe_postgres; then
    collect_compose_failure_diagnostics "postgres not backup-safe for backup"
    exit 1
  fi
  bash "$BACKUP_SCRIPT" --environment "$ENVIRONMENT"
else
  log "Postgres not running; skipping pre-migration backup"
fi
phase_done

phase_start "Build images (tag: $IMAGE_TAG)"
if ! docker_disk_preflight_build "Docker build preflight"; then
  exit 1
fi
# Ensure buildx is usable. check-buildx.sh auto-installs or removes bad binaries.
# If it still fails, fall back to --no-cache with the legacy builder.
bash "$SCRIPT_DIR/check-buildx.sh" || true
BUILD_FLAGS=""
if ! docker buildx version >/dev/null 2>&1; then
  log "WARNING: buildx not available — using --no-cache to prevent stale layers"
  BUILD_FLAGS="--no-cache"
fi
if ! run_with_heartbeat "image build" dc --profile migrate build $BUILD_FLAGS; then
  log "ERROR: Image build failed"
  collect_compose_failure_diagnostics "image build failed"
  exit 1
fi
phase_done

phase_start "Database migrations"
# Run the migration-image build preflight before stopping the current stack.
# If cleanup still cannot recover enough Docker space, this exits while the
# previous app containers are still serving traffic.
if ! docker_disk_preflight_build "Migration image build preflight"; then
  exit 1
fi
# Remove stale containers from previous deploys. dc down only removes containers
# it recognises as part of the current compose project — orphaned containers from
# prior failed deploys (different project label or missing label) survive and
# cause "container name already in use" on the next dc up / dc run.
# Force-remove every known container name so compose can recreate them cleanly.
dc down --remove-orphans --timeout 10 || true
for stale_container in $CONTAINER_NAMES $MIGRATE_SERVICE; do
  if docker ps -a --format '{{.Names}}' | grep -q "^${stale_container}$"; then
    log "Removing stale container: $stale_container"
    if ! docker rm -f "$stale_container"; then
      log "WARNING: docker rm -f failed for $stale_container — restarting Docker daemon"
      sudo systemctl restart docker 2>/dev/null \
        || sudo service docker restart 2>/dev/null \
        || { log "ERROR: Cannot restart Docker daemon. Remove container manually: docker rm -f $stale_container"; exit 1; }
      # Wait for Docker daemon to be ready
      for _w in $(seq 1 30); do
        docker info >/dev/null 2>&1 && break
        sleep 1
      done
    fi
  fi
done

# --build forces a fresh image so new migration files are never missed due to
# Docker layer cache (the full service build ran earlier, so this only rebuilds
# the lightweight migrate image — typically < 2s).
if ! run_with_heartbeat "database migrations" dc --profile migrate run --build --rm "$MIGRATE_SERVICE"; then
  log "ERROR: Migration failed; triggering rollback"
  collect_container_logs
  rollback
  exit 1
fi

# Post-migration verification: confirm the newest numbered migration file is
# recorded in schema_migrations.  Catches silent skips (stale image, cache hit
# on an already-applied name, or a swallowed error).
latest_migration="$(find "$REPO_ROOT/db/migrations" -maxdepth 1 -name '[0-9][0-9][0-9]_*.sql' -type f -exec basename {} \; | sort | tail -1)"
if [ -n "$latest_migration" ]; then
  applied_check="$(docker exec "$POSTGRES_CONTAINER" \
    psql -U "${POSTGRES_USER:-vakwen}" -d "${POSTGRES_DB:-vakwen}" -Atqc \
    "SELECT name FROM schema_migrations WHERE name = '${latest_migration}'" 2>/dev/null || true)"
  if [ "$applied_check" != "$latest_migration" ]; then
    log "ERROR: Post-migration verification failed — '$latest_migration' not found in schema_migrations"
    log "Applied migrations:"
    docker exec "$POSTGRES_CONTAINER" \
      psql -U "${POSTGRES_USER:-vakwen}" -d "${POSTGRES_DB:-vakwen}" -Atqc \
      "SELECT name FROM schema_migrations ORDER BY name" 2>/dev/null || true
    collect_container_logs
    rollback
    exit 1
  fi
  log "Verified: $latest_migration is applied"
fi
phase_done

phase_start "Deploy services"
if ! run_with_heartbeat "docker compose up" dc up -d --remove-orphans; then
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
