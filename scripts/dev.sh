#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIN_NODE_VERSION="24.13.0"

cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is required but was not found in PATH." >&2
  exit 1
fi

version_gte() {
  local current="$1"
  local minimum="$2"
  local c_major=0 c_minor=0 c_patch=0
  local m_major=0 m_minor=0 m_patch=0

  IFS=. read -r c_major c_minor c_patch <<<"$current"
  IFS=. read -r m_major m_minor m_patch <<<"$minimum"

  c_minor="${c_minor:-0}"
  c_patch="${c_patch:-0}"
  m_minor="${m_minor:-0}"
  m_patch="${m_patch:-0}"

  if (( c_major > m_major )); then return 0; fi
  if (( c_major < m_major )); then return 1; fi
  if (( c_minor > m_minor )); then return 0; fi
  if (( c_minor < m_minor )); then return 1; fi
  (( c_patch >= m_patch ))
}

node_version="$(node -p 'process.versions.node' 2>/dev/null || true)"
if ! version_gte "$node_version" "$MIN_NODE_VERSION"; then
  echo "ERROR: This repo requires Node >=${MIN_NODE_VERSION} (found $(node -v 2>/dev/null || echo unknown))." >&2
  echo "Run: nvm use (or install Node ${MIN_NODE_VERSION} and retry)." >&2
  exit 1
fi

set -a
[ -f ./.env ] && . ./.env
set +a

api_pid=""
web_pid=""
last_pid=""
USE_WAIT_N=0

if help wait 2>/dev/null | grep -q -- "-n"; then
  USE_WAIT_N=1
fi

start_dev_process() {
  "$@" &
  last_pid="$!"
}

kill_process_tree() {
  local pid="$1"
  local child_pid=""

  while IFS= read -r child_pid; do
    [[ -n "$child_pid" ]] || continue
    kill_process_tree "$child_pid"
  done < <(pgrep -P "$pid" 2>/dev/null || true)

  kill "$pid" 2>/dev/null || true
}

wait_for_any() {
  if [[ "$USE_WAIT_N" -eq 1 ]]; then
    wait -n "$api_pid" "$web_pid"
    return
  fi

  while true; do
    if [[ -n "$api_pid" ]] && ! kill -0 "$api_pid" 2>/dev/null; then
      wait "$api_pid" 2>/dev/null || true
      return
    fi

    if [[ -n "$web_pid" ]] && ! kill -0 "$web_pid" 2>/dev/null; then
      wait "$web_pid" 2>/dev/null || true
      return
    fi

    sleep 1
  done
}

cleanup() {
  local exit_code=$?

  for pid in "$web_pid" "$api_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill_process_tree "$pid"
    fi
  done

  wait "$web_pid" "$api_pid" 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

start_dev_process npm run dev -w apps/api
api_pid="$last_pid"

start_dev_process npm run dev -w apps/web
web_pid="$last_pid"
wait_for_any
