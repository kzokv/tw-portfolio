#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_LOCK_FILE="$ROOT_DIR/apps/web/.next/dev/lock"
declare -A DEFAULT_PORTS=( ["web"]="3333" ["api"]="4000" )

error() {
  printf '%s\n' "$1" >&2
  exit 1
}

usage() {
  error "Usage: $0 [web|api|PORT]"
}

map_env_key() {
  case "$1" in
    web) printf 'WEB_PORT';;
    api) printf 'API_PORT';;
    *) printf '%s' "$1";;
  esac
}

resolve_port() {
  local service="$1"
  local env_key
  env_key=$(map_env_key "$service")

  if [[ -f "$ENV_FILE" ]]; then
    local value
    value=$(grep -E "^[[:space:]]*${env_key}=" "$ENV_FILE" | head -n 1 | cut -d= -f2- | tr -d '[:space:]')
    printf '%s' "$value"
  fi
}

kill_by_port() {
  local port="$1"
  local label="$2"

  printf 'Looking for processes listening on port %s (%s)...\n' "$port" "$label"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)

  if [[ -z "$pids" ]]; then
    printf 'No process listening on port %s (%s) was found.\n' "$port" "$label"
    return 0
  fi

  printf 'Killing process(es) %s that hold port %s (%s)...\n' "$pids" "$port" "$label"
  kill $pids
  printf 'Signal sent; verify the port is free with: lsof -iTCP:%s -sTCP:LISTEN\n' "$port"
}

collect_lock_holder_pids() {
  local lock_file="$1"

  if [[ ! -e "$lock_file" ]]; then
    return 0
  fi

  if command -v lslocks >/dev/null 2>&1; then
    lslocks --noheadings --output PID,PATH 2>/dev/null \
      | awk -v lock_file="$lock_file" '$2 == lock_file { print $1 }' \
      | sort -u
    return 0
  fi

  lsof -t "$lock_file" 2>/dev/null | sort -u || true
}

kill_web_lock_holders() {
  local pids
  pids="$(collect_lock_holder_pids "$WEB_LOCK_FILE")"

  printf 'Checking for Next.js dev lock holders at %s...\n' "$WEB_LOCK_FILE"

  if [[ -z "$pids" ]]; then
    printf 'No active process holds %s.\n' "$WEB_LOCK_FILE"
    return 0
  fi

  printf 'Killing process(es) %s holding the Next.js dev lock...\n' "$pids"
  kill $pids
  sleep 1

  if [[ -e "$WEB_LOCK_FILE" ]] && [[ -z "$(collect_lock_holder_pids "$WEB_LOCK_FILE")" ]]; then
    rm -f "$WEB_LOCK_FILE"
    printf 'Removed stale lock file %s after terminating its holder.\n' "$WEB_LOCK_FILE"
  fi
}

if ! command -v lsof >/dev/null 2>&1; then
  error "This script requires lsof to find the listening process."
fi

if [[ "${1:-}" =~ ^- ]]; then
  usage
fi

if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  kill_by_port "$1" "custom port"
  exit 0
fi

declare -a services=()

if [[ -n "${1:-}" ]]; then
  case "$1" in
    web|api) services=("$1");;
    *) usage;;
  esac
else
  services=(web api)
fi

for service in "${services[@]}"; do
  port="$(resolve_port "$service")"
  port="${port:-${DEFAULT_PORTS[$service]}}"

  if [[ -z "$port" ]]; then
    printf 'No port configured for %s; skipping.\n' "$service"
    continue
  fi

  kill_by_port "$port" "$service"

  if [[ "$service" == "web" ]]; then
    kill_web_lock_holders
  fi
done
