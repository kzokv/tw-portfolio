#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"

usage() {
  cat <<EOF
Usage: ${0##*/} <api|web|mock-oauth>
EOF
}

kill_tree() {
  local pid="$1"
  local children
  children="$(pgrep -P "$pid" || true)"
  if [[ -n "$children" ]]; then
    local child
    for child in $children; do
      kill_tree "$child"
    done
  fi
  kill "$pid" 2>/dev/null || true
}

wait_for_exit() {
  local pid="$1"
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

kill_tree_hard() {
  local pid="$1"
  local children
  children="$(pgrep -P "$pid" || true)"
  if [[ -n "$children" ]]; then
    local child
    for child in $children; do
      kill_tree_hard "$child"
    done
  fi
  kill -9 "$pid" 2>/dev/null || true
}

kill_matching_command() {
  local pattern="$1"

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local pid="${line%% *}"
    local command="${line#* }"
    if [[ "$command" != *"$ROOT_DIR"* ]]; then
      continue
    fi

    kill_tree "$pid"
    if ! wait_for_exit "$pid"; then
      kill_tree_hard "$pid"
    fi
  done < <(pgrep -af "$pattern" || true)
}

listener_pids() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

process_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

process_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

assert_port_reclaimed() {
  local port="$1"
  local expected_prefix="$2"
  local pids

  pids="$(listener_pids "$port")"
  [[ -z "$pids" ]] && return 0

  local pid
  for pid in $pids; do
    local cwd
    local command
    cwd="$(process_cwd "$pid")"
    command="$(process_command "$pid")"

    if [[ -n "$cwd" && "$cwd" == "$expected_prefix"* ]]; then
      kill_tree "$pid"
      if ! wait_for_exit "$pid"; then
        kill_tree_hard "$pid"
      fi
      continue
    fi

    if [[ "$command" == *"$ROOT_DIR"* ]]; then
      kill_tree "$pid"
      if ! wait_for_exit "$pid"; then
        kill_tree_hard "$pid"
      fi
      continue
    fi

    printf 'Port %s is occupied by an unrelated process.\n' "$port" >&2
    printf 'PID: %s\n' "$pid" >&2
    printf 'CWD: %s\n' "${cwd:-unknown}" >&2
    printf 'CMD: %s\n' "${command:-unknown}" >&2
    exit 1
  done

  pids="$(listener_pids "$port")"
  if [[ -n "$pids" ]]; then
    printf 'Failed to reclaim port %s. Remaining listener(s): %s\n' "$port" "$pids" >&2
    exit 1
  fi
}

cleanup_next_lock() {
  local lock_file="$ROOT_DIR/apps/web/.next/dev/lock"
  if [[ ! -e "$lock_file" ]]; then
    return 0
  fi

  if lsof "$lock_file" >/dev/null 2>&1; then
    return 0
  fi

  rm -f "$lock_file"
}

case "$TARGET" in
  api)
    kill_matching_command 'tsx watch src/server.ts'
    assert_port_reclaimed "${API_PORT:-4000}" "$ROOT_DIR/apps/api"
    ;;
  web)
    kill_matching_command 'next dev -p'
    assert_port_reclaimed "${WEB_PORT:-3333}" "$ROOT_DIR/apps/web"
    cleanup_next_lock
    ;;
  mock-oauth)
    kill_matching_command 'mock-oauth-server.mjs'
    assert_port_reclaimed "${MOCK_OAUTH_PORT:-4445}" "$ROOT_DIR/apps/web"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
