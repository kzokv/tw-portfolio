#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="infra/docker/docker-compose.local.yml"
MIGRATE=0
BANNER_NAME="${1:-dev:docker}"

# Save CLI-provided env vars before sourcing .env.local
CLI_AUTH_MODE="${AUTH_MODE:-}"
CLI_PERSISTENCE_BACKEND="${PERSISTENCE_BACKEND:-}"

shift 2>/dev/null || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --migrate) MIGRATE=1 ;;
    -h|--help)
      echo "Usage: dev-docker.sh [banner-name] [--migrate]"
      echo ""
      echo "Start the local Docker Compose development stack."
      echo ""
      echo "Flags:"
      echo "  --migrate    Run DB migrations (activates compose 'migrate' profile)"
      exit 0
      ;;
    *) echo "ERROR: Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

if [[ -f "infra/docker/.env.local" ]]; then
  set -a
  . "infra/docker/.env.local"
  set +a
fi

# CLI overrides take precedence over env file
export AUTH_MODE="${CLI_AUTH_MODE:-${AUTH_MODE:-oauth}}"
export PERSISTENCE_BACKEND="${CLI_PERSISTENCE_BACKEND:-${PERSISTENCE_BACKEND:-postgres}}"

source "$ROOT_DIR/scripts/lib/banner.sh"
print_banner "${BANNER_NAME}" docker

# Verify Docker is available
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not available on PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not reachable. Is Docker running?" >&2
  exit 1
fi

COMPOSE_CMD=(docker compose -f "$COMPOSE_FILE")
if [[ $MIGRATE -eq 1 ]]; then
  COMPOSE_CMD+=(--profile migrate)
fi
COMPOSE_CMD+=(up --build)

cleanup() {
  echo ""
  echo "Shutting down Docker Compose..."
  docker compose -f "$COMPOSE_FILE" down 2>/dev/null || true
}
trap cleanup INT TERM

"${COMPOSE_CMD[@]}"
