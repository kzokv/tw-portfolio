#!/usr/bin/env bash
#
# Docker cleanup script for tw-portfolio (dev machine only).
#
# What it does:
#   1. Shows stopped containers and dangling images.
#   2. Removes all stopped containers.
#   3. Prunes dangling images only.
#
# Defaults:
#   - Interactive "apply" mode: actually deletes, but asks for confirmation.
#
# Usage:
#   ./scripts/docker-cleanup.sh              # Interactive apply (prompt before deleting)
#   ./scripts/docker-cleanup.sh --dry-run    # Show what would be removed, do not delete
#   ./scripts/docker-cleanup.sh --yes        # Non-interactive apply (no prompt)
#   ./scripts/docker-cleanup.sh --help       # Show help
#

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0        # 0 = apply, 1 = dry-run
AUTO_CONFIRM=0   # 0 = ask, 1 = skip prompt (non-interactive)

usage() {
  cat <<'EOF'
Docker cleanup (dev only)

Removes:
  - All stopped containers
  - Dangling images only (unreferenced layers)

Defaults:
  - Interactive apply mode (asks for confirmation before deleting)

Usage:
  scripts/docker-cleanup.sh
      Show targets and prompt before deleting stopped containers and dangling images.

  scripts/docker-cleanup.sh --dry-run
      Show what would be removed, but do not delete anything.

  scripts/docker-cleanup.sh --yes
      Apply deletions without confirmation (non-interactive).

Options:
  --dry-run       Run in dry-run mode (no deletions).
  --yes, -y       Do not prompt for confirmation, always apply.
  --help, -h      Show this help text.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        ;;
      --yes|-y)
        AUTO_CONFIRM=1
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage
        exit 2
        ;;
    esac
    shift
  done
}

log() {
  local timestamp
  if timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)"; then
    echo "[$timestamp] $*"
  else
    echo "[unknown-time] $*"
  fi
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    log "ERROR: 'docker' CLI not found in PATH."
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    log "ERROR: Unable to talk to Docker daemon. Is it running?"
    exit 1
  fi
}

ensure_not_ci() {
  # This script is intended for developer machines only.
  # Bail out early if we detect a CI environment.
  if [[ "${CI:-}" = "true" || -n "${GITHUB_ACTIONS:-}" ]]; then
    log "Detected CI environment (CI/GITHUB_ACTIONS); this cleanup script is for dev machines only. Exiting."
    exit 1
  fi
}

show_targets() {
  log "Inspecting Docker resources..."

  local stopped_containers dangling_images
  stopped_containers="$(docker ps -aq -f "status=exited" || true)"
  dangling_images="$(docker images -q -f "dangling=true" || true)"

  if [[ -z "$stopped_containers" ]]; then
    log "No stopped containers."
  else
    log "Stopped containers:"
    docker ps -a -f "status=exited"
  fi

  if [[ -z "$dangling_images" ]]; then
    log "No dangling images."
  else
    log "Dangling images:"
    docker images -f "dangling=true"
  fi

  if [[ -z "$stopped_containers" && -z "$dangling_images" ]]; then
    log "Nothing to clean up."
    echo ""
    return 1
  fi

  echo ""
  return 0
}

confirm_if_needed() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry-run mode: no deletions will be performed."
    return 1
  fi

  if [[ "$AUTO_CONFIRM" -eq 1 ]]; then
    log "Non-interactive mode: proceeding without confirmation."
    return 0
  fi

  read -r -p "Proceed with deleting stopped containers and pruning dangling images? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES)
      log "User confirmed cleanup."
      return 0
      ;;
    *)
      log "Cleanup cancelled by user."
      return 1
      ;;
  esac
}

cleanup_docker() {
  log "Removing stopped containers (docker container prune)..."
  docker container prune -f

  log "Pruning dangling images only (docker image prune --filter dangling=true)..."
  docker image prune -f --filter "dangling=true"
}

main() {
  parse_args "$@"
  require_docker
  ensure_not_ci

  if ! show_targets; then
    # Nothing to do
    exit 0
  fi

  if ! confirm_if_needed; then
    exit 0
  fi

  cleanup_docker

  log "Docker cleanup completed."
}

main "$@"
