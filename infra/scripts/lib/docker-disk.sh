#!/usr/bin/env bash

docker_disk_log() {
  if declare -F log >/dev/null 2>&1; then
    log "$@"
  else
    echo "[$(date '+%H:%M:%S')] $*" >&2
  fi
}

docker_disk_set_defaults() {
  : "${DEPLOY_MIN_DOCKER_FREE_GB:=25}"
  : "${DEPLOY_MIN_DOCKER_FREE_PERCENT:=15}"
  : "${DEPLOY_BUILDER_KEEP_STORAGE:=20GB}"
  : "${DEPLOY_DOCKER_SYSTEM_DF:=0}"
}

docker_disk_resolve_docker() {
  local candidate candidate_dir

  if command -v docker >/dev/null 2>&1; then
    return 0
  fi

  for candidate in "${DEPLOY_DOCKER_BIN:-}" "/share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker"; do
    [ -n "$candidate" ] || continue
    if [ ! -x "$candidate" ]; then
      continue
    fi

    candidate_dir="$(dirname "$candidate")"
    case ":$PATH:" in
      *":$candidate_dir:"*) ;;
      *) export PATH="$candidate_dir:$PATH" ;;
    esac

    if command -v docker >/dev/null 2>&1; then
      return 0
    fi
  done

  return 1
}

docker_disk_resolve_docker >/dev/null 2>&1 || true

docker_disk_get_root_dir() {
  docker info --format '{{.DockerRootDir}}'
}

docker_disk_get_df_target() {
  local path="$1"

  while [ -n "$path" ]; do
    if df -Pk "$path" >/dev/null 2>&1; then
      printf '%s\n' "$path"
      return 0
    fi

    if [ "$path" = "/" ]; then
      break
    fi
    path="$(dirname "$path")"
  done

  return 1
}

docker_disk_print_system_df() {
  docker_disk_set_defaults

  if [ "$DEPLOY_DOCKER_SYSTEM_DF" != "1" ]; then
    docker_disk_log "Skipping docker system df; set DEPLOY_DOCKER_SYSTEM_DF=1 for detailed Docker usage"
    return 0
  fi

  docker system df || true
}

docker_disk_collect_metrics() {
  local docker_root_dir df_target df_line total_kb avail_kb used_percent

  docker_disk_set_defaults

  if ! docker_disk_resolve_docker; then
    docker_disk_log "ERROR: docker is not available on PATH"
    return 1
  fi

  if ! docker info >/dev/null 2>&1; then
    docker_disk_log "ERROR: docker daemon is not reachable"
    return 1
  fi

  docker_root_dir="$(docker_disk_get_root_dir)"
  if [ -z "$docker_root_dir" ]; then
    docker_disk_log "ERROR: Docker root directory is unavailable: ${docker_root_dir:-<empty>}"
    return 1
  fi

  df_target="$(docker_disk_get_df_target "$docker_root_dir")"
  if [ -z "$df_target" ]; then
    docker_disk_log "ERROR: Failed to find an inspectable filesystem path for $docker_root_dir"
    return 1
  fi

  df_line="$(df -Pk "$df_target" | awk 'NR == 2 { print $2 " " $4 " " $5 }')"
  if [ -z "$df_line" ]; then
    docker_disk_log "ERROR: Failed to inspect filesystem usage for $df_target"
    return 1
  fi

  read -r total_kb avail_kb used_percent <<<"$df_line"
  used_percent="${used_percent%%%}"

  DOCKER_DISK_ROOT_DIR="$docker_root_dir"
  DOCKER_DISK_DF_TARGET="$df_target"
  DOCKER_DISK_TOTAL_GB="$(awk -v kb="$total_kb" 'BEGIN { printf "%.1f", kb / 1024 / 1024 }')"
  DOCKER_DISK_FREE_GB="$(awk -v kb="$avail_kb" 'BEGIN { printf "%.1f", kb / 1024 / 1024 }')"
  DOCKER_DISK_FREE_GB_INT="$(awk -v kb="$avail_kb" 'BEGIN { printf "%d", kb / 1024 / 1024 }')"
  DOCKER_DISK_FREE_PERCENT="$((100 - used_percent))"
}

docker_disk_print_diagnostics() {
  local label="${1:-Docker disk diagnostics}"

  if ! docker_disk_collect_metrics; then
    return 1
  fi

  docker_disk_log "${label}: root=${DOCKER_DISK_ROOT_DIR} free=${DOCKER_DISK_FREE_GB}GB (${DOCKER_DISK_FREE_PERCENT}%) total=${DOCKER_DISK_TOTAL_GB}GB thresholds=${DEPLOY_MIN_DOCKER_FREE_GB}GB/${DEPLOY_MIN_DOCKER_FREE_PERCENT}% keep-storage=${DEPLOY_BUILDER_KEEP_STORAGE}"
  if [ "$DOCKER_DISK_DF_TARGET" != "$DOCKER_DISK_ROOT_DIR" ]; then
    docker_disk_log "${label}: using filesystem target ${DOCKER_DISK_DF_TARGET} for disk metrics"
  fi
  df -h "$DOCKER_DISK_DF_TARGET" || true
  docker_disk_print_system_df
}

docker_disk_require_minimums() {
  local label="${1:-Docker disk preflight}"

  if ! docker_disk_collect_metrics; then
    return 1
  fi

  if [ "$DOCKER_DISK_FREE_GB_INT" -lt "$DEPLOY_MIN_DOCKER_FREE_GB" ] || [ "$DOCKER_DISK_FREE_PERCENT" -lt "$DEPLOY_MIN_DOCKER_FREE_PERCENT" ]; then
    docker_disk_log "ERROR: ${label} failed: docker root ${DOCKER_DISK_ROOT_DIR} has ${DOCKER_DISK_FREE_GB}GB free (${DOCKER_DISK_FREE_PERCENT}%), below required ${DEPLOY_MIN_DOCKER_FREE_GB}GB and ${DEPLOY_MIN_DOCKER_FREE_PERCENT}%."
    return 1
  fi

  docker_disk_log "${label}: docker free space check passed"
}

docker_disk_preflight_build() {
  local label="${1:-Docker build preflight}"

  docker_disk_print_diagnostics "$label"
  if docker_disk_require_minimums "$label"; then
    return 0
  fi

  docker_disk_log "${label}: attempting bounded Docker cleanup before failing preflight"
  docker_disk_bounded_cleanup "${label} cleanup"

  docker_disk_print_diagnostics "${label} (after cleanup)"
  docker_disk_require_minimums "${label} (after cleanup)"
}

docker_disk_bounded_cleanup() {
  local label="${1:-Docker exit cleanup}"

  if ! docker_disk_resolve_docker; then
    docker_disk_log "Skipping ${label}: docker is not available"
    return 0
  fi

  if ! docker info >/dev/null 2>&1; then
    docker_disk_log "Skipping ${label}: docker daemon is not reachable"
    return 0
  fi

  docker_disk_set_defaults
  docker_disk_log "${label}: pruning containers, dangling images, and builder cache (keep-storage=${DEPLOY_BUILDER_KEEP_STORAGE})"
  docker container prune -f >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --keep-storage "$DEPLOY_BUILDER_KEEP_STORAGE" >/dev/null 2>&1 || true
  docker_disk_print_diagnostics "${label} (post-cleanup)" || true
}
