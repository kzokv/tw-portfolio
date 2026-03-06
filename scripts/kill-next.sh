#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_LOCK_FILE="$ROOT_DIR/apps/web/.next/dev/lock"
SCRIPT_PATH="${0##*/}"

error() {
  printf '%s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<EOF
Description:
  Terminate dev listeners for web/api ports and clean stale Next.js lock holders.

Usage: ${SCRIPT_PATH} [OPTIONS] [web|api|PORT]

Options:
  -h, --help              Show this help message and exit (optional)
EOF
}

map_env_key() {
  case "$1" in
    web) printf 'WEB_PORT';;
    api) printf 'API_PORT';;
    *) printf '%s' "$1";;
  esac
}

default_port_for_service() {
  case "$1" in
    web) printf '3333' ;;
    api) printf '4000' ;;
    *) printf '' ;;
  esac
}

resolve_port() {
  local service="$1"
  local env_key
  env_key=$(map_env_key "$service")

  if [[ -f "$ENV_FILE" ]]; then
    local value
    value=$(
      grep -E "^[[:space:]]*${env_key}=" "$ENV_FILE" 2>/dev/null \
        | head -n 1 \
        | cut -d= -f2- \
        | tr -d '[:space:]' \
        || true
    )
    printf '%s' "$value"
  fi
}

collect_port_pids() {
  local port="$1"

  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true

  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null \
      | grep -oE 'pid=[0-9]+' \
      | cut -d= -f2 \
      | sort -u \
      || true
  fi
}

filter_alive_pids() {
  local result=()
  local pid

  for pid in "$@"; do
    if kill -0 "$pid" 2>/dev/null; then
      result+=("$pid")
    fi
  done

  if ((${#result[@]} > 0)); then
    printf '%s\n' "${result[@]}"
  fi
}

kill_by_port() {
  local port="$1"
  local label="$2"

  printf 'Looking for processes listening on port %s (%s)...\n' "$port" "$label"
  local pids
  pids="$(collect_port_pids "$port" | sort -u)"

  if [[ -z "$pids" ]]; then
    printf 'No process listening on port %s (%s) was found.\n' "$port" "$label"
    return 0
  fi

  printf 'Killing process(es) %s that hold port %s (%s)...\n' "$pids" "$port" "$label"
  # First, ask processes to terminate gracefully.
  kill $pids 2>/dev/null || true
  sleep 1

  local -a pid_array
  local remaining
  mapfile -t pid_array <<<"$pids"
  remaining="$(filter_alive_pids "${pid_array[@]}")"

  if [[ -n "$remaining" ]]; then
    printf 'Process(es) still alive after SIGTERM: %s. Sending SIGKILL...\n' "$remaining"
    kill -9 $remaining 2>/dev/null || true
  fi

  printf 'Signal sent; verify the port is free with: ss -ltnp "( sport = :%s )"\n' "$port"
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

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ "${1:-}" =~ ^- ]]; then
  printf 'ERROR: Unknown option: %s\n' "${1:-}" >&2
  usage
  exit 1
fi

if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  kill_by_port "$1" "custom port"
  exit 0
fi

declare -a services=()

if [[ -n "${1:-}" ]]; then
  case "$1" in
    web|api) services=("$1");;
    *)
      printf 'ERROR: Invalid target: %s (expected web|api|PORT)\n' "$1" >&2
      usage
      exit 1
      ;;
  esac
else
  services=(web api)
fi

for service in "${services[@]}"; do
  port="$(resolve_port "$service")"
  port="${port:-$(default_port_for_service "$service")}"

  if [[ -z "$port" ]]; then
    printf 'No port configured for %s; skipping.\n' "$service"
    continue
  fi

  kill_by_port "$port" "$service"

  if [[ "$service" == "web" ]]; then
    kill_web_lock_holders
  fi
done
